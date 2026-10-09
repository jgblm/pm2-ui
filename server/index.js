'use strict';

/**
 * PM2 进程与端口监控 — 服务端
 * ------------------------------------------------------------------
 * 一个轻量的本地控制台：把 pm2 的进程列表搬进浏览器，
 * 并自动探测每个进程监听的 TCP 端口。
 *
 * 既可以 `node server/index.js` 直接跑，也可以被 bin/pm2-ui.js 当模块调用：
 *   const { start } = require('./server');  start({ port: 7800 });
 */

const express = require('express');
const path = require('path');
const os = require('os');

const pm2 = require('./pm2');
const { resolvePorts } = require('./ports');

const app = express();
const ROOT = path.join(__dirname, '..');
let listeningPort = Number(process.env.PM2_WEB_PORT || 7799);

/** 本机局域网 IPv4，启动时打印方便访问 */
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
  }
  return out;
}

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(ROOT, 'public'), { etag: false, maxAge: 0 }));

/* --------------------------- 进程数据整理 --------------------------- */

function fmtProcess(proc, endpoints) {
  const env = proc.pm2_env || {};
  const monit = proc.monit || {};
  return {
    name: env.name || proc.name,
    pmId: proc.pm_id,
    pid: proc.pid || null,
    status: env.status || 'unknown',
    cpu: monit.cpu || 0,
    memory: monit.memory || 0,
    restarts: env.restart_time || 0,
    unstableRestarts: env.unstable_restarts || 0,
    uptime: env.pm_uptime || null,
    createdAt: env.created_at || null,
    script: env.pm_exec_path || env.pm_entry_point || '',
    cwd: env.pm_cwd || '',
    execMode: env.exec_mode || '',
    instances: env.instances || 1,
    nodeVersion: env.node_version || '',
    version: env.version || '',
    namespace: env.namespace || 'default',
    watch: !!env.watch,
    outLog: env.pm_out_log_path || '',
    errLog: env.pm_err_log_path || '',
    ...endpoints,
  };
}

let cache = { ts: 0, data: null, error: null };
const CACHE_TTL = 1200;

async function buildProcessList({ force = false } = {}) {
  if (!force && cache.data && Date.now() - cache.ts < CACHE_TTL) return cache;

  let raws;
  try {
    raws = await pm2.rawList();
    cache.error = null;
  } catch (e) {
    cache = { ts: Date.now(), data: [], error: String(e.message || e) };
    return cache;
  }

  const list = await Promise.all(
    raws.map(async (proc) => {
      try {
        return fmtProcess(proc, await resolvePorts(proc));
      } catch (_) {
        return fmtProcess(proc, { pid: proc.pid || null, source: 'none', ports: [], httpPortCount: 0, totalPortCount: 0 });
      }
    })
  );

  list.sort((a, b) => a.pmId - b.pmId);
  cache = { ts: Date.now(), data: list, error: null };
  return cache;
}

/* ------------------------------- API ------------------------------- */

app.get('/api/overview', async (req, res) => {
  const { data, error } = await buildProcessList({ force: req.query.refresh === '1' });
  const status = await pm2.isAvailable();
  res.json({
    pm2: status,
    error,
    serverTime: Date.now(),
    host: os.hostname(),
    platform: `${os.platform()} ${os.release()} (${os.arch()})`,
    lan: lanAddresses(),
    manager: { port: listeningPort, pid: process.pid, node: process.version, uptime: process.uptime() },
    stats: {
      total: data.length,
      online: data.filter((p) => p.status === 'online').length,
      stopped: data.filter((p) => p.status !== 'online').length,
      listening: data.reduce((s, p) => s + (p.ports?.length || 0), 0),
      httpPorts: data.reduce((s, p) => s + (p.httpPortCount || 0), 0),
      cpu: Number(data.reduce((s, p) => s + (p.cpu || 0), 0).toFixed(1)),
      memory: data.reduce((s, p) => s + (p.memory || 0), 0),
    },
  });
});

