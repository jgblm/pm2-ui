'use strict';

/**
 * 端口监控
 * ------------------------------------------------------------------
 * 目标：给定一个 pm2 进程，列出它真正监听的 TCP 端口，并标注每个端口的用途。
 * 做法：
 *   1. 按 PID 找出该进程 LISTEN 的 TCP 端口（lsof / ss / netstat）；
 *   2. 若拿不到（例如没装 lsof），回退到 pm2 环境变量里声明的端口；
 *   3. 对每个端口发一次 HTTP/HTTPS 探针，判断它是"网页服务"还是
 *      "数据库 / 队列这类只认协议的内部服务"。
 */

const { execFile } = require('child_process');
const http = require('http');
const https = require('https');

function exec(bin, args, timeout = 6000) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? '' : String(stdout || ''));
    });
  });
}

/* ------------------------------- 1. 找端口 ------------------------------- */

/** macOS / Linux：lsof 精确列出某 PID 的监听端口 */
async function portsByLsof(pid) {
  const out = await exec('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-a', '-p', String(pid), '-Fn']);
  const ports = new Set();
  for (const line of out.split('\n')) {
    if (!line.startsWith('n')) continue;
    const name = line.slice(1).trim();          // 形如 *:3000 / 127.0.0.1:5173 / [::1]:8080
    const m = name.match(/:(\d+)$/);
    if (m) ports.add(Number(m[1]));
  }
  return [...ports];
}

/** Linux 兜底：ss */
async function portsBySs(pid) {
  const out = await exec('ss', ['-ltnpH']);
  const ports = new Set();
  for (const line of out.split('\n')) {
    if (!line.includes(`pid=${pid},`)) continue;
    const m = line.match(/:(\d+)\s/);
    if (m) ports.add(Number(m[1]));
  }
  return [...ports];
}

/** Windows：netstat -ano */
async function portsByNetstat(pid) {
  const out = await exec('netstat', ['-ano', '-p', 'TCP']);
  const ports = new Set();
  for (const line of out.split('\n')) {
    const t = line.trim().split(/\s+/);
    if (t.length < 5 || t[3] !== 'LISTENING') continue;
    if (String(t[4]) !== String(pid)) continue;
    const m = t[1].match(/:(\d+)$/);
    if (m) ports.add(Number(m[1]));
  }
  return [...ports];
}

async function listeningPorts(pid) {
  if (!pid) return [];
  try {
    if (process.platform === 'win32') return await portsByNetstat(pid);
    const viaLsof = await portsByLsof(pid);
    if (viaLsof.length) return viaLsof;
    return await portsBySs(pid);          // 有些精简版 Linux 没有 lsof
  } catch (_) {
    return [];
  }
}

/* --------------------------- 2. 判断端口用途 --------------------------- */

function probeOnce(port, secure, timeout) {
  return new Promise((resolve) => {
    const mod = secure ? https : http;
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };

    const req = mod.request(
      {
        host: '127.0.0.1',
        port,
        path: '/',
        method: 'GET',
        timeout,
        rejectUnauthorized: false,
        headers: { 'User-Agent': 'pm2-ui/1.0', Accept: '*/*' },
      },
      (res) => {
        const info = {
          ok: true,
          secure,
          status: res.statusCode,
          server: res.headers['server'] || '',
        };
        res.destroy();
        done(info);
      }
    );
    req.on('timeout', () => { req.destroy(); done({ ok: false, reason: 'timeout' }); });
    req.on('error', (e) => done({ ok: false, reason: e.code || e.message }));
    req.end();
  });
}

/** 先按 http 探，不行再按 https 探 */
async function probeHttp(port, timeout = 900) {
  const plain = await probeOnce(port, false, timeout);
  if (plain.ok) return plain;
  const tls = await probeOnce(port, true, timeout);
  if (tls.ok) return tls;
  return { ok: false, reason: plain.reason || tls.reason || 'no-response' };
}

/* -------------------- 3. 从 pm2 环境变量里找线索 -------------------- */

