'use strict';

/**
 * 自更新（self-update）
 * ------------------------------------------------------------------
 * 面板自己也是个 npm 包，这里负责四件事：
 *   1. 认清"我是怎么被装起来的"——全局 / 项目依赖 / npx 临时 / 源码检出；
 *   2. 去 registry 问最新版本，和当前版本比一比（带缓存，默认 5 分钟）；
 *   3. 更新时执行对应命令，把输出逐行回吐给调用方（面板走 SSE 流式显示）：
 *        全局    → npm install -g pm2-ui@latest
 *        依赖    → npm install pm2-ui@latest（在宿主项目里）
 *        源码    → git pull --ff-only && npm install
 *   4. 更新完提示重启；面板由 pm2 托管时可以直接 pm2 restart 自己。
 *
 * 环境变量：
 *   PM2_UI_AUTO_UPDATE_CHECK=0   关闭启动时的自动检查（面板里的「检查更新」仍可用）
 *   PM2_UI_UPDATE_REGISTRY=...   换 registry（默认 https://registry.npmjs.org）
 *   PM2_UI_UPDATE_TIMEOUT=8000   查询最新版本的超时毫秒数
 *
 * 注意：本模块只依赖 Node 内置模块，`pm2-ui --update` 在依赖没装好时也能用。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const i18n = require('./i18n');

const ROOT = path.join(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));

const AUTO_CHECK = process.env.PM2_UI_AUTO_UPDATE_CHECK !== '0';
const CACHE_TTL = 5 * 60 * 1000;
const CHECK_TIMEOUT = Number(process.env.PM2_UI_UPDATE_TIMEOUT) || 8000;
const STEP_TIMEOUT = 5 * 60 * 1000;

/** 安装方式的可读名称（按语言）；不认识的方式原样返回 */
function modeLabel(mode, lang) {
  const key = 'update.mode.' + (mode || 'unknown');
  const text = i18n.translate(lang, key);
  return text === key ? (mode || 'unknown') : text;
}

/* ------------------------------ 小工具 ------------------------------ */

const npmBin = () => (process.platform === 'win32' ? 'npm.cmd' : 'npm');
const gitBin = () => 'git';

/** child 是否位于 parent 目录之内 */
function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function realRoot() {
  try { return fs.realpathSync(ROOT); } catch (_) { return ROOT; }
}

/** 同步执行一条命令（只用于探测，短超时） */
function runSync(file, args, timeout = 8000) {
  try {
    const r = spawnSync(file, args, {
      encoding: 'utf8',
      timeout,
      env: process.env,
      shell: process.platform === 'win32', // Windows 下 npm.cmd / git 需要 shell
    });
    return {
      code: r.status === null ? 1 : r.status,
      stdout: (r.stdout || '').trim(),
      stderr: (r.stderr || '').trim(),
      error: r.error ? String(r.error.message || r.error) : null,
    };
  } catch (e) {
    return { code: 1, stdout: '', stderr: '', error: String(e.message || e) };
  }
}

