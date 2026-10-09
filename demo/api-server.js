'use strict';
/* 演示进程 1：一个真实的 HTTP API 服务（监听 3101），用于展示"自动探测 Web 地址" */

const http = require('http');
const os = require('os');

const PORT = Number(process.env.PORT || 3101);

const page = () => `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
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
  <div class="tag">● 运行中</div>
  <h1>Demo API Server</h1>
  <p>这是由 <code>pm2</code> 托管的演示服务。管理台通过 <code>lsof</code> 探测到它监听的 <code>${PORT}</code> 端口，
     并验证其返回 HTTP 响应，于是生成了你刚刚点击的那个链接。</p>
  <div class="row"><span>进程 PID</span><span>${process.pid}</span></div>
  <div class="row"><span>监听端口</span><span>${PORT}</span></div>
  <div class="row"><span>主机名</span><span>${os.hostname()}</span></div>
  <div class="row"><span>Node 版本</span><span>${process.version}</span></div>
  <div class="row"><span>运行时长</span><span>${Math.floor(process.uptime())} 秒</span></div>
  <p style="margin-top:20px">试试接口：<a href="/api/status">/api/status</a> · <a href="/api/time">/api/time</a></p>
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
  res.end(page());
});

server.listen(PORT, () => {
  console.log(`[demo-api-server] 已启动 → http://localhost:${PORT}  (pid ${process.pid})`);
});

// 每隔一段时间打点日志，方便在管理台里看"实时日志"效果
let n = 0;
setInterval(() => {
  n++;
  console.log(`[demo-api-server] 心跳 #${n} rss=${(process.memoryUsage().rss / 1048576).toFixed(1)}MB`);
  if (n % 7 === 0) console.error(`[demo-api-server] 这是一条示例错误日志 #${n}`);
}, 8000);

process.on('SIGINT', () => { server.close(() => process.exit(0)); });
