'use strict';

/**
 * 任务清单（应用定义）持久化
 * ------------------------------------------------------------------
 * 面板不再只是 pm2 的透传：把每个任务的启动参数落盘，
 * 于是即便出现下面两种情况，也能一键按原参数把任务拉起来：
 *
 *   1. 用户在面板上点了「删除」——pm2 彻底忘了这个任务（含 --port / -c "..." 这类参数）；
 *   2. pm2 守护进程被重新拉起（版本不符、pm2 kill、机器重启）——内存里的列表被清空。
 *
 * 落盘位置：PM2_UI_DATA_DIR/apps.json，默认 ~/.pm2-ui/apps.json
 * （放在 home 下而不是包目录里，这样 npm 升级 pm2-ui 不会把任务清单冲掉）
 *
 * 定义来源 source 三种：
 *   panel     —— 通过面板「启动新进程」创建，参数由面板记录
 *   harvested —— 终端里 `pm2 start` 起的，面板从 jlist 反推参数自动收录
 *   manual    —— 用户在面板里手工编辑/校对过，pm2 不会再覆盖它
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = process.env.PM2_UI_DATA_DIR || path.join(os.homedir(), '.pm2-ui');
const FILE = path.join(DATA_DIR, 'apps.json');
const VERSION = 1;

let cache = null;

/* ------------------------------ 基础读写 ------------------------------ */

function empty() {
  return { version: VERSION, updatedAt: Date.now(), apps: {} };
}

function str(v) {
  return v == null ? '' : String(v);
}

/** 把外部数据整形成统一结构，兼容缺字段 / 旧格式 */
function normalize(a) {
  const target = str(a.target || a.script);
  return {
    name: str(a.name),
    target,
    script: target,
    args: Array.isArray(a.args) ? a.args.map(str) : (a.args ? [str(a.args)] : []),
    cwd: str(a.cwd),
    port: str(a.port),
    interpreter: str(a.interpreter),
    instances: Number(a.instances) || 1,
    execMode: str(a.execMode),
    note: str(a.note),
    source: ['panel', 'harvested', 'manual'].includes(a.source) ? a.source : 'harvested',
    createdAt: Number(a.createdAt) || Date.now(),
    updatedAt: Number(a.updatedAt) || Date.now(),
    lastSeen: Number(a.lastSeen) || 0,
    lastStatus: str(a.lastStatus),
    lastStarted: Number(a.lastStarted) || 0,
  };
}

function load() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const src = Array.isArray(raw) ? raw : (raw.apps || {});
    const list = Array.isArray(src) ? src : Object.values(src);
    const apps = {};
    for (const a of list) {
      if (a && a.name) apps[String(a.name)] = normalize(a);
    }
    cache = { version: VERSION, updatedAt: Number(raw.updatedAt) || Date.now(), apps };
  } catch (_) {
    cache = empty();
  }
  return cache;
}

/** 直接覆盖写（不用 tmp+rename：部分受限环境不允许 rename 覆盖已存在文件） */
function persist() {
  const s = load();
  s.updatedAt = Date.now();
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(s, null, 2));
  } catch (_) {
    /* 落盘失败不影响面板主流程 */
  }
  return s;
}

/* ------------------------------ 对外接口 ------------------------------ */

/** 全部定义，按名称排序 */
function list() {
  const s = load();
  return Object.values(s.apps).sort((a, b) => a.name.localeCompare(b.name));
}

function get(name) {
  return load().apps[name] || null;
}

/**
 * 写入 / 更新一条定义
 * @param {string} name
 * @param {object} patch 只覆盖传入的字段
 * @param {string} [defaultSource] 新建时的来源
 */
function upsert(name, patch = {}, defaultSource = 'manual') {
  const s = load();
  const prev = s.apps[name];
  const merged = normalize({
    ...(prev || {}),
    ...patch,
    name,
    createdAt: prev ? prev.createdAt : Date.now(),
    updatedAt: Date.now(),
    source: patch.source || (prev ? prev.source : defaultSource),
  });
  s.apps[name] = merged;
  persist();
  return merged;
}

function remove(name) {
  const s = load();
  if (!s.apps[name]) return false;
  delete s.apps[name];
  persist();
  return true;
}

/** 轻量打点，不参与「是否被用户编辑过」的判定 */
function touch(name, patch = {}) {
  const s = load();
  const a = s.apps[name];
  if (!a) return null;
  Object.assign(a, patch);
  persist();
  return a;
}