/** 去掉 npm / git 输出里的 ANSI 颜色控制符 */
const stripAnsi = (s) => String(s).replace(/\u001B\[[0-9;]*[A-Za-z]/g, '');

/* ---------------------------- 版本比较 ---------------------------- */

function parseVersion(v) {
  const s = String(v || '').trim().replace(/^v/i, '');
  const [core, pre = ''] = s.split('-');
  const nums = core.split('.').map((n) => Number.parseInt(n, 10) || 0);
  return { nums, pre };
}

/** a > b 返回 1，a < b 返回 -1，相等返回 0（够用的 semver 比较） */
function compareVersions(a, b) {
  const A = parseVersion(a);
  const B = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    const x = A.nums[i] || 0;
    const y = B.nums[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  if (A.pre === B.pre) return 0;
  if (!A.pre) return 1;   // 正式版 > 预发布版
  if (!B.pre) return -1;
  return A.pre > B.pre ? 1 : -1;
}

/* --------------------------- 安装方式识别 --------------------------- */

let globalRootCache;

/** 全局 node_modules 目录；拿不到就返回空字符串 */
function globalRoot() {
  if (globalRootCache !== undefined) return globalRootCache;
  globalRootCache = '';
  const r = runSync(npmBin(), ['root', '-g'], 10000);
  if (r.code === 0 && r.stdout) {
    const lines = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const last = lines[lines.length - 1] || '';
    if (path.isAbsolute(last)) globalRootCache = last;
  }
  return globalRootCache;
}

/**
 * 判断当前进程是从哪儿加载起来的。
 * @returns {{mode:'global'|'local'|'npx'|'git'|'unknown', dir:string, prefix?:string}}
 */
function detect() {
  const root = realRoot();
  const g = globalRoot();

  if (g && isInside(root, g)) return { mode: 'global', dir: root, prefix: g };
  if (/[\\/]_npx[\\/]/.test(root)) return { mode: 'npx', dir: root };

  const parts = root.split(path.sep);
  const idx = parts.lastIndexOf('node_modules');
  if (idx > 0) {
    return { mode: 'local', dir: parts.slice(0, idx).join(path.sep) || path.sep };
  }

  // 源码检出：有 .git 且不在 node_modules 里（也覆盖了 npm link 的开发场景）
  if (fs.existsSync(path.join(root, '.git'))) return { mode: 'git', dir: root };

  return { mode: 'unknown', dir: root };
}

/** 更新步骤（数组顺序即执行顺序） */
function planSteps(det, lang) {
  const t = i18n.translator(lang);
  const name = pkg.name;
  const npm = npmBin();
  const installArgs = ['--no-fund', '--no-audit', `${name}@latest`];

  switch (det.mode) {
    case 'global':
      return {
        canUpdate: true,
        reason: '',
        steps: [{
          label: t('update.label.global', { name }),
          cmd: npm,
          args: ['install', '-g', ...installArgs],
          cwd: os.homedir() || det.dir,
          timeout: STEP_TIMEOUT,
        }],
      };
    case 'local':
      return {
        canUpdate: true,
        reason: '',
        steps: [{
          label: t('update.label.local', { name, dir: det.dir }),
          cmd: npm,
          args: ['install', ...installArgs],
          cwd: det.dir,
          timeout: STEP_TIMEOUT,
        }],
      };
    case 'git':
      return {
        canUpdate: true,
        reason: '',
        steps: [
          { label: t('update.label.gitPull'), cmd: gitBin(), args: ['pull', '--ff-only'], cwd: det.dir, timeout: 120000 },
          { label: t('update.label.gitInstall'), cmd: npm, args: ['install', '--no-fund', '--no-audit'], cwd: det.dir, timeout: STEP_TIMEOUT },
        ],
      };
    case 'npx':
      return {
        canUpdate: false,
        reason: t('update.reason.npx', { name }),
        steps: [],
      };
    default:
      return {
        canUpdate: false,
        reason: t('update.reason.unknown', { name }),
        steps: [],
      };
  }
}

/* --------------------------- 查询最新版本 --------------------------- */

function registryBase() {
  return (process.env.PM2_UI_UPDATE_REGISTRY || 'https://registry.npmjs.org').replace(/\/+$/, '');
}

function metaUrl() {
  return `${registryBase()}/${encodeURIComponent(pkg.name)}/latest`;
}

function fetchJson(url, timeout = CHECK_TIMEOUT, t = i18n.translator(), depth = 0) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('http:') ? require('http') : require('https');
    const req = mod.get(url, {
      headers: {
        accept: 'application/json',
        'user-agent': `${pkg.name}/${pkg.version} (self-update-check)`,
      },
    }, (res) => {
      const code = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(code) && res.headers.location && depth < 3) {
        res.resume();
        return fetchJson(new URL(res.headers.location, url).toString(), timeout, t, depth + 1).then(resolve, reject);
      }
      if (code !== 200) {
        res.resume();
        return reject(new Error(t('update.registryHttp', { code })));
      }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        buf += c;
        if (buf.length > 4 * 1024 * 1024) req.destroy(new Error(t('update.registryTooLarge')));
      });
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch (_) { reject(new Error(t('update.registryParse'))); }
      });
    });
    req.setTimeout(timeout, () => req.destroy(new Error(t('update.checkTimeout', { ms: timeout }))));
    req.on('error', reject);
  });
}

/** 读磁盘上的 package.json 版本（更新后进程内的 require 缓存还是旧值） */
function versionOnDisk() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || pkg.version;
  } catch (_) {
    return pkg.version;
  }
}

/* ------------------------------ 检查 ------------------------------ */

let cache = { ts: 0, data: null };
let pending = null;
let applying = false;   // 更新互斥：避免 EventSource 重连等情况把 npm install 跑两遍

async function doCheck(lang) {
  const t = i18n.translator(lang);
  const det = detect();
  const plan = planSteps(det, lang);

  const info = {
    name: pkg.name,
    current: versionOnDisk(),
    latest: null,
    hasUpdate: false,
    mode: det.mode,
    modeLabel: modeLabel(det.mode, lang),
    canUpdate: plan.canUpdate,
    planText: plan.canUpdate ? plan.steps.map((s) => s.label).join('  →  ') : '',
    reason: plan.reason,
    registry: metaUrl(),
    homepage: pkg.homepage || '',
    autoCheck: AUTO_CHECK,
    checkedAt: Date.now(),
    error: null,
  };

  try {
    const meta = await fetchJson(metaUrl(), CHECK_TIMEOUT, t);
    const latest = String(meta.version || '').trim();
    if (!latest) throw new Error(t('update.noVersion'));
    info.latest = latest;
    info.hasUpdate = compareVersions(latest, info.current) > 0;
  } catch (e) {
    info.error = String((e && e.message) || e);
  }

  cache = { ts: Date.now(), data: info };
  return info;
}

/**
 * 检查更新（带 5 分钟缓存；force=true 强制重查）
 * @param {{force?:boolean, lang?:string}} [opts]
 */
