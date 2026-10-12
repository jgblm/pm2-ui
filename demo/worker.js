'use strict';
/* 演示进程 3：后台定时任务（不监听任何端口）
   用来对比展示：不是每个进程都有网页地址，管理台会如实标注"未检测到监听端口"。

   Demo process #3: a background scheduled job (listens on no port), used to show
   that not every process has a web address — the dashboard reports "no listening
   port detected" for it. */

let tick = 0;

function work() {
  tick++;
  const started = Date.now();
  // 模拟一点计算 / simulate a bit of CPU work
  let x = 0;
  for (let i = 0; i < 3_000_000; i++) x += Math.sqrt(i);
  console.log(`[demo-worker] tick #${tick} done in ${Date.now() - started}ms, checksum ${x.toFixed(0).slice(-4)}`);
}

console.log(`[demo-worker] background job started (pid ${process.pid}), runs every 10s, listens on no port`);
work();
setInterval(work, 10000);