/** 从 pm2_env 里挖出可能暗示端口 / 协议的字段 */
function hintFromEnv(pm2_env = {}) {
  const env = pm2_env.env || {};
  const hint = { ports: new Set(), secure: false };

  const num = (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
  };

  for (const key of ['PORT', 'port', 'SERVER_PORT', 'HTTP_PORT', 'APP_PORT', 'VITE_PORT']) {
    const n = num(env[key] ?? pm2_env[key]);
    if (n) hint.ports.add(n);
  }

  // 命令行参数里的 --port 3000 / -p 3000
  const args = [pm2_env.args, pm2_env.pm_exec_path, pm2_env.script || ''].filter(Boolean).join(' ');
  for (const m of args.matchAll(/--port[= ](\d{2,5})|(?:^|\s)-p[= ](\d{2,5})/g)) {
    const n = num(m[1] || m[2]);
    if (n) hint.ports.add(n);
  }

  const proto = String(env.PROTOCOL || env.SCHEME || env.HTTPS || '').toLowerCase();
  if (proto === 'https' || proto === 'true' || proto === '1') hint.secure = true;

  return hint;
}

/* --------------------------- 组合：拿一个进程的端口清单 --------------------------- */

// 这些端口几乎一定是中间件而不是业务 Web 服务，展示时降级排序
const INFRA_PORTS = new Set([22, 3306, 5432, 6379, 27017, 9200, 11211, 5672, 9092, 1883]);

const probeCache = new Map();   // `${pid}:${port}` -> { ts, result }
const PROBE_TTL = 20000;

async function probeCached(pid, port) {
  const key = `${pid}:${port}`;
  const hit = probeCache.get(key);
  if (hit && Date.now() - hit.ts < PROBE_TTL) return hit.result;
  const result = await probeHttp(port);
  probeCache.set(key, { ts: Date.now(), result });
  return result;
}

/**
 * 主入口：解析一个 pm2 进程监听的端口
 * @returns {Promise<{pid:number|null, ports:Array, httpPortCount:number, totalPortCount:number, source:string}>}
 */
async function resolvePorts(proc) {
  const env = proc.pm2_env || {};
  const pid = proc.pid;
  const online = env.status === 'online';
  const hint = hintFromEnv(env);

  let ports = await listeningPorts(pid);
  const detected = ports.length > 0;

  // 进程没在监听（或没有 lsof）时，退回到环境变量里声明的端口
  if (!ports.length) ports = [...hint.ports];
  const source = detected ? 'detected' : (ports.length ? 'env' : 'none');

  const rows = [];
  for (const port of ports) {
    // 进程没运行时不发探测请求，直接标注，避免出现"连接被拒"这种误导性描述
    if (!online) {
      rows.push({
        port,
        protocol: hint.secure ? 'https' : 'tcp',
        kind: 'tcp',
        verified: false,
        status: null,
        server: '',
        reason: 'stopped',
        source,
        infra: INFRA_PORTS.has(port),
      });
      continue;
    }

    const pr = await probeCached(pid || proc.name || 'x', port);
    const secure = pr.ok ? !!pr.secure : hint.secure;
    const protocol = secure ? 'https' : 'http';
    rows.push({
      port,
      protocol,
      kind: pr.ok ? 'web' : 'tcp',
      verified: !!pr.ok,
      // 只有真正响应 HTTP 的端口才给可打开的地址
      url: pr.ok ? `${protocol}://localhost:${port}` : null,
      status: pr.ok ? pr.status : null,
      server: pr.server || '',
      reason: pr.ok ? null : pr.reason || null,
      source,
      infra: INFRA_PORTS.has(port),
    });
  }

  // Web 端口排前面；中间件端口排最后
  rows.sort((a, b) => (b.verified - a.verified) || (a.infra - b.infra) || (a.port - b.port));

  return {
    pid: pid || null,
    source,
    ports: rows,
    httpPortCount: rows.filter((r) => r.verified).length,
    totalPortCount: rows.length,
  };
}

module.exports = { listeningPorts, probeHttp, hintFromEnv, resolvePorts };