async function check(opts = {}) {
  const force = Boolean(opts.force);
  if (pending) return pending;
  if (!force && cache.data && Date.now() - cache.ts < CACHE_TTL) return cache.data;
  pending = doCheck(opts.lang).finally(() => { pending = null; });
  return pending;
}

/** 上一次检查的结果（同步；没有检查过则为 null），用于塞进 overview 首屏 */
function cached() {
  return cache.data;
}

/* ------------------------------ 执行 ------------------------------ */

function quoteWinArg(a) {
  const s = String(a);
  return /[\s"^&|<>]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 跑单个步骤，逐行回吐输出 */
function runStep(step, onLine, sink, t = i18n.translator()) {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    const env = {
      ...process.env,
      NO_UPDATE_NOTIFIER: '1',
      npm_config_update_notifier: 'false',
      npm_config_fund: 'false',
      npm_config_audit: 'false',
      GIT_TERMINAL_PROMPT: '0', // git 需要凭据时直接失败，而不是卡住
    };
    const cwd = step.cwd || ROOT;
    const child = isWin
      ? spawn([step.cmd, ...(step.args || []).map(quoteWinArg)].join(' '), { cwd, env, shell: true })
      : spawn(step.cmd, step.args || [], { cwd, env });

    let buf = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGTERM'); } catch (_) { /* ignore */ }
      reject(new Error(t('update.stepTimeout', { label: step.label, seconds: Math.round((step.timeout || STEP_TIMEOUT) / 1000) })));
    }, step.timeout || STEP_TIMEOUT);

    const emit = (line) => {
      const text = stripAnsi(line).trimEnd();
      if (!text.trim()) return;
      sink.push(text);
      onLine(text, 'out');
    };

    const push = (chunk) => {
      buf += chunk.toString();
      const parts = buf.split(/\r\n|\r|\n/);
      buf = parts.pop();
      for (const line of parts) emit(line);
    };

    child.stdout.on('data', push);
    child.stderr.on('data', push);
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(t('update.spawnFailed', { cmd: step.cmd, message: e.message })));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (buf) emit(buf);
      resolve(code === null ? 1 : code);
    });
  });
}

/**
 * 执行更新（同一时刻只允许一个）。
 * @param {{onLine?:(text:string, kind:string)=>void, lang?:string}} [opts] onLine 用来把输出流给面板
 * @returns {Promise<{ok:boolean,from:string,to:string,changed:boolean,steps:string[],output:string,restartRequired:boolean}>}
 */
async function apply(opts = {}) {
  const t = i18n.translator(opts.lang);
  if (applying) throw new Error(t('update.busy'));
  const onLine = typeof opts.onLine === 'function' ? opts.onLine : () => {};
  const det = detect();
  const plan = planSteps(det, opts.lang);
  if (!plan.canUpdate || !plan.steps.length) {
    throw new Error(plan.reason || t('update.reason.notSupported'));
  }

  applying = true;
  const from = versionOnDisk();
  const sink = [];

  try {
    onLine(t('update.modeLine', { mode: modeLabel(det.mode, opts.lang) }), 'sys');
    for (const step of plan.steps) {
      onLine(`$ ${step.label}`, 'sys');
      const code = await runStep(step, onLine, sink, t);
      if (code !== 0) {
        throw new Error(t('update.stepFailed', { label: step.label, code }));
      }
    }

    const to = versionOnDisk();
    cache = { ts: 0, data: null }; // 让下一次检查拿到新版本

    return {
      ok: true,
      from,
      to,
      changed: to !== from,
      mode: det.mode,
      steps: plan.steps.map((s) => s.label),
      output: sink.join('\n'),
      restartRequired: true,
    };
  } finally {
    applying = false;
  }
}

/* ------------------------------ 重启 ------------------------------ */

/** 面板是否由 pm2 托管；返回可用于 pm2 restart 的进程名 */
async function pm2HostName() {
  if (!process.env.pm_id) return null;
  try {
    const pm2 = require('./pm2');
    const list = await pm2.rawList();
    const hit = list.find((p) => Number(p.pid) === process.pid);
    if (hit) return (hit.pm2_env && hit.pm2_env.name) || hit.name || null;
  } catch (_) { /* 读不到列表就退回环境变量 */ }
  return process.env.name || process.env.pm2_app_name || null;
}

/**
 * 重启面板以加载新版本。
 * 由 pm2 托管 → pm2 restart <自己>；否则只能提示用户手动重启（不能悄悄把进程退掉）。
 */
async function restartSelf(lang) {
  const t = i18n.translator(lang);
  const name = await pm2HostName();
  if (!name) {
    return {
      ok: false,
      mode: 'manual',
      message: t('api.notPm2Hosted'),
    };
  }
  const pm2 = require('./pm2');
  await pm2.action(name, 'restart', lang);
  return { ok: true, mode: 'pm2', name, message: t('update.restarted', { name }) };
}

module.exports = {
  ROOT,
  AUTO_CHECK,
  modeLabel,
  compareVersions,
  detect,
  planSteps,
  check,
  cached,
  apply,
  restartSelf,
  pm2HostName,
};
