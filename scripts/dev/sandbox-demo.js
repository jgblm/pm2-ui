#!/usr/bin/env node
'use strict';

/**
 * sandbox-demo —— 演示/自测用的小型进程管家（不是应用运行时的一部分）
 * ------------------------------------------------------------------
 * 在 pm2 守护进程无法常驻的环境里，负责真正把 demo 脚本跑起来，并把 PID 登记到
 * mock-pm2 的 state 文件里，让管理台能读到、能探测、能跳转、能停止和重启。
 *
 * 用法：node scripts/dev/sandbox-demo.js
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const STATE_FILE = process.env.MOCK_PM2_STATE || path.join(ROOT, 'data', '.mock-pm2.json');
const LIVE_FILE = path.join(path.dirname(STATE_FILE), '.mock-pm2-live.json');
const PRELOAD = path.join(__dirname, 'stats-preload.js');
const LOG_DIR = path.join(ROOT, 'data', 'logs');

const APPS = [
  { name: 'demo-api-server', script: 'demo/api-server.js', port: 3101 },
  { name: 'demo-dashboard', script: 'demo/dashboard.js', port: 3102 },
  { name: 'demo-worker', script: 'demo/worker.js', port: null },
];

fs.mkdirSync(LOG_DIR, { recursive: true });
fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) { return { procs: {} }; }
}
function writeState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}
function writeLive(obj) {
  fs.writeFileSync(LIVE_FILE, JSON.stringify(obj));
}
function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

const children = new Map();

function startApp(app) {
  const out = path.join(LOG_DIR, app.name + '-out.log');
  const err = path.join(LOG_DIR, app.name + '-err.log');
  fs.writeFileSync(out, '');
  fs.writeFileSync(err, '');

  const args = [path.join(ROOT, app.script)];
  if (app.port) args.push('--port', String(app.port));

  const fdOut = fs.openSync(out, 'a');
  const fdErr = fs.openSync(err, 'a');
  const child = spawn(process.execPath, ['-r', PRELOAD, ...args], {
    cwd: ROOT,
    env: { ...process.env, PORT: app.port ? String(app.port) : '' },
    stdio: ['ignore', fdOut, fdErr, 'ipc'],
  });

  // 子进程通过 IPC 上报真实 RSS / CPU
  child.on('message', (m) => {
    if (!m || typeof m.rss !== 'number') return;
    const live = (() => { try { return JSON.parse(fs.readFileSync(LIVE_FILE, 'utf8')); } catch (_) { return {}; } })();
    live[app.name] = m;
    writeLive(live);
  });

  children.set(app.name, child);
  console.log(`[supervisor] 启动 ${app.name} → pid ${child.pid}${app.port ? ' :' + app.port : ''}`);
  return child.pid;
}

/* 初始化 state */
const st = readState();
APPS.forEach((app, i) => {
  const out = path.join(LOG_DIR, app.name + '-out.log');
  const err = path.join(LOG_DIR, app.name + '-err.log');
  if (!st.procs[app.name]) {
    st.procs[app.name] = {
      name: app.name, pm_id: i, script: path.join(ROOT, app.script), cwd: ROOT,
      args: [], port: app.port, desired: 'online', pid: 0, restart_time: 0,
      created_at: Date.now(), pm_uptime: Date.now(), out, err,
    };
  }
  st.procs[app.name].port = app.port;
  st.procs[app.name].out = out;
  st.procs[app.name].err = err;
});
writeState(st);

/* 对账循环：让真实进程状态向 desired 靠拢 */
function reconcile() {
  const s = readState();
  let dirty = false;
  for (const app of APPS) {
    const p = s.procs[app.name];
    if (!p) continue;
    const running = alive(p.pid) && children.has(app.name);

    if (p.desired === 'online' && !running) {
      if (p.pid && alive(p.pid)) { try { process.kill(p.pid, 'SIGTERM'); } catch (_) {} }
      p.pid = startApp(app);
      p.pm_uptime = Date.now();
      dirty = true;
    } else if (p.desired === 'stopped' && running) {
      try { children.get(app.name).kill('SIGTERM'); } catch (_) {}
      children.delete(app.name);
      p.pid = 0;
      dirty = true;
    }
  }
  if (dirty) writeState(s);
}

reconcile();
const timer = setInterval(reconcile, 1500);

function shutdown() {
  clearInterval(timer);
  for (const c of children.values()) { try { c.kill('SIGTERM'); } catch (_) {} }
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

console.log('[supervisor] 演示进程管家已就绪，state →', STATE_FILE);
