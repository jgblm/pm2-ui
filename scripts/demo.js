'use strict';
/**
 * 演示脚本：一键用 pm2 启动 / 停止三个示例进程
 *   node scripts/demo.js start
 *   node scripts/demo.js stop
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const bin = fs.existsSync(path.join(ROOT, 'node_modules', '.bin', 'pm2'))
  ? path.join(ROOT, 'node_modules', '.bin', 'pm2')
  : 'pm2';

function pm2(args, label) {
  console.log(`\n› pm2 ${args.join(' ')}`);
  const r = spawnSync(bin, args, { stdio: 'inherit', cwd: ROOT });
  if (r.status !== 0 && label) console.log(`  (${label} 退出码 ${r.status}，可忽略)`);
}

const cmd = process.argv[2] || 'start';

if (cmd === 'start') {
  pm2(['start', 'demo/api-server.js', '--name', 'demo-api-server', '--', '--port', '3101'],
      '启动 api-server');
  pm2(['start', 'demo/dashboard.js', '--name', 'demo-dashboard', '--', '--port', '3102'],
      '启动 dashboard');
  pm2(['start', 'demo/worker.js', '--name', 'demo-worker'], '启动 worker');
  pm2(['save'], '保存进程列表');
  console.log('\n✅ 演示进程已启动，打开管理台即可看到两个可点击的 Web 地址。\n');
} else if (cmd === 'stop') {
  for (const name of ['demo-api-server', 'demo-dashboard', 'demo-worker']) {
    pm2(['delete', name], `删除 ${name}`);
  }
  console.log('\n🧹 演示进程已清理。\n');
} else {
  console.log('用法：node scripts/demo.js [start|stop]');
}
