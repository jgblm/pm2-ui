'use strict';

/**
 * PM2 CLI 封装
 * ------------------------------------------------------------------
 * 统一走命令行（`pm2 jlist` / `pm2 restart xxx`），好处是：
 *   1. 不需要长连接 daemon socket，读数据与执行动作行为一致；
 *   2. 和用户在终端里敲 `pm2 ls` 看到的结果完全一致，不会出现"面板和终端对不上"的情况。
 * pm2 可执行文件按 环境变量 -> 项目本地 -> 全局 PATH 的顺序查找。
 */

const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const i18n = require('./i18n');

const CANDIDATES = [
  process.env.PM2_BIN,
  path.join(__dirname, '..', 'node_modules', '.bin', 'pm2'),
  path.join(__dirname, '..', 'node_modules', 'pm2', 'bin', 'pm2'),
].filter(Boolean);

let resolvedBin = null;

function getPm2Bin() {
  if (resolvedBin) return resolvedBin;
  for (const c of CANDIDATES) {
    try {
      if (c && fs.existsSync(c)) {
        resolvedBin = c;
        return resolvedBin;
      }
    } catch (_) { /* ignore */ }
  }
  // 兜底：交给 shell 从 PATH 解析
  resolvedBin = process.platform === 'win32' ? 'pm2.cmd' : 'pm2';
  return resolvedBin;
}

/**
 * 把 PM2_BIN 规范化成 { file, args }：
 * 如果指向的是 .js 文件，就用当前 node 去执行它（方便接入自定义包装脚本 / 测试替身）。
 */
function resolveCommand(extraArgs) {
  const bin = getPm2Bin();
  if (/\.(js|cjs|mjs)$/i.test(bin)) {
    return { file: process.execPath, args: [bin, ...extraArgs] };
  }
  return { file: bin, args: extraArgs };
}

/** 执行 pm2 命令，返回 { code, stdout, stderr } */
function run(args, opts = {}) {
  return new Promise((resolve) => {
    const { file, args: finalArgs } = resolveCommand(args);
    execFile(
      file,
      finalArgs,
      {
        timeout: opts.timeout || 20000,
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, PM2_COLORS: 'false', FORCE_COLOR: '0' },
        cwd: opts.cwd || path.join(__dirname, '..'),
      },
      (err, stdout, stderr) => {
        resolve({
          code: err ? (err.code === undefined ? 1 : err.code) : 0,
          stdout: stdout || '',
          stderr: stderr || '',
          error: err ? String(err.message || err) : null,
        });
      }
    );
  });
}

/** pm2 是否可用（用于前端提示） */
async function isAvailable() {
  const r = await run(['--version']);
  if (r.code !== 0) return { available: false, version: null, bin: getPm2Bin() };
  return { available: true, version: r.stdout.trim(), bin: getPm2Bin() };
}

/** 拉取进程列表（原始 pm2 结构） */
async function rawList(lang) {
  const t = i18n.translator(lang);
  const r = await run(['jlist']);
  if (r.code !== 0) {
    // pm2 在"守护进程没起来"时可能返回非 0 但 stdout 是 '[]'
    if (r.stdout.trim().startsWith('[')) {
      return JSON.parse(r.stdout);
    }
    throw new Error(r.stderr || r.error || t('pm2.jlistFailed'));
  }
  const text = r.stdout.trim();
  if (!text) return [];
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(t('pm2.parseFailed', { text: text.slice(0, 300) }));
  }
}

/** 允许的动作白名单，避免把用户输入直接拼进命令 */
const ACTIONS = {
  restart: ['restart'],
  reload: ['reload'],
  stop: ['stop'],
  start: ['start'],
  delete: ['delete'],
  reset: ['reset'],
};

/** 对指定进程执行动作；name 必须是列表中真实存在的进程名 */
async function action(name, act, lang) {
  const t = i18n.translator(lang);
  const args = ACTIONS[act];
  if (!args) throw new Error(t('api.unsupportedAction', { action: act }));
  if (!name || typeof name !== 'string' || name.startsWith('-')) {
    throw new Error(t('pm2.invalidName'));
  }
  const r = await run([...args, name, '--silent'], { timeout: 30000 });
  if (r.code !== 0) {
    throw new Error((r.stderr || r.stdout || r.error || '').trim() || t('pm2.actionFailed', { action: act }));
  }
  return true;
}

