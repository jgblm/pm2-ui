'use strict';
/* 演示进程 2：一个网页应用（监听 3102），展示另一个可跳转的 Web 地址
   Demo process #2: a web app (listens on 3102) that shows another clickable
   web address. The page follows the browser language. */

const http = require('http');

const PORT = Number(process.env.PORT || 3102);

let hits = 0;
const t0 = Date.now();

const TEXT = {
  'zh-CN': {
    lang: 'zh-CN',
    sub: (port) => `pm2 托管的第二个演示应用 · 端口 ${port}`,
    pid: '进程 PID',
    hits: '访问次数',
    uptime: '运行时长',
    memory: '内存占用',
    refresh: '刷新数据',
  },
  'en-US': {
    lang: 'en-US',
    sub: (port) => `The second demo app managed by pm2 · port ${port}`,
    pid: 'Process PID',
    hits: 'Requests',
    uptime: 'Uptime',
    memory: 'Memory',
    refresh: 'Refresh',
  },
};

function langOf(req) {
  const header = String(req.headers['accept-language'] || '').toLowerCase();
  return header.includes('zh') ? 'zh-CN' : 'en-US';
}

const html = (T) => `<!DOCTYPE html>
<html lang="${T.lang}"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Demo Dashboard</title>
<style>
  body{margin:0;font-family:-apple-system,"PingFang SC",sans-serif;background:#f6f8fb;color:#14181f;
       min-height:100vh;display:grid;place-items:center}
  .box{background:#fff;border:1px solid #e5e9ef;border-radius:18px;padding:36px 40px;max-width:540px;
       box-shadow:0 20px 50px -25px rgba(16,24,40,.25)}
  h1{margin:0 0 6px;font-size:23px;letter-spacing:-.4px}
  .sub{color:#7b8698;font-size:13.5px;margin-bottom:22px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .card{background:#f7f9fc;border:1px solid #e8edf4;border-radius:12px;padding:14px}
  .k{font-size:11px;color:#8792a3;text-transform:uppercase;letter-spacing:.4px;font-weight:700}
  .v{font-size:21px;font-weight:700;margin-top:4px}
  button{margin-top:22px;background:#2f6bff;color:#fff;border:0;border-radius:9px;padding:10px 18px;
         font-size:14px;font-weight:600;cursor:pointer}
  button:hover{background:#215ce8}
</style></head>
<body><div class="box">
  <h1>Demo Dashboard</h1>
  <div class="sub">${T.sub(PORT)}</div>
  <div class="grid">
    <div class="card"><div class="k">${T.pid}</div><div class="v">${process.pid}</div></div>
    <div class="card"><div class="k">${T.hits}</div><div class="v">${hits}</div></div>
    <div class="card"><div class="k">${T.uptime}</div><div class="v">${Math.floor((Date.now() - t0) / 1000)} s</div></div>
    <div class="card"><div class="k">${T.memory}</div><div class="v">${(process.memoryUsage().rss / 1048576).toFixed(1)} MB</div></div>
  </div>
  <button onclick="location.reload()">${T.refresh}</button>
</div></body></html>`;

http.createServer((req, res) => {
  hits++;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html(TEXT[langOf(req)]));
}).listen(PORT, () => {
  console.log(`[demo-dashboard] listening → http://localhost:${PORT}  (pid ${process.pid})`);
});

setInterval(() => console.log(`[demo-dashboard] served ${hits} requests`), 15000);
