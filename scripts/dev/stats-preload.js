'use strict';

/**
 * stats-preload —— 开发自测用的指标上报预加载脚本
 * 通过 IPC 把子进程真实的 RSS / CPU 占用回传给 supervisor，
 * 让 mock-pm2 能在 `ps` 不可用的环境里也给出真实数字。
 *
 * 用法：node -r scripts/dev/stats-preload.js app.js
 */

if (process.send) {
  let lastUsage = process.cpuUsage();
  let lastTime = Date.now();

  const tick = setInterval(() => {
    const now = Date.now();
    const delta = process.cpuUsage(lastUsage);
    const elapsedMs = Math.max(now - lastTime, 1);
    lastUsage = process.cpuUsage();
    lastTime = now;

    const cpu = ((delta.user + delta.system) / 1000 / elapsedMs) * 100;
    try {
      process.send({
        rss: process.memoryUsage().rss,
        cpu: Number(cpu.toFixed(1)),
        at: now,
      });
    } catch (_) { /* 父进程已退出 */ }
  }, 2000);

  tick.unref();
}
