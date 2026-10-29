'use strict';

/**
 * 服务端国际化 / Server-side i18n
 * ------------------------------------------------------------------
 * 语言来源优先级：
 *   1. 请求参数 ?lang=en-US
 *   2. 请求头 Accept-Language
 *   3. 环境变量 PM2_UI_LANG
 *   4. 系统语言（LC_ALL / LC_MESSAGES / LANG）
 *   5. 默认 zh-CN
 *
 * 本模块只依赖 Node 内置能力，`pm2-ui --help` / `--update` 等不加载 express 的
 * 场景也能直接用。
 */

const SUPPORTED = ['zh-CN', 'en-US'];
const FALLBACK = 'zh-CN';

/* ------------------------------ 词典 ------------------------------ */

const MESSAGES = {
  'zh-CN': {
    /* HTTP API */
    'api.unsupportedAction': '不支持的操作：{action}',
    'api.processGoneRecoverable': 'pm2 里已没有「{name}」，但任务清单里还留着参数，可用「恢复启动」按原参数拉起',
    'api.processNotFound': '进程 {name} 不存在',
    'api.actionOk': '{name} {action} 执行成功',
    'api.needTarget': '请填写要启动的脚本或配置文件路径',
    'api.startOk': '启动成功',
    'api.needName': '缺少任务名',
    'api.invalidName': '非法的任务名：{name}（不能包含空格或斜杠，也不能以 - 开头）',
    'api.nameExists': '任务清单里已经有「{name}」了，请换一个名称',
    'api.renameRebuildFailed': '已改名为「{name}」，但 pm2 进程重建失败：{error}',
    'api.emptyTarget': '启动目标不能为空',
    'api.defNotFound': '任务清单里没有「{name}」',
    'api.startedFromDef': '已按保存的参数启动',
    'api.removedFromList': '已从任务清单移除',
    'api.recordNotFound': '任务清单里没有这条记录',
    'api.invalidOrder': '排序数据格式不对',
    'api.savedPm2List': '已保存当前 pm2 列表',
    'api.resurrected': '已按 dump 恢复进程',
    'api.needConfirm': '缺少确认参数，请从面板点「立即更新」',
    'api.notPm2Hosted': '面板不是由 pm2 托管的：请回到终端按 Ctrl+C，再重新执行 pm2-ui 即可加载新版本',
    'api.pm2RestartTriggered': '已触发 pm2 restart {name}，新版本正在启动',

    /* 日志流（SSE） */
    'log.streamStart': '—— 开始监听 {name} 的实时日志 ——',
    'log.streamEnd': '—— 日志流已结束 ——',

    /* 启动横幅 / 监听错误 */
    'server.bannerTitle': 'PM2 进程与端口监控  已启动',
    'server.local': '本机访问',
    'server.lan': '局域网',
    'server.exitHint': '按 Ctrl+C 退出',
    'server.portInUse': '端口 {port} 已被占用，换一个：pm2-ui --port {next}',
    'server.permission': '没有权限绑定 {host}:{port}，换一个高端口试试',
    'server.startFailed': '启动失败：{message}',

    /* pm2 封装 */
    'pm2.jlistFailed': 'pm2 jlist 执行失败',
    'pm2.parseFailed': '无法解析 pm2 输出：{text}',
    'pm2.invalidName': '非法的进程名',
    'pm2.actionFailed': '{action} 失败',
    'pm2.invalidTarget': '非法的启动目标',
    'pm2.startFailed': '启动失败',
    'pm2.emptyCommand': '空的 pm2 命令',
    'pm2.commandFailed': 'pm2 {command} 执行失败',

    /* 任务清单存储 */
    'store.missingTarget': '任务「{name}」缺少启动目标（脚本路径）',

    /* 自更新 */
    'update.mode.global': '全局安装（npm install -g）',
    'update.mode.local': '项目依赖（node_modules/pm2-ui）',
    'update.mode.npx': 'npx 临时运行',
    'update.mode.git': '源码检出（git 仓库）',
    'update.mode.unknown': '未知方式',
    'update.label.global': 'npm install -g {name}@latest',
    'update.label.local': 'npm install {name}@latest（在 {dir}）',
    'update.label.gitPull': 'git pull --ff-only',
    'update.label.gitInstall': 'npm install',
    'update.reason.npx': '当前是用 npx 临时运行的，没法就地更新；下次直接跑 `npx {name}@latest` 即可',
    'update.reason.unknown': '没能识别安装方式，请手动更新：npm install -g {name}@latest',
    'update.reason.notSupported': '当前安装方式不支持自动更新',
    'update.registryHttp': 'registry 返回 HTTP {code}',
    'update.registryTooLarge': 'registry 响应过大',
    'update.registryParse': '无法解析 registry 返回的内容',
    'update.checkTimeout': '查询最新版本超时（{ms}ms）',
    'update.noVersion': 'registry 未返回版本号',
    'update.stepTimeout': '「{label}」执行超时（{seconds}s）',
    'update.spawnFailed': '无法执行 {cmd}：{message}',
    'update.busy': '已经有一次更新在执行中，请稍候',
    'update.modeLine': '安装方式：{mode}',
    'update.stepFailed': '「{label}」失败（退出码 {code}），已中止更新',
    'update.restarted': '已执行 pm2 restart {name}，新版本正在启动',

    /* CLI */
    'cli.nodeTooOld': '需要 Node.js 16 或更高版本，当前是 v{version}',
    'cli.nodeTooOldHint': '请升级 Node，或改用：{node} {script}',
    'cli.missingArg': '选项 {option} 缺少参数',
    'cli.unknownOption': '未知选项：{option}（用 --help 查看用法）',
    'cli.invalidPort': '端口不合法：{port}',
    'cli.installing': '正在安装依赖（express / pm2），首次可能需要一两分钟…',
    'cli.installingShort': '检测到依赖未安装，正在执行 npm install…',
    'cli.installFailed': 'npm install 失败，请手动在项目目录执行：npm install',
    'cli.depsMissing': '依赖未安装。请在项目目录执行一次 npm install（或加 --install 自动安装）',
    'cli.depsStillMissing': '依赖仍未就绪，请在项目目录执行：npm install',
    'cli.demoStarting': '正在启动演示进程…',
    'cli.demoFailed': '! 演示进程启动失败（可能 pm2 守护进程未就绪），可稍后手动执行 npm run demo:start',
    'cli.currentVersion': '当前版本',
    'cli.latestVersion': '最新版本',
    'cli.installMode': '安装方式',
    'cli.updateCommand': '更新命令',
    'cli.queryFailed': '查询失败',
    'cli.registryUnreachable': '! 无法访问 registry：{error}',
    'cli.hasUpdate': '↑ 有新版本，执行 pm2-ui --update 升级',
    'cli.upToDate': '✓ 已经是最新版本',
    'cli.upToDateNoop': '✓ 已经是最新版本，无需更新',
    'cli.updateNotSupported': '当前安装方式不支持自动更新',
    'cli.updating': '正在更新 v{from} → v{to}…',
    'cli.updateFailed': '更新失败：{message}',
    'cli.updateDone': '✓ 更新完成',
    'cli.updateDoneHint': '面板正在运行时请重启它（或在面板里点「重启面板」）以加载新版本',
    'cli.newVersionFound': '↑ 发现新版本 v{latest}（当前 v{current}）',
    'cli.newVersionPanelHint': '也可以在面板右上角点版本号一键更新',
    'cli.bye': '已退出。',

    /* 演示脚本 */
    'demo.exitCode': '（{label} 退出码 {code}，可忽略）',
    'demo.startApi': '启动 api-server',
    'demo.startDashboard': '启动 dashboard',
    'demo.startWorker': '启动 worker',
    'demo.saveList': '保存进程列表',
    'demo.started': '✅ 演示进程已启动，打开管理台即可看到两个可点击的 Web 地址。',
    'demo.delete': '删除 {name}',
    'demo.stopped': '🧹 演示进程已清理。',
    'demo.usage': '用法：node scripts/demo.js [start|stop]',
    'cli.help': `
  \x1b[1m{name}\x1b[0m v{version} —— PM2 进程与端口监控

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
`,
  },

  'en-US': {
    /* HTTP API */
    'api.unsupportedAction': 'Unsupported action: {action}',
    'api.processGoneRecoverable': 'pm2 no longer has "{name}", but its launch parameters are still saved — use "Recover" to start it exactly as before',
    'api.processNotFound': 'Process {name} not found',
    'api.actionOk': '{name}: {action} succeeded',
    'api.needTarget': 'Please provide the script or config file path to start',
    'api.startOk': 'Started successfully',
    'api.needName': 'Missing app name',
    'api.invalidName': 'Invalid app name: {name} (no spaces or slashes, must not start with -)',
    'api.nameExists': 'An app named "{name}" already exists — pick another name',
    'api.renameRebuildFailed': 'Renamed to "{name}", but rebuilding the pm2 process failed: {error}',
    'api.emptyTarget': 'Launch target cannot be empty',
    'api.defNotFound': 'No saved definition for "{name}"',
    'api.startedFromDef': 'Started with the saved parameters',
    'api.removedFromList': 'Removed from the saved-apps list',
    'api.recordNotFound': 'No such record in the saved-apps list',
    'api.invalidOrder': 'Malformed ordering payload',
    'api.savedPm2List': 'Current pm2 list saved',
    'api.resurrected': 'Processes restored from the dump',
    'api.needConfirm': 'Missing confirmation parameter — use the "Update now" button in the dashboard',
    'api.notPm2Hosted': 'The dashboard is not managed by pm2: go back to the terminal, press Ctrl+C, then run pm2-ui again to load the new version',
    'api.pm2RestartTriggered': 'Triggered pm2 restart {name}; the new version is starting',

    /* Log stream (SSE) */
    'log.streamStart': '—— Live log for {name} started ——',
    'log.streamEnd': '—— Log stream ended ——',

    /* Banner / listen errors */
    'server.bannerTitle': 'PM2 process & port monitor started',
    'server.local': 'Local',
    'server.lan': 'LAN',
    'server.exitHint': 'Press Ctrl+C to exit',
    'server.portInUse': 'Port {port} is already in use, try another: pm2-ui --port {next}',
    'server.permission': 'No permission to bind {host}:{port}, try a higher port',
    'server.startFailed': 'Failed to start: {message}',

    /* pm2 wrapper */
    'pm2.jlistFailed': 'pm2 jlist failed',
    'pm2.parseFailed': 'Failed to parse pm2 output: {text}',
    'pm2.invalidName': 'Invalid process name',
    'pm2.actionFailed': '{action} failed',
    'pm2.invalidTarget': 'Invalid launch target',
    'pm2.startFailed': 'Failed to start',
    'pm2.emptyCommand': 'Empty pm2 command',
    'pm2.commandFailed': 'pm2 {command} failed',

    /* App store */
    'store.missingTarget': 'App "{name}" has no launch target (script path)',

    /* Self update */
    'update.mode.global': 'Global install (npm install -g)',
    'update.mode.local': 'Project dependency (node_modules/pm2-ui)',
    'update.mode.npx': 'Temporary npx run',
    'update.mode.git': 'Source checkout (git repository)',
    'update.mode.unknown': 'Unknown mode',
    'update.label.global': 'npm install -g {name}@latest',
    'update.label.local': 'npm install {name}@latest (in {dir})',
    'update.label.gitPull': 'git pull --ff-only',
    'update.label.gitInstall': 'npm install',
    'update.reason.npx': 'Currently running via a temporary npx install, which cannot be updated in place; just run `npx {name}@latest` next time',
    'update.reason.unknown': 'Could not detect the install mode, update manually: npm install -g {name}@latest',
    'update.reason.notSupported': 'This install mode does not support auto-update',
    'update.registryHttp': 'registry returned HTTP {code}',
    'update.registryTooLarge': 'registry response too large',
    'update.registryParse': 'Could not parse the registry response',
    'update.checkTimeout': 'Timed out while fetching the latest version ({ms}ms)',
    'update.noVersion': 'registry did not return a version',
    'update.stepTimeout': '"{label}" timed out ({seconds}s)',
    'update.spawnFailed': 'Cannot run {cmd}: {message}',
    'update.busy': 'Another update is already running, please wait',
    'update.modeLine': 'Install mode: {mode}',
    'update.stepFailed': '"{label}" failed (exit code {code}); update aborted',
    'update.restarted': 'Ran pm2 restart {name}; the new version is starting',

    /* CLI */
    'cli.nodeTooOld': 'Node.js 16 or newer is required, current version is v{version}',
    'cli.nodeTooOldHint': 'Please upgrade Node, or run: {node} {script}',
    'cli.missingArg': 'Option {option} is missing a value',
    'cli.unknownOption': 'Unknown option: {option} (see --help)',
    'cli.invalidPort': 'Invalid port: {port}',
    'cli.installing': 'Installing dependencies (express / pm2); the first run may take a minute or two…',
    'cli.installingShort': 'Dependencies are missing, running npm install…',
    'cli.installFailed': 'npm install failed, please run it manually in the project directory: npm install',
    'cli.depsMissing': 'Dependencies are not installed. Run npm install once in the project directory (or pass --install)',
    'cli.depsStillMissing': 'Dependencies are still missing, please run in the project directory: npm install',
    'cli.demoStarting': 'Starting demo processes…',
    'cli.demoFailed': '! Could not start the demo processes (pm2 daemon may not be ready); run npm run demo:start later',
    'cli.currentVersion': 'Current',
    'cli.latestVersion': 'Latest',
    'cli.installMode': 'Install mode',
    'cli.updateCommand': 'Update command',
    'cli.queryFailed': 'query failed',
    'cli.registryUnreachable': '! Cannot reach the registry: {error}',
    'cli.hasUpdate': '↑ A new version is available, run pm2-ui --update',
    'cli.upToDate': '✓ Already on the latest version',
    'cli.upToDateNoop': '✓ Already on the latest version, nothing to update',
    'cli.updateNotSupported': 'This install mode does not support auto-update',
    'cli.updating': 'Updating v{from} → v{to}…',
    'cli.updateFailed': 'Update failed: {message}',
    'cli.updateDone': '✓ Update finished',
    'cli.updateDoneHint': 'If the dashboard is running, restart it (or click "Restart dashboard") to load the new version',
    'cli.newVersionFound': '↑ New version v{latest} available (current v{current})',
    'cli.newVersionPanelHint': 'You can also click the version chip in the dashboard to update',
    'cli.bye': 'Bye.',

    /* Demo script */
    'demo.exitCode': '({label} exited with code {code}, can be ignored)',
    'demo.startApi': 'Start api-server',
    'demo.startDashboard': 'Start dashboard',
    'demo.startWorker': 'Start worker',
    'demo.saveList': 'Save process list',
    'demo.started': '✅ Demo processes started — open the dashboard to see two clickable web addresses.',
    'demo.delete': 'Delete {name}',
    'demo.stopped': '🧹 Demo processes cleaned up.',
    'demo.usage': 'Usage: node scripts/demo.js [start|stop]',
    'cli.help': `
  \x1b[1m{name}\x1b[0m v{version} —— PM2 process & port monitor

  \x1b[1mUsage\x1b[0m
    pm2-ui [options]

  \x1b[1mOptions\x1b[0m
    -p, --port <port>     Dashboard port        (default 7799, override with PM2_WEB_PORT)
    -H, --host <addr>     Bind address          (default 127.0.0.1, use 0.0.0.0 for LAN access)
        --pm2 <path>      Path to the pm2 executable (auto-detected by default)
        --open            Open the browser after start
        --demo            Start the demo processes first
        --install         Run npm install automatically when deps are missing
        --check-update    Only check for a new version, change nothing
        --update          Update to the latest version and exit (also available in the dashboard)
    -v, --version         Print the version number
    -h, --help            Show this help

  \x1b[1mExamples\x1b[0m
    pm2-ui                        Start on the default port
    pm2-ui 8080                   A bare port number works too
    pm2-ui --host 0.0.0.0 --open  LAN access + open the browser
    pm2-ui --demo                 Also start 3 demo processes
    pm2-ui --check-update         Check whether a new version exists
    pm2-ui --update               Upgrade to the latest version
`,
  },
};

