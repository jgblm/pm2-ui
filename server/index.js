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
const updater = require('./update');
const i18n = require('./i18n');
const pkg = require('../package.json');

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

/** 每个请求绑定一个本地化函数：req.t(key, params) */
app.use((req, res, next) => {
  req.lang = i18n.resolveLang(req);
  req.t = i18n.translator(req.lang);
  next();
});

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

async function buildProcessList({ force = false, lang } = {}) {
  if (!force && cache.data && Date.now() - cache.ts < CACHE_TTL) return cache;

  let raws;
  try {
    raws = await pm2.rawList(lang);
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
  const { data, error } = await buildProcessList({ force: req.query.refresh === '1', lang: req.lang });
  const status = await pm2.isAvailable();
  res.json({
    pm2: status,
    error,
    serverTime: Date.now(),
    host: os.hostname(),
    platform: `${os.platform()} ${os.release()} (${os.arch()})`,
    lan: lanAddresses(),
    manager: {
      port: listeningPort,
      pid: process.pid,
      node: process.version,
      uptime: process.uptime(),
      version: pkg.version,
    },
    update: { autoCheck: updater.AUTO_CHECK, info: updater.cached() },
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
  const { data, error } = await buildProcessList({ force: req.query.refresh === '1', lang: req.lang });
  res.json({ processes: data, error, serverTime: Date.now() });
});

app.post('/api/processes/:name/:action', async (req, res) => {
  const { name, action } = req.params;
  const t = req.t;
  if (!['start', 'stop', 'restart', 'reload', 'delete', 'reset'].includes(action)) {
    return res.status(400).json({ ok: false, error: t('api.unsupportedAction', { action }) });
  }
  const def = store.get(name);
  try {
    const list = await pm2.rawList(req.lang);
    const liveRaw = list.find((p) => (p.pm2_env?.name || p.name) === name);
    if (!liveRaw) {
      // pm2 已经不认这个进程了：如果任务清单里有它，引导用户走"恢复启动"
      if (def) {
        return res.status(404).json({
          ok: false,
          recoverable: true,
          error: t('api.processGoneRecoverable', { name }),
        });
      }
      return res.status(404).json({ ok: false, error: t('api.processNotFound', { name }) });
    }

    // 启动 / 重启：pm2 只会照搬它内存里的旧参数，任务清单里的定义若已经和
    // 正在跑的进程不一致（比如刚在卡片上编辑过命令），必须先删后建才生效。
    const rebuild = ['start', 'restart'].includes(action)
      && store.needsRebuild(def, fmtProcess(liveRaw, {}));

    if (rebuild) await pm2.rebuildFromDefinition(def, req.lang);
    else await pm2.action(name, action, req.lang);

    invalidate();
    autoSave();
    if (def) store.touch(name, { lastStatus: action === 'stop' ? 'stopped' : def.lastStatus });
    res.json({ ok: true, message: t('api.actionOk', { name, action }) });
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
  send(req.t('log.streamStart', { name }), 'sys');

  const child = pm2.logStream(name, send, () => send(req.t('log.streamEnd'), 'sys'));

  const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(keepAlive);
    try { child.kill('SIGTERM'); } catch (_) { /* ignore */ }
  });
});

app.post('/api/start', async (req, res) => {
  const { target, name, cwd, port, args } = req.body || {};
  const t = req.t;
  if (!target) return res.status(400).json({ ok: false, error: t('api.needTarget') });

  const providedArgs = Array.isArray(args) ? args.map(String).filter((s) => s !== '') : [];
  try {
    const out = await pm2.startTarget(target, { name, cwd, port, args: providedArgs, lang: req.lang });
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

    res.json({ ok: true, message: out || t('api.startOk') });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/* --------------------------- 任务清单 API --------------------------- */

/** 任务清单，并与 pm2 实时状态对照（state: online / stopped / missing） */
app.get('/api/apps', async (req, res) => {
  const { data, error } = await buildProcessList({ force: req.query.refresh === '1', lang: req.lang });
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

  res.json({
    ok: true,
    apps,
    order: apps.map((a) => a.name),   // 用户拖出来的显示顺序
    error,
    autosave: AUTOSAVE,
    serverTime: Date.now(),
  });
});

/** 保存拖动排序后的显示顺序 */
app.post('/api/apps/order', (req, res) => {
  const order = req.body && req.body.order;
  if (!Array.isArray(order)) {
    return res.status(400).json({ ok: false, error: req.t('api.invalidOrder') });
  }
  const saved = store.setOrder(order);
  res.json({ ok: true, order: saved });
});

/** 新增 / 编辑任务定义。编辑过的会被标记为 manual，pm2 自动收割不再覆盖参数 */
app.put('/api/apps/:name', async (req, res) => {
  const name = req.params.name;
  const t = req.t;
  if (!name) return res.status(400).json({ ok: false, error: t('api.needName') });
  const b = req.body || {};

  let target;
  if (b.target !== undefined) {
    target = String(b.target).trim();
    if (!target) return res.status(400).json({ ok: false, error: t('api.emptyTarget') });
  }

  // 名称也可以改：先做格式与查重校验（沿用旧名时不校验格式，避免老进程改不动）
  const nextName = b.name === undefined ? name : String(b.name).trim();
  if (!nextName) return res.status(400).json({ ok: false, error: t('api.needName') });
  const renamed = nextName !== name;
  if (renamed && (nextName.startsWith('-') || /[\s/]/.test(nextName))) {
    return res.status(400).json({ ok: false, error: t('api.invalidName', { name: nextName }) });
  }
  if (renamed && store.get(nextName)) {
    return res.status(409).json({ ok: false, error: t('api.nameExists', { name: nextName }) });
  }

  // pm2 没有"改名"能力，只能先删旧条目再按新名字建；先看看旧名字有没有在跑
  let live = null;
  if (renamed) {
    try {
      const list = await pm2.rawList(req.lang);
      live = list.find((p) => (p.pm2_env?.name || p.name) === name) || null;
    } catch (_) { /* pm2 不可用：只改清单，不动进程 */ }
    store.rename(name, nextName);
  }

  const app = store.upsert(nextName, {
    ...(target !== undefined ? { target, script: target } : {}),
    ...(b.args !== undefined
      ? { args: Array.isArray(b.args) ? b.args.map(String) : String(b.args).split(/\s+/).filter(Boolean) }
      : {}),
    ...(b.cwd !== undefined ? { cwd: String(b.cwd).trim() } : {}),
    ...(b.port !== undefined ? { port: String(b.port).trim() } : {}),
    ...(b.note !== undefined ? { note: String(b.note) } : {}),
    source: 'manual',
  }, 'manual');

  let warning = null;
  let restarted = false;
  if (renamed && live) {
    const wasOnline = ['online', 'launching'].includes(live.pm2_env?.status);
    try {
      await pm2.action(name, 'delete', req.lang);
      // 原来在跑的才重新拉起；本来是停止态的，留着定义等用户「恢复启动」即可
      if (wasOnline) {
        await pm2.startDefinition(app, req.lang);
        restarted = true;
      }
    } catch (e) {
      warning = t('api.renameRebuildFailed', { name: nextName, error: String(e.message || e) });
    }
  }

  if (renamed) {
    invalidate();
    autoSave();
  }

  res.json({
    ok: true,
    app: { ...app, cmd: store.describeCommand(app) },
    renamed: renamed ? { from: name, to: nextName, restarted } : null,
    warning,
  });
});

/** 按保存的参数启动 —— pm2 已经丢掉这个任务时也能一键恢复 */
app.post('/api/apps/:name/start', async (req, res) => {
  const t = req.t;
  const def = store.get(req.params.name);
  if (!def) return res.status(404).json({ ok: false, error: t('api.defNotFound', { name: req.params.name }) });
  try {
    const out = await pm2.startDefinition(def, req.lang);
    store.touch(def.name, { lastStarted: Date.now() });
    invalidate();
    autoSave();
    res.json({ ok: true, message: out || t('api.startedFromDef'), cmd: store.describeCommand(def) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/** 从任务清单移除（不动 pm2 里正在跑的进程） */
app.delete('/api/apps/:name', (req, res) => {
  const ok = store.remove(req.params.name);
  res.json({ ok, message: ok ? req.t('api.removedFromList') : req.t('api.recordNotFound') });
});

/* ---------------------- pm2 列表持久化 / 恢复 ---------------------- */

app.post('/api/pm2/save', async (req, res) => {
  try {
    const out = await pm2.save(req.lang);
    res.json({ ok: true, message: out || req.t('api.savedPm2List'), dump: pm2.dumpInfo() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.post('/api/pm2/resurrect', async (req, res) => {
  try {
    const out = await pm2.resurrect(req.lang);
    invalidate();
    res.json({ ok: true, message: out || req.t('api.resurrected'), dump: pm2.dumpInfo() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/* ------------------------------ 自更新 ------------------------------ */

/** 检查是否有新版本（带缓存，?force=1 强制重查） */
app.get('/api/update/check', async (req, res) => {
  try {
    const info = await updater.check({ force: req.query.force === '1', lang: req.lang });
    res.json({ ok: true, ...info });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

/**
 * 执行自更新，输出以 SSE 流式推送。
 * 用 GET 是因为 EventSource 不支持 POST；因此要求带 confirm=1，
 * 避免被浏览器的预取 / 误访问直接触发一次 npm install。
 */
app.get('/api/update/apply', async (req, res) => {
  if (req.query.confirm !== '1') {
    return res.status(400).json({ ok: false, error: req.t('api.needConfirm') });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');

  let closed = false;
  const send = (payload) => {
    if (closed) return;
    try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch (_) { /* 连接已断 */ }
  };
  const keepAlive = setInterval(() => send({ ping: true }), 15000);
  req.on('close', () => { closed = true; clearInterval(keepAlive); });

  try {
    const out = await updater.apply({ lang: req.lang, onLine: (text, kind) => send({ text, kind }) });
    send({ done: true, ...out });
  } catch (e) {
    send({ done: true, ok: false, error: String(e.message || e) });
  } finally {
    clearInterval(keepAlive);
    if (!closed) res.end();
  }
});

/** 重启面板以加载新版本（pm2 托管时直接 pm2 restart 自己） */
app.post('/api/update/restart', async (req, res) => {
  let name = null;
  try { name = await updater.pm2HostName(); } catch (_) { /* 读不到就当没托管 */ }

  if (!name) {
    return res.json({
      ok: false,
      mode: 'manual',
      message: req.t('api.notPm2Hosted'),
    });
  }

  // 先把响应发出去再重启：pm2 restart 会把本进程换掉，晚一步响应就丢了
  res.json({ ok: true, mode: 'pm2', name, message: req.t('api.pm2RestartTriggered', { name }) });
  setTimeout(() => {
    updater.restartSelf(req.lang).catch(() => { /* 重启失败就让旧进程继续服务 */ });
  }, 600);
});

/* 生产环境下的兜底路由 */
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

/* ------------------------------- 启动 ------------------------------- */

function banner(port, host, lang) {
  const t = i18n.translator(lang || i18n.defaultLang());
  const lines = [
    '',
    '  \x1b[32m▍pm2-ui\x1b[0m  ' + t('server.bannerTitle') + ' \x1b[2mv' + pkg.version + '\x1b[0m',
    '',
    `  \x1b[1m${t('server.local')}\x1b[0m   \x1b[36mhttp://localhost:${port}\x1b[0m`,
  ];
  if (host === '0.0.0.0' || host === '::') {
    for (const ip of lanAddresses()) lines.push(`  \x1b[2m${t('server.lan')}\x1b[0m     http://${ip}:${port}`);
  }
  lines.push('', `  \x1b[2m${t('server.exitHint')}\x1b[0m`, '');
  console.log(lines.join('\n'));
}

/**
 * 启动 HTTP 服务
 * @param {{port?:number, host?:string, quiet?:boolean, lang?:string}} opts
 * @returns {Promise<{server:import('http').Server, port:number, url:string}>}
 */
function start(opts = {}) {
  const port = Number(opts.port || process.env.PM2_WEB_PORT || 7799);
  const host = opts.host || process.env.PM2_WEB_HOST || '127.0.0.1';
  const lang = i18n.normalize(opts.lang) || i18n.defaultLang();
  const t = i18n.translator(lang);
  listeningPort = port;

  return new Promise((resolve, reject) => {
    const server = app.listen(port, host);
    server.once('error', (err) => {
      const hint = err.code === 'EADDRINUSE'
        ? t('server.portInUse', { port, next: port + 1 })
        : (err.code === 'EACCES' ? t('server.permission', { host, port }) : err.message);
      reject(new Error(hint));
    });
    server.once('listening', () => {
      if (!opts.quiet) banner(port, host, lang);
      // 预热一次更新检查：面板一打开就能看到版本 / 更新提示，不阻塞启动
      if (updater.AUTO_CHECK) updater.check().catch(() => { /* 没网也不影响使用 */ });
      resolve({ server, port, url: `http://localhost:${port}` });
    });
  });
}

module.exports = { app, start };

// 直接 `node server/index.js` 运行时自动启动
if (require.main === module) {
  start().catch((e) => {
    console.error('\n  \x1b[31m' + i18n.t('server.startFailed', { message: e.message }) + '\x1b[0m\n');
    process.exit(1);
  });
}
