#!/usr/bin/env node
'use strict';

/**
 * pm2-ui —— 命令行入口
 * ------------------------------------------------------------------
 * 在任意目录输入 `pm2-ui` 即可启动监控面板。
 * 通过 `npm link` 安装为全局命令，或在本目录用 `npx pm2-ui` / `npm start`。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));
const updater = require(path.join(ROOT, 'server', 'update.js'));

// 明确的前置条件检查：shebang 用的是 env node，PATH 里的 node 可能太老
const NODE_MAJOR = Number(process.versions.node.split('.')[0]);
if (NODE_MAJOR < 16) {
  console.error(
    `\n  \x1b[31m✗ 需要 Node.js 16 或更高版本，当前是 v${process.versions.node}\x1b[0m\n` +
    '    请升级 Node，或改用：/path/to/new/node ' + path.join(__dirname, 'pm2-ui.js') + '\n'
  );
  process.exit(1);
}

/* ------------------------------ 参数解析 ------------------------------ */

const HELP = `
  \x1b[1m${pkg.name}\x1b[0m v${pkg.version} —— PM2 进程与端口监控

  \x1b[1m用法\x1b[0m
    pm2-ui [选项]

  \x1b[1m选项\x1b[0m
    -p, --port <端口>     管理台监听端口        （默认 7799，可用 PM2_WEB_PORT 覆盖）
    -H, --host <地址>     绑定地址              （默认 127.0.0.1，局域网访问用 0.0.0.0）
        --pm2 <路径>      指定 pm2 可执行文件   （默认自动查找）
        --open            启动后自动打开浏览器
        --demo            启动前先拉起演示进程
        --install         缺依赖时自动执行 npm install
        --check-update    只检查有没有新版本，不做任何改动
        --update          更新到最新版本并退出（面板里也能一键更新）
    -v, --version         打印版本号
    -h, --help            显示本帮助

  \x1b[1m示例\x1b[0m
    pm2-ui                        用默认端口启动
    pm2-ui 8080                   直接写端口号也行
    pm2-ui --host 0.0.0.0 --open  局域网访问并自动开浏览器
    pm2-ui --demo                 顺便起 3 个演示进程看看效果
    pm2-ui --check-update         看看是不是有新版本
    pm2-ui --update               升级到最新版
`;

function parseArgs(argv) {
  const opts = {
    port: null, host: null, pm2: null,
    open: false, demo: false, install: false,
    update: false, checkUpdate: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) fail(`选项 ${a} 缺少参数`);
      return v;
    };
    switch (a) {
      case '-p': case '--port': opts.port = Number(next()); break;
      case '-H': case '--host': case '--hostname': opts.host = next(); break;
      case '--pm2': opts.pm2 = path.resolve(next()); break;
      case '--open': opts.open = true; break;
      case '--demo': opts.demo = true; break;
      case '--install': opts.install = true; break;
      case '--update': case '--upgrade': opts.update = true; break;
      case '--check-update': case '--check': opts.checkUpdate = true; break;
      case '-v': case '--version': opts.version = true; break;
      case '-h': case '--help': opts.help = true; break;
      default:
        if (/^\d+$/.test(a)) { opts.port = Number(a); break; }   // 允许 `pm2-ui 8080`
        fail(`未知选项：${a}（用 --help 查看用法）`);
    }
  }

  if (opts.port !== null && (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535)) {
    fail(`端口不合法：${opts.port}`);
  }
  return opts;
}

function fail(msg) {
  console.error(`\n  \x1b[31m✗ ${msg}\x1b[0m\n`);
  process.exit(1);
}

/* ------------------------------ 环境准备 ------------------------------ */

function hasExpress() {
  try { require.resolve('express', { paths: [ROOT] }); return true; } catch (_) { return false; }
}

function installDeps() {
  console.log('  正在安装依赖（express / pm2），首次可能需要一两分钟…\n');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['install'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) fail('npm install 失败，请手动在项目目录执行：npm install');
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd'
      : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try { execFileSync(cmd, args, { stdio: 'ignore', timeout: 5000 }); } catch (_) { /* 打不开就算了 */ }
}