/* ------------------------------ 语言解析 ------------------------------ */

/** 把任意输入（en、en-US、zh_CN…）规范化成受支持的 locale，识别不出返回 '' */
function normalize(input) {
  const s = String(input || '').trim().toLowerCase().replace('_', '-');
  if (!s) return '';
  if (s.startsWith('zh')) return 'zh-CN';
  if (s.startsWith('en')) return 'en-US';
  return '';
}

/** 从 Accept-Language 头里挑一个能识别的语言 */
function fromAcceptLanguage(header) {
  const parts = String(header || '').split(',');
  const parsed = [];
  for (const p of parts) {
    const [tag, q] = p.trim().split(';');
    const hit = normalize(tag);
    if (!hit) continue;
    const weight = q && q.startsWith('q=') ? Number(q.slice(2)) : 1;
    parsed.push({ hit, weight: Number.isFinite(weight) ? weight : 0 });
  }
  parsed.sort((a, b) => b.weight - a.weight);
  return parsed.length ? parsed[0].hit : '';
}

/** 系统 / 环境变量里的语言（CLI 场景用） */
function fromEnv(env = process.env) {
  const explicit = normalize(env.PM2_UI_LANG);
  if (explicit) return explicit;
  for (const key of ['LC_ALL', 'LC_MESSAGES', 'LANG']) {
    const hit = normalize(env[key]);
    if (hit) return hit;
  }
  return '';
}

