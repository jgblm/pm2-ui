#!/usr/bin/env node
'use strict';

/**
 * pm2-ui —— 命令行入口 / CLI entry
 * ------------------------------------------------------------------
 * 在任意目录输入 `pm2-ui` 即可启动监控面板。
 * 通过 `npm link` 安装为全局命令，或在本目录用 `npx pm2-ui` / `npm start`。
 *
 * 界面语言 / UI language：PM2_UI_LANG=zh-CN|en-US，缺省时按系统语言推断。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));
const i18n = require(path.join(ROOT, 'server', 'i18n.js'));
const updater = require(path.join(ROOT, 'server', 'update.js'));

const LANG = i18n.defaultLang();
const t = i18n.translator(LANG);

// 明确的前置条件检查：shebang 用的是 env node，PATH 里的 node 可能太老
const NODE_MAJOR = Number(process.versions.node.split('.')[0]);
if (NODE_MAJOR < 16) {
  console.error(
    `\n  \x1b[31m✗ ${t('cli.nodeTooOld', { version: process.versions.node })}\x1b[0m\n` +
    `    ${t('cli.nodeTooOldHint', { node: '/path/to/new/node', script: path.join(__dirname, 'pm2-ui.js') })}\n`
  );
  process.exit(1);
}

/* ------------------------------ 参数解析 ------------------------------ */

const HELP = t('cli.help', { name: pkg.name, version: pkg.version });

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
      if (v === undefined) fail(t('cli.missingArg', { option: a }));
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
        fail(t('cli.unknownOption', { option: a }));
    }
  }

  if (opts.port !== null && (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535)) {
    fail(t('cli.invalidPort', { port: opts.port }));
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
  console.log(`  ${t('cli.installing')}\n`);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['install'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) fail(t('cli.installFailed'));
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
  console.log(`  ${t('cli.demoStarting')}`);
  const r = spawnSync(process.execPath, [script, 'start'], {
    cwd: ROOT, stdio: 'ignore', env: { ...process.env, PM2_UI_LANG: LANG },
  });
  if (r.status !== 0) {
    console.log(`  \x1b[33m${t('cli.demoFailed')}\x1b[0m`);
  }
}

/* ------------------------------ 自更新 ------------------------------ */

function showVersionInfo(info) {
  const line = (k, v) => `  \x1b[2m${k}\x1b[0m  ${v}`;
  console.log('');
  console.log(line(t('cli.currentVersion'), `v${info.current}`));
  console.log(line(t('cli.latestVersion'), info.latest ? `v${info.latest}` : t('cli.queryFailed')));
  console.log(line(t('cli.installMode'), info.modeLabel));
  if (info.canUpdate) console.log(line(t('cli.updateCommand'), info.planText));
  console.log('');
}

/** pm2-ui --check-update */
async function runCheckUpdate() {
  const info = await updater.check({ force: true, lang: LANG });
  showVersionInfo(info);
  if (info.error) {
    console.log(`  \x1b[33m${t('cli.registryUnreachable', { error: info.error })}\x1b[0m\n`);
  } else if (info.hasUpdate) {
    console.log(`  \x1b[33m${t('cli.hasUpdate')}\x1b[0m\n`);
  } else {
    console.log(`  \x1b[32m${t('cli.upToDate')}\x1b[0m\n`);
  }
}

/** pm2-ui --update */
async function runUpdate() {
  const info = await updater.check({ force: true, lang: LANG });
  showVersionInfo(info);
  if (!info.canUpdate) return fail(info.reason || t('cli.updateNotSupported'));
  if (!info.hasUpdate) {
    console.log(`  \x1b[32m${t('cli.upToDateNoop')}\x1b[0m\n`);
    return;
  }

  console.log(`  ${t('cli.updating', { from: info.current, to: info.latest })}\n`);
  let out;
  try {
    out = await updater.apply({ lang: LANG, onLine: (text) => console.log('  \x1b[2m│\x1b[0m ' + text) });
  } catch (e) {
    return fail(t('cli.updateFailed', { message: e.message }));
  }
  console.log('');
  console.log(`  \x1b[32m${t('cli.updateDone')}\x1b[0m：v${out.from} → v${out.to}`);
  console.log(`  \x1b[2m${t('cli.updateDoneHint')}\x1b[0m\n`);
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
      console.log(`\n  ${t('cli.installingShort')}\n`);
      installDeps();
    } else {
      fail(t('cli.depsMissing'));
    }
    if (!hasExpress()) fail(t('cli.depsStillMissing'));
  }

  if (opts.pm2) process.env.PM2_BIN = opts.pm2;
  if (opts.demo) runDemo();

  // express 必须在设置好 PM2_BIN 之后再加载
  const { start } = require(path.join(ROOT, 'server', 'index.js'));

  let started;
  try {
    started = await start({ port: opts.port || undefined, host: opts.host || undefined, lang: LANG });
  } catch (e) {
    fail(e.message);
  }

  if (opts.open) openBrowser(started.url);

  // 有新版本时顺手提示一句（异步，不阻塞启动，也不自动更新）
  if (updater.AUTO_CHECK) {
    updater.check({ lang: LANG })
      .then((info) => {
        if (!info.hasUpdate) return;
        console.log(
          `  \x1b[33m${t('cli.newVersionFound', { latest: info.latest, current: info.current })}\x1b[0m\n` +
          `    ${info.planText}\n` +
          `    ${t('cli.newVersionPanelHint')}\n`
        );
      })
      .catch(() => { /* 检查失败就安静跳过 */ });
  }

  const bye = () => {
    console.log(`\n  ${t('cli.bye')}\n`);
    process.exit(0);
  };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}

main().catch((e) => fail(e.message));