/** 启动一个脚本 / 配置文件 */
async function startTarget(target, opts = {}) {
  const t = i18n.translator(opts.lang);
  if (!target || typeof target !== 'string' || target.startsWith('-')) {
    throw new Error(t('pm2.invalidTarget'));
  }
  const args = ['start', target];
  if (opts.name) args.push('--name', String(opts.name));
  if (opts.cwd) args.push('--cwd', String(opts.cwd));
  // 显式脚本参数优先；否则用声明端口合成，规则与 store.effectiveArgs 保持一致
  const extra = Array.isArray(opts.args) ? opts.args.map(String).filter((s) => s !== '') : [];
  if (extra.length) args.push('--', ...extra);
  else if (opts.port) args.push('--', '--port', String(opts.port));
  const r = await run(args, { timeout: 40000 });
  if (r.code !== 0) {
    throw new Error((r.stderr || r.stdout || r.error || '').trim() || t('pm2.startFailed'));
  }
  return r.stdout.trim();
}

/** 读取日志（按行数截取尾部）。分开取 stdout / stderr，避免靠猜 */
async function logs(name, lines = 200, type = 'all') {
  const read = async (flag) => {
    const r = await run(
      ['logs', name, '--lines', String(lines), '--nostream', '--raw', flag],
      { timeout: 20000 }
    );
    return (r.stdout || '').trim();
  };
  const out = type === 'err' ? '' : await read('--out');
  const err = type === 'out' ? '' : await read('--err');
  return { out, err };
}

/* ---------------- 按任务定义启动（用于「恢复启动」） ---------------- */

/**
 * 执行一条写操作命令，非 0 退出即抛错。
 * 参数数组由调用方构造（如 store.toPm2Args），不拼接用户原始字符串。
 */
async function applyArgs(args, timeout = 40000, lang) {
  const t = i18n.translator(lang);
  if (!Array.isArray(args) || !args.length) throw new Error(t('pm2.emptyCommand'));
  const r = await run(args, { timeout });
  if (r.code !== 0) {
    throw new Error((r.stderr || r.stdout || r.error || '').trim() || t('pm2.commandFailed', { command: args.join(' ') }));
  }
  return (r.stdout || '').trim();
}

/** 按保存的任务定义重新启动（pm2 忘掉该任务后依然可用） */
async function startDefinition(def, lang) {
  const { toPm2Args } = require('./store');
  return applyArgs(toPm2Args(def, lang), 45000, lang);
}

/* ------------------ 列表持久化：save / resurrect ------------------ */

/** 把当前进程列表写入 dump.pm2，供守护进程重启后恢复 */
async function save(lang) {
  return applyArgs(['save'], 30000, lang);
}

/** 从 dump.pm2 恢复进程列表 */
async function resurrect(lang) {
  return applyArgs(['resurrect'], 45000, lang);
}

/** dump.pm2 的状态（存在与否 / 时间 / 条目数），用于界面提示 */
function dumpInfo() {
  const home = process.env.PM2_HOME || path.join(os.homedir(), '.pm2');
  const file = path.join(home, 'dump.pm2');
  try {
    const st = fs.statSync(file);
    let count = 0;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      count = Array.isArray(parsed) ? parsed.length : 0;
    } catch (_) { /* 内容损坏时只报存在 */ }
    return { exists: true, file, mtime: st.mtimeMs, size: st.size, count };
  } catch (_) {
    return { exists: false, file, mtime: null, size: 0, count: 0 };
  }
}

/** 实时日志流 */
function logStream(name, onData, onEnd) {
  const { file, args } = resolveCommand(['logs', name, '--raw']);
  const child = spawn(file, args, {
    env: { ...process.env, PM2_COLORS: 'false', FORCE_COLOR: '0' },
  });
  const push = (buf, kind) => {
    const text = buf.toString();
    for (const line of text.split('\n')) {
      const clean = line.replace(/\x1B\[[0-9;]*[mGKH]/g, '').replace(/^\d+\| /, '');
      if (clean.trim()) onData(clean, kind);
    }
  };
  child.stdout.on('data', (b) => push(b, 'out'));
  child.stderr.on('data', (b) => push(b, 'err'));
  child.on('close', () => onEnd && onEnd());
  return child;
}

module.exports = {
  run,
  isAvailable,
  rawList,
  action,
  startTarget,
  logs,
  logStream,
  getPm2Bin,
  applyArgs,
  startDefinition,
  save,
  resurrect,
  dumpInfo,
};