function runDemo() {
  const script = path.join(ROOT, 'scripts', 'demo.js');
  if (!fs.existsSync(script)) return;
  console.log('  正在启动演示进程…');
  const r = spawnSync(process.execPath, [script, 'start'], { cwd: ROOT, stdio: 'ignore' });
  if (r.status !== 0) {
    console.log('  \x1b[33m! 演示进程启动失败（可能 pm2 守护进程未就绪），可稍后手动执行 npm run demo:start\x1b[0m');
  }
}

/* ------------------------------ 自更新 ------------------------------ */

function showVersionInfo(info) {
  const line = (k, v) => `  \x1b[2m${k}\x1b[0m  ${v}`;
  console.log('');
  console.log(line('当前版本', `v${info.current}`));
  console.log(line('最新版本', info.latest ? `v${info.latest}` : '查询失败'));
  console.log(line('安装方式', info.modeLabel));
  if (info.canUpdate) console.log(line('更新命令', info.planText));
  console.log('');
}

/** pm2-ui --check-update */
async function runCheckUpdate() {
  const info = await updater.check({ force: true });
  showVersionInfo(info);
  if (info.error) {
    console.log(`  \x1b[33m! 无法访问 registry：${info.error}\x1b[0m\n`);
  } else if (info.hasUpdate) {
    console.log(`  \x1b[33m↑ 有新版本，执行 pm2-ui --update 升级\x1b[0m\n`);
  } else {
    console.log('  \x1b[32m✓ 已经是最新版本\x1b[0m\n');
  }
}

/** pm2-ui --update */
async function runUpdate() {
  const info = await updater.check({ force: true });
  showVersionInfo(info);
  if (!info.canUpdate) return fail(info.reason || '当前安装方式不支持自动更新');
  if (!info.hasUpdate) {
    console.log('  \x1b[32m✓ 已经是最新版本，无需更新\x1b[0m\n');
    return;
  }

  console.log(`  正在更新 v${info.current} → v${info.latest}…\n`);
  let out;
  try {
    out = await updater.apply({ onLine: (text) => console.log('  \x1b[2m│\x1b[0m ' + text) });
  } catch (e) {
    return fail('更新失败：' + e.message);
  }
  console.log('');
  console.log(`  \x1b[32m✓ 更新完成\x1b[0m：v${out.from} → v${out.to}`);
  console.log('  \x1b[2m面板正在运行时请重启它（或在面板里点「重启面板」）以加载新版本\x1b[0m\n');
}

/* -------------------------------- 主流程 -------------------------------- */

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) { console.log(HELP); return; }
  if (opts.version) { console.log(pkg.version); return; }

  // 自更新：不依赖 express，所以放在依赖检查之前
  if (opts.checkUpdate) return runCheckUpdate();
  if (opts.update) return runUpdate();

  // 缺依赖时：交互式终端或显式 --install 就自动装，否则提示手动安装
  if (!hasExpress()) {
    const interactive = Boolean(process.stdin.isTTY);
    if (opts.install || interactive) {
      console.log('\n  检测到依赖未安装，正在执行 npm install…\n');
      installDeps();
    } else {
      fail('依赖未安装。请在项目目录执行一次 npm install（或加 --install 自动安装）');
    }
    if (!hasExpress()) fail('依赖仍未就绪，请在项目目录执行：npm install');
  }

  if (opts.pm2) process.env.PM2_BIN = opts.pm2;
  if (opts.demo) runDemo();

  // express 必须在设置好 PM2_BIN 之后再加载
  const { start } = require(path.join(ROOT, 'server', 'index.js'));

  let started;
  try {
    started = await start({ port: opts.port || undefined, host: opts.host || undefined });
  } catch (e) {
    fail(e.message);
  }

  if (opts.open) openBrowser(started.url);

  // 有新版本时顺手提示一句（异步，不阻塞启动，也不自动更新）
  if (updater.AUTO_CHECK) {
    updater.check()
      .then((info) => {
        if (!info.hasUpdate) return;
        console.log(
          `  \x1b[33m↑ 发现新版本 v${info.latest}\x1b[0m（当前 v${info.current}）\n` +
          `    ${info.planText}\n` +
          '    也可以在面板右上角点版本号一键更新\n'
        );
      })
      .catch(() => { /* 检查失败就安静跳过 */ });
  }

  const bye = () => {
    console.log('\n  已退出。\n');
    process.exit(0);
  };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}

main().catch((e) => fail(e.message));
