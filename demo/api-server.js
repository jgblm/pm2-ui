'use strict';
/* 演示进程 1：一个真实的 HTTP API 服务（监听 3101），用于展示"自动探测 Web 地址"
   Demo process #1: a real HTTP API server (listens on 3101) that shows
   the "auto-detected web address" feature. The page follows the browser language. */

const http = require('http');
const os = require('os');

const PORT = Number(process.env.PORT || 3101);

const TEXT = {
  'zh-CN': {
    lang: 'zh-CN',
    running: '● 运行中',
    intro: (port) => `这是由 <code>pm2</code> 托管的演示服务。管理台通过 <code>lsof</code> 探测到它监听的 <code>${port}</code> 端口，
     并验证其返回 HTTP 响应，于是生成了你刚刚点击的那个链接。`,
    pid: '进程 PID',
    port: '监听端口',
    host: '主机名',
    node: 'Node 版本',
    uptime: '运行时长',
    seconds: (s) => `${s} 秒`,
    tryApi: '试试接口：',
  },
  'en-US': {
    lang: 'en-US',
    running: '● Running',
    intro: (port) => `This is a demo service managed by <code>pm2</code>. The dashboard used <code>lsof</code> to discover
     the port it listens on (<code>${port}</code>) and confirmed it answers HTTP — that is how the link you just clicked was created.`,
    pid: 'Process PID',
    port: 'Listening port',
    host: 'Hostname',
    node: 'Node version',
    uptime: 'Uptime',
    seconds: (s) => `${s}s`,
    tryApi: 'Try the API:',
  },
};

function langOf(req) {
  const header = String(req.headers['accept-language'] || '').toLowerCase();
  return header.includes('zh') ? 'zh-CN' : 'en-US';
}

const page = (T) => `<!DOCTYPE html>
<html lang="${T.lang}"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Demo API Server</title>
<style>
  body{margin:0;font-family:-apple-system,"PingFang SC",sans-serif;background:#0f1218;color:#e8ecf3;
       min-height:100vh;display:grid;place-items:center}
  .box{background:#171c26;border:1px solid #262e3b;border-radius:16px;padding:34px 38px;max-width:520px}
  h1{margin:0 0 6px;font-size:22px}
  .tag{display:inline-block;font-size:12px;background:#12321f;color:#5ce08a;padding:3px 10px;border-radius:99px;margin-bottom:16px}
  code{background:#0d1117;padding:2px 7px;border-radius:6px;font-family:ui-monospace,Menlo,monospace;font-size:13px}
  p{color:#98a3b5;line-height:1.7;font-size:14px}
  .row{display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid #232b38;font-size:13px}
  .row:last-child{border:0}
  .row span:first-child{color:#7b8698}
  a{color:#5b9dff}
</style></head>
<body><div class="box">
  <div class="tag">${T.running}</div>
  <h1>Demo API Server</h1>
  <p>${T.intro(PORT)}</p>
  <div class="row"><span>${T.pid}</span><span>${process.pid}</span></div>
  <div class="row"><span>${T.port}</span><span>${PORT}</span></div>
  <div class="row"><span>${T.host}</span><span>${os.hostname()}</span></div>
  <div class="row"><span>${T.node}</span><span>${process.version}</span></div>
  <div class="row"><span>${T.uptime}</span><span>${T.seconds(Math.floor(process.uptime()))}</span></div>
  <p style="margin-top:20px">${T.tryApi}<a href="/api/status">/api/status</a> · <a href="/api/time">/api/time</a></p>
</div></body></html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      ok: true, service: 'demo-api-server', pid: process.pid, port: PORT,
      uptime: process.uptime(), memory: process.memoryUsage().rss, time: new Date().toISOString(),
    }, null, 2));
  }
  if (url.pathname === '/api/time') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ now: new Date().toString() }));
  }
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('OK');
  }

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(page(TEXT[langOf(req)]));
});

server.listen(PORT, () => {
  console.log(`[demo-api-server] listening → http://localhost:${PORT}  (pid ${process.pid})`);
});

// 每隔一段时间打点日志，方便在管理台里看"实时日志"效果
// Periodic heartbeat so the dashboard live-log drawer has something to show.
let n = 0;
setInterval(() => {
  n++;
  console.log(`[demo-api-server] heartbeat #${n} rss=${(process.memoryUsage().rss / 1048576).toFixed(1)}MB`);
  if (n % 7 === 0) console.error(`[demo-api-server] sample error log #${n}`);
}, 8000);

process.on('SIGINT', () => { server.close(() => process.exit(0)); });