/**
 * 从 pm2 进程列表反向收录定义。
 * 用户手工编辑过的（source=manual）只更新存活状态，不覆盖参数。
 * 只在「定义或状态真的变了」时才落盘 —— 前端 3 秒刷新一次，不能每次刷都写盘。
 * @param {Array<object>} processes fmtProcess 之后的进程数组
 * @returns {number} 新收录的任务数
 */
function harvest(processes) {
  if (!Array.isArray(processes) || !processes.length) return 0;
  const s = load();
  let learned = 0;
  let changed = false;

  /** 定义类的字段：这些一变就要写盘 */
  const DEF_KEYS = ['target', 'cwd', 'port', 'interpreter', 'instances', 'execMode'];

  for (const p of processes) {
    if (!p || !p.name) continue;
    const prev = s.apps[p.name];

    if (!prev) {
      s.apps[p.name] = normalize({
        name: p.name,
        target: p.script || '',
        args: Array.isArray(p.args) ? p.args : [],
        cwd: p.cwd || '',
        port: p.declaredPort || '',
        interpreter: p.interpreter || '',
        instances: p.instances || 1,
        execMode: p.execMode || '',
        source: 'harvested',
        lastSeen: Date.now(),
        lastStatus: p.status,
      });
      learned++;
      changed = true;
      continue;
    }

    // 用户手改过的定义：只跟状态，不动参数
    if (prev.source === 'manual') {
      prev.lastSeen = Date.now();
      if (prev.lastStatus !== p.status) { prev.lastStatus = p.status; changed = true; }
      continue;
    }

    const next = {
      target: p.script || prev.target,
      args: Array.isArray(p.args) ? p.args.map(String) : prev.args,
      cwd: p.cwd || prev.cwd,
      port: p.declaredPort || prev.port,
      interpreter: p.interpreter || prev.interpreter,
      instances: p.instances || prev.instances,
      execMode: p.execMode || prev.execMode,
    };

    const defChanged = DEF_KEYS.some((k) => String(prev[k] ?? '') !== String(next[k] ?? ''))
      || JSON.stringify(prev.args) !== JSON.stringify(next.args);

    if (defChanged) {
      Object.assign(prev, next, { script: next.target, updatedAt: Date.now() });
      changed = true;
    }

    prev.lastSeen = Date.now();
    if (prev.lastStatus !== p.status) { prev.lastStatus = p.status; changed = true; }
  }

  if (changed) persist();
  return learned;
}

/**
 * 真正要传给脚本的参数。
 * 规则统一：显式 args 优先；args 为空而声明了 port 时，合成 --port。
 * toPm2Args / describeCommand / 面板「启动新进程」都走这一条，保证"记录什么就恢复什么"。
 */
function effectiveArgs(def) {
  const args = Array.isArray(def.args) ? def.args.map(str).filter((s) => s !== '') : [];
  if (args.length) return args;
  return def.port ? ['--port', str(def.port)] : [];
}

/**
 * 由定义还原一条 `pm2 start` 命令的参数数组。
 * 顺序必须是：pm2 start <target> [选项] -- [脚本参数]
 */
function toPm2Args(def) {
  const target = def.target || def.script;
  if (!target) throw new Error('任务「' + def.name + '」缺少启动目标（脚本路径）');

  const args = ['start', target];
  if (def.name) args.push('--name', def.name);
  if (def.cwd) args.push('--cwd', def.cwd);
  if (def.interpreter) args.push('--interpreter', def.interpreter);
  if (Number(def.instances) > 1) args.push('-i', String(def.instances));
  const extra = effectiveArgs(def);
  if (extra.length) args.push('--', ...extra);
  return args;
}

/** 便于界面展示的可读命令 */
function describeCommand(def) {
  const q = (s) => (/[\s"'$`\\|&;<>()*?[\]{}!#~]/.test(s) ? JSON.stringify(s) : s);
  const parts = ['pm2', 'start', q(def.target || def.script || '')];
  if (def.name) parts.push('--name', q(def.name));
  if (def.cwd) parts.push('--cwd', q(def.cwd));
  if (def.interpreter) parts.push('--interpreter', q(def.interpreter));
  if (Number(def.instances) > 1) parts.push('-i', String(def.instances));
  const extra = effectiveArgs(def);
  if (extra.length) parts.push('--', ...extra.map(q));
  return parts.join(' ');
}

/** 仅测试/调试用：丢掉内存缓存 */
function reset() {
  cache = null;
}

module.exports = {
  FILE,
  DATA_DIR,
  list,
  get,
  upsert,
  remove,
  touch,
  harvest,
  toPm2Args,
  describeCommand,
  reset,
};
