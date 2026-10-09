#!/usr/bin/env node
'use strict';

/**
 * mock-pm2 —— 开发自测用的 pm2 替身（不是应用运行时的一部分）
 * ------------------------------------------------------------------
 * 为什么需要它：
 *   某些环境（CI、容器沙箱）不允许 pm2 的守护进程常驻，`pm2 start` 会失效。
 *   这个替身不托管任何进程，只按 state 文件里登记的 PID 输出与 pm2 完全兼容的
 *   `jlist` JSON，并把 start/stop/restart/delete 翻译成对 state 的"期望状态"变更，
 *   由 supervisor（scripts/dev/sandbox-demo.js）负责真正的进程起停。
 *
 * 用法：
 *   PM2_BIN=/abs/path/scripts/dev/mock-pm2.js \
 *   MOCK_PM2_STATE=/abs/path/data/.mock-pm2.json \
 *   node server/index.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const STATE_FILE = process.env.MOCK_PM2_STATE || path.join(ROOT, 'data', '.mock-pm2.json');
const LIVE_FILE = path.join(path.dirname(STATE_FILE), '.mock-pm2-live.json');

function readLive() {
  try { return JSON.parse(fs.readFileSync(LIVE_FILE, 'utf8')); } catch (_) { return {}; }
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (_) {
    return { procs: {} };
  }
}

function writeState(s) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

/** 读取真实 CPU / 内存：优先用 supervisor 通过 IPC 上报的实时值，其次退回 ps */
function usage(p) {
  const pid = p.pid;
  if (!alive(pid)) return { cpu: 0, memory: 0 };

  const live = readLive()[p.name];
  if (live && live.at && Date.now() - live.at < 8000) {
    return { cpu: live.cpu || 0, memory: live.rss || 0 };
  }

  try {
    const out = execFileSync('ps', ['-p', String(pid), '-o', '%cpu=,rss='], { encoding: 'utf8' }).trim();
    const [cpu, rss] = out.split(/\s+/).map(Number);
    return { cpu: Number.isFinite(cpu) ? cpu : 0, memory: (Number.isFinite(rss) ? rss : 0) * 1024 };
  } catch (_) {
    return { cpu: 0, memory: 0 };
  }
}

function realStatus(p) {
  return p.desired === 'online' && alive(p.pid) ? 'online' : 'stopped';
}

/* ------------------------------ jlist ------------------------------ */

function jlist() {
  const s = readState();
  const list = Object.values(s.procs).map((p, i) => {
    const status = realStatus(p);
    const u = usage(p);
    return {
      pid: status === 'online' ? p.pid : 0,
      name: p.name,
      pm_id: p.pm_id != null ? p.pm_id : i,
      monit: { memory: u.memory, cpu: u.cpu },
      pm2_env: {
        name: p.name,
        status,
        namespace: p.namespace || 'default',
        pm_exec_path: p.script,
        pm_cwd: p.cwd,
        pm_entry_point: path.basename(p.script),
        args: p.args || [],
        exec_mode: 'fork_mode',
        instances: 1,
        node_version: process.version.replace(/^v/, ''),
        version: p.version || '1.0.0',
        restart_time: p.restart_time || 0,
        unstable_restarts: 0,
        pm_uptime: status === 'online' ? p.pm_uptime : 0,
        created_at: p.created_at,
        watch: false,
        pm_out_log_path: p.out,
        pm_err_log_path: p.err,
        env: { PORT: String(p.port || ''), ...(p.env || {}) },
      },
    };
  });
  process.stdout.write(JSON.stringify(list));
}

/* ------------------------------ 动作 ------------------------------ */

function findProc(s, name) {
  if (!name) return null;
  return s.procs[name] || Object.values(s.procs).find((p) => p.name === name) || null;
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (cmd === '--version' || cmd === '-v') return process.stdout.write('5.4.3');

  if (cmd === 'jlist') return jlist();

  if (cmd === 'save') return process.stdout.write('[PM2] Saving current process list...\n');

  if (cmd === 'logs') {
    const name = argv[1];
    const s = readState();
    const p = findProc(s, name);
    if (!p) { process.stderr.write(`[PM2][ERROR] Process ${name} not found\n`); process.exit(1); }
    const li = argv.indexOf('--lines');
    const lines = li >= 0 ? Number(argv[li + 1]) || 100 : 100;
    const pick = (f) => {
      try { return fs.readFileSync(f, 'utf8').split('\n').slice(-lines).join('\n'); } catch (_) { return ''; }
    };
    const onlyOut = argv.includes('--out');
    const onlyErr = argv.includes('--err');
    let text = '';
    if (!onlyErr) text += pick(p.out);
    if (!onlyOut) text += '\n' + pick(p.err);
    return process.stdout.write(text);
  }

  const s = readState();

  if (cmd === 'start') {
    const target = argv[1];
    if (target === 'all' || argv.includes('--only')) return process.stdout.write('[PM2] Done.\n');
    const ni = argv.indexOf('--name');
    const name = ni >= 0 ? argv[ni + 1] : path.basename(target, path.extname(target));
    const script = path.resolve(ROOT, target);
    if (!s.procs[name]) {
      s.procs[name] = {
        name, pm_id: Object.keys(s.procs).length, script,
        cwd: path.dirname(script), args: argv.slice(argv.indexOf('--') + 1),
        port: null, desired: 'online', pid: 0, restart_time: 0,
        created_at: Date.now(), pm_uptime: Date.now(),
        out: path.join(ROOT, 'data', 'logs', name + '-out.log'),
        err: path.join(ROOT, 'data', 'logs', name + '-err.log'),
      };
    }
    s.procs[name].desired = 'online';
    writeState(s);
    return process.stdout.write('[PM2] Done.\n');
  }

  if (cmd === 'delete' && argv[1] === 'all') {
    for (const p of Object.values(s.procs)) if (alive(p.pid)) { try { process.kill(p.pid); } catch (_) {} }
    s.procs = {};
    writeState(s);
    return process.stdout.write('[PM2] All processes deleted\n');
  }

  if (['stop', 'restart', 'reload', 'delete', 'reset'].includes(cmd)) {
    const name = argv[1];
    const p = findProc(s, name);
    if (!p) { process.stderr.write(`[PM2][ERROR] Process ${name} not found\n`); process.exit(1); }

    if (cmd === 'stop') {
      p.desired = 'stopped';
      if (alive(p.pid)) { try { process.kill(p.pid, 'SIGTERM'); } catch (_) {} }
    } else if (cmd === 'restart' || cmd === 'reload') {
      p.desired = 'online';
      p.restart_time = (p.restart_time || 0) + 1;
      p.pm_uptime = Date.now();
      if (alive(p.pid)) { try { process.kill(p.pid, 'SIGTERM'); } catch (_) {} }
    } else if (cmd === 'reset') {
      p.restart_time = 0;
    } else if (cmd === 'delete') {
      if (alive(p.pid)) { try { process.kill(p.pid, 'SIGTERM'); } catch (_) {} }
      delete s.procs[p.name];
    }
    writeState(s);
    return process.stdout.write(`[PM2] ${cmd} ${name} ✓\n`);
  }

  process.stderr.write(`[mock-pm2] 未实现的命令: ${argv.join(' ')}\n`);
  process.exit(1);
}

main();