app.get('/api/processes', async (req, res) => {
  const { data, error } = await buildProcessList({ force: req.query.refresh === '1' });
  res.json({ processes: data, error, serverTime: Date.now() });
});

app.post('/api/processes/:name/:action', async (req, res) => {
  const { name, action } = req.params;
  if (!['start', 'stop', 'restart', 'reload', 'delete', 'reset'].includes(action)) {
    return res.status(400).json({ ok: false, error: '不支持的操作：' + action });
  }
  try {
    const list = await pm2.rawList();
    const exists = list.some((p) => (p.pm2_env?.name || p.name) === name);
    if (!exists) return res.status(404).json({ ok: false, error: `进程 ${name} 不存在` });
    await pm2.action(name, action);
    cache = { ts: 0, data: null, error: null };
    res.json({ ok: true, message: `${name} ${action} 执行成功` });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.get('/api/processes/:name/logs', async (req, res) => {
  const lines = Math.min(Number(req.query.lines || 200), 2000);
  try {
    const data = await pm2.logs(req.params.name, lines, req.query.type || 'all');
    res.json({ ok: true, ...data });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/** 实时日志（SSE 推送），断线自动结束 pm2 logs 子进程 */
app.get('/api/processes/:name/logs/stream', async (req, res) => {
  const name = req.params.name;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');

  const send = (text, kind) => {
    res.write(`data: ${JSON.stringify({ text, kind })}\n\n`);
  };
  send(`—— 开始监听 ${name} 的实时日志 ——`, 'sys');

  const child = pm2.logStream(name, send, () => send('—— 日志流已结束 ——', 'sys'));

  const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(keepAlive);
    try { child.kill('SIGTERM'); } catch (_) { /* ignore */ }
  });
});

app.post('/api/start', async (req, res) => {
  const { target, name, cwd, port } = req.body || {};
  if (!target) return res.status(400).json({ ok: false, error: '请填写要启动的脚本或配置文件路径' });
  try {
    const out = await pm2.startTarget(target, { name, cwd, port });
    cache = { ts: 0, data: null, error: null };
    res.json({ ok: true, message: out || '启动成功' });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/* 生产环境下的兜底路由 */
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

/* ------------------------------- 启动 ------------------------------- */

function banner(port, host) {
  const lines = [
    '',
    '  \x1b[32m▍pm2-ui\x1b[0m  PM2 进程与端口监控  已启动',
    '',
    `  \x1b[1m本机访问\x1b[0m   \x1b[36mhttp://localhost:${port}\x1b[0m`,
  ];
  if (host === '0.0.0.0' || host === '::') {
    for (const ip of lanAddresses()) lines.push(`  \x1b[2m局域网\x1b[0m     http://${ip}:${port}`);
  }
  lines.push('', '  \x1b[2m按 Ctrl+C 退出\x1b[0m', '');
  console.log(lines.join('\n'));
}

/**
 * 启动 HTTP 服务
 * @param {{port?:number, host?:string, quiet?:boolean}} opts
 * @returns {Promise<{server:import('http').Server, port:number, url:string}>}
 */
function start(opts = {}) {
  const port = Number(opts.port || process.env.PM2_WEB_PORT || 7799);
  const host = opts.host || process.env.PM2_WEB_HOST || '127.0.0.1';
  listeningPort = port;

  return new Promise((resolve, reject) => {
    const server = app.listen(port, host);
    server.once('error', (err) => {
      const hint = err.code === 'EADDRINUSE'
        ? `端口 ${port} 已被占用，换一个：pm2-ui --port ${port + 1}`
        : (err.code === 'EACCES' ? `没有权限绑定 ${host}:${port}，换一个高端口试试` : err.message);
      reject(new Error(hint));
    });
    server.once('listening', () => {
      if (!opts.quiet) banner(port, host);
      resolve({ server, port, url: `http://localhost:${port}` });
    });
  });
}

module.exports = { app, start };

// 直接 `node server/index.js` 运行时自动启动
if (require.main === module) {
  start().catch((e) => {
    console.error('\n  \x1b[31m启动失败：\x1b[0m' + e.message + '\n');
    process.exit(1);
  });
}
