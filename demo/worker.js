'use strict';
/* 演示进程 3：后台定时任务（不监听任何端口）
   用来对比展示：不是每个进程都有网页地址，管理台会如实标注"未检测到监听端口"。 */

let tick = 0;

function work() {
  tick++;
  const started = Date.now();
  // 模拟一点计算
  let x = 0;
  for (let i = 0; i < 3_000_000; i++) x += Math.sqrt(i);
  console.log(`[demo-worker] 第 ${tick} 轮任务完成，耗时 ${Date.now() - started}ms，结果校验位 ${x.toFixed(0).slice(-4)}`);
}

console.log(`[demo-worker] 后台任务已启动 (pid ${process.pid})，每 10 秒执行一次，不监听任何端口`);
work();
setInterval(work, 10000);
