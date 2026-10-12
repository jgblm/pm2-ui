'use strict';
/**
 * 演示脚本：一键用 pm2 启动 / 停止三个示例进程
 *   node scripts/demo.js start
 *   node scripts/demo.js stop
 *
 * 文案跟随 PM2_UI_LANG / 系统语言。
 */

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const i18n = require(path.join(ROOT, 'server', 'i18n.js'));
const LANG = i18n.defaultLang();
const t = i18n.translator(LANG);

const bin = fs.existsSync(path.join(ROOT, 'node_modules', '.bin', 'pm2'))
  ? path.join(ROOT, 'node_modules', '.bin', 'pm2')
  : 'pm2';

function pm2(args, label) {
  console.log(`\n› pm2 ${args.join(' ')}`);
  const r = spawnSync(bin, args, { stdio: 'inherit', cwd: ROOT, env: { ...process.env, PM2_UI_LANG: LANG } });
  if (r.status !== 0 && label) console.log(`  ${t('demo.exitCode', { label, code: r.status })}`);
}

const cmd = process.argv[2] || 'start';

if (cmd === 'start') {
  pm2(['start', 'demo/api-server.js', '--name', 'demo-api-server', '--', '--port', '3101'],
      t('demo.startApi'));
  pm2(['start', 'demo/dashboard.js', '--name', 'demo-dashboard', '--', '--port', '3102'],
      t('demo.startDashboard'));
  pm2(['start', 'demo/worker.js', '--name', 'demo-worker'], t('demo.startWorker'));
  pm2(['save'], t('demo.saveList'));
  console.log(`\n${t('demo.started')}\n`);
} else if (cmd === 'stop') {
  for (const name of ['demo-api-server', 'demo-dashboard', 'demo-worker']) {
    pm2(['delete', name], t('demo.delete', { name }));
  }
  console.log(`\n${t('demo.stopped')}\n`);
} else {
  console.log(t('demo.usage'));
}
