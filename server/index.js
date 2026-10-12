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
const store = require('./store');

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

/**
 * 从 pm2 环境变量 / 启动参数里提取"声明式端口"。
 * 注意这跟 resolvePorts 实测到的监听端口不是一回事：
 * 这里拿的是当初启动时声明过的端口，用于还原启动命令。
 */
function declaredPortOf(env) {
  for (const v of [env.PORT, env.SERVER_PORT, env.pm_port]) {
    const n = Number(v);
    if (Number.isInteger(n) && n > 0 && n < 65536) return String(n);
  }
  const args = Array.isArray(env.args) ? env.args.map(String) : [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' || args[i] === '-p') {
      const n = Number(args[i + 1]);
      if (Number.isInteger(n) && n > 0 && n < 65536) return String(n);
    }
    const m = args[i].match(/^--port[=\s]?(\d{1,5})$/);
    if (m) return m[1];
  }
  return '';
}

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
    args: Array.isArray(env.args) ? env.args : [],
    interpreter: env.exec_interpreter && env.exec_interpreter !== 'none' ? env.exec_interpreter : '',
    declaredPort: declaredPortOf(env),
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

  // 顺势把 pm2 里的任务参数回收到任务清单（终端里起的进程也会被收录）
  try { store.harvest(list); } catch (_) { /* 清单落盘失败不影响列表 */ }

  return cache;
}

/** 进程列表缓存作废（任何写操作后调用） */
function invalidate() {
  cache = { ts: 0, data: null, error: null };
}

/** 列表变动后自动持久化 pm2 列表；PM2_UI_AUTOSAVE=0 可关闭 */
const AUTOSAVE = process.env.PM2_UI_AUTOSAVE !== '0';
function autoSave() {
  if (!AUTOSAVE) return;
  pm2.save().catch(() => { /* 自动保存失败不打断用户操作 */ });
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
    dump: pm2.dumpInfo(),
    autosave: AUTOSAVE,
    apps: { total: store.list().length },
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
  const def = store.get(name);
  try {
    const list = await pm2.rawList();
    const exists = list.some((p) => (p.pm2_env?.name || p.name) === name);
    if (!exists) {
      // pm2 已经不认这个进程了：如果任务清单里有它，引导用户走"恢复启动"
      if (def) {
        return res.status(404).json({
          ok: false,
          recoverable: true,
          error: `pm2 里已没有「${name}」，但任务清单里还留着参数，可用「恢复启动」按原参数拉起`,
        });
      }
      return res.status(404).json({ ok: false, error: `进程 ${name} 不存在` });
    }
    await pm2.action(name, action);
    invalidate();
    autoSave();
    if (def) store.touch(name, { lastStatus: action === 'stop' ? 'stopped' : def.lastStatus });
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
  const { target, name, cwd, port, args } = req.body || {};
  if (!target) return res.status(400).json({ ok: false, error: '请填写要启动的脚本或配置文件路径' });

  const providedArgs = Array.isArray(args) ? args.map(String).filter((s) => s !== '') : [];
  try {
    const out = await pm2.startTarget(target, { name, cwd, port, args: providedArgs });
    invalidate();
    autoSave();

    // 关键一步：把启动参数记进任务清单，pm2 忘掉这个任务后还能原样恢复
    if (name) {
      store.upsert(name, {
        target,
        script: target,
        args: providedArgs,
        cwd: cwd || '',
        port: port ? String(port) : '',
        source: 'panel',
      }, 'panel');
    }

    res.json({ ok: true, message: out || '启动成功' });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/* --------------------------- 任务清单 API --------------------------- */

/** 任务清单，并与 pm2 实时状态对照（state: online / stopped / missing） */
app.get('/api/apps', async (req, res) => {
  const { data, error } = await buildProcessList({ force: req.query.refresh === '1' });
  const byName = new Map(data.map((p) => [p.name, p]));

  const apps = store.list().map((def) => {
    const live = byName.get(def.name) || null;
    return {
      ...def,
      state: live ? (live.status === 'online' ? 'online' : 'stopped') : 'missing',
      cmd: store.describeCommand(def),
      live: live ? {
        pid: live.pid,
        pmId: live.pmId,
        status: live.status,
        cpu: live.cpu,
        memory: live.memory,
        restarts: live.restarts,
        uptime: live.uptime,
        ports: live.ports,
        httpPortCount: live.httpPortCount,
      } : null,
    };
  });

  res.json({ ok: true, apps, error, autosave: AUTOSAVE, serverTime: Date.now() });
});

/** 新增 / 编辑任务定义。编辑过的会被标记为 manual，pm2 自动收割不再覆盖参数 */
app.put('/api/apps/:name', (req, res) => {
  const name = req.params.name;
  if (!name) return res.status(400).json({ ok: false, error: '缺少任务名' });
  const b = req.body || {};

  let target;
  if (b.target !== undefined) {
    target = String(b.target).trim();
    if (!target) return res.status(400).json({ ok: false, error: '启动目标不能为空' });
  }

  const app = store.upsert(name, {
    ...(target !== undefined ? { target, script: target } : {}),
    ...(b.args !== undefined
      ? { args: Array.isArray(b.args) ? b.args.map(String) : String(b.args).split(/\s+/).filter(Boolean) }
      : {}),
    ...(b.cwd !== undefined ? { cwd: String(b.cwd).trim() } : {}),
    ...(b.port !== undefined ? { port: String(b.port).trim() } : {}),
    ...(b.note !== undefined ? { note: String(b.note) } : {}),
    source: 'manual',
  }, 'manual');

  res.json({ ok: true, app: { ...app, cmd: store.describeCommand(app) } });
});

/** 按保存的参数启动 —— pm2 已经丢掉这个任务时也能一键恢复 */
app.post('/api/apps/:name/start', async (req, res) => {
  const def = store.get(req.params.name);
  if (!def) return res.status(404).json({ ok: false, error: `任务清单里没有「${req.params.name}」` });
  try {
    const out = await pm2.startDefinition(def);
    store.touch(def.name, { lastStarted: Date.now() });
    invalidate();
    autoSave();
    res.json({ ok: true, message: out || '已按保存的参数启动', cmd: store.describeCommand(def) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/** 从任务清单移除（不动 pm2 里正在跑的进程） */
app.delete('/api/apps/:name', (req, res) => {
  const ok = store.remove(req.params.name);
  res.json({ ok, message: ok ? '已从任务清单移除' : '任务清单里没有这条记录' });
});

/* ---------------------- pm2 列表持久化 / 恢复 ---------------------- */

app.post('/api/pm2/save', async (req, res) => {
  try {
    const out = await pm2.save();
    res.json({ ok: true, message: out || '已保存当前 pm2 列表', dump: pm2.dumpInfo() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.post('/api/pm2/resurrect', async (req, res) => {
  try {
    const out = await pm2.resurrect();
    invalidate();
    res.json({ ok: true, message: out || '已按 dump 恢复进程', dump: pm2.dumpInfo() });
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