/** 服务端进程自身的默认语言 */
function defaultLang() {
  return fromEnv() || FALLBACK;
}

/**
 * 解析一次请求的语言：
 *   ?lang= → Accept-Language → 环境变量/系统语言 → 默认
 * @param {import('express').Request|string} input
 */
function resolveLang(input) {
  if (typeof input === 'string') return normalize(input) || defaultLang();
  if (!input) return defaultLang();
  const query = input.query && input.query.lang;
  const fromQuery = normalize(query);
  if (fromQuery) return fromQuery;
  const fromHeader = fromAcceptLanguage(input.headers && (input.headers['accept-language'] || input.headers['Accept-Language']));
  if (fromHeader) return fromHeader;
  return defaultLang();
}

/* ------------------------------ 翻译 ------------------------------ */

function interpolate(str, params) {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => (params[k] === undefined || params[k] === null ? m : String(params[k])));
}

/** 按指定语言翻译；缺词回落到中文，再回落成 key 本身 */
function translate(lang, key, params) {
  const dict = MESSAGES[normalize(lang) || FALLBACK] || MESSAGES[FALLBACK];
  let s = dict[key];
  if (s === undefined) s = MESSAGES[FALLBACK][key];
  if (s === undefined) return key;
  return interpolate(s, params);
}

/** 生成一个绑定到某语言的 t(key, params) */
function translator(lang) {
  const fixed = normalize(lang) || FALLBACK;
  return (key, params) => translate(fixed, key, params);
}

/** 默认语言的快捷翻译（CLI / 无请求上下文时用） */
function t(key, params, lang) {
  return translate(lang || defaultLang(), key, params);
}

module.exports = {
  SUPPORTED,
  FALLBACK,
  MESSAGES,
  normalize,
  fromAcceptLanguage,
  fromEnv,
  defaultLang,
  resolveLang,
  translate,
  translator,
  t,
};
