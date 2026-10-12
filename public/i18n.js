/* ============================================================
   pm2-ui — 前端国际化 / Frontend i18n
   ------------------------------------------------------------
   · 语言优先级：localStorage > 浏览器语言 > 默认中文
   · 页面上的静态文案通过 data-i18n / data-i18n-placeholder /
     data-i18n-title / data-i18n-html 自动替换
   · 切换语言会派发 window 事件 `pm2ui:langchange`，由 app.js 重新渲染
   ============================================================ */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'pm2-ui-lang';
  const SUPPORTED = ['zh-CN', 'en-US'];
  const FALLBACK = 'zh-CN';

  /* ------------------------------ 词典 ------------------------------ */

  const messages = {
    'zh-CN': {
      'app.title': 'pm2-ui · PM2 进程与端口监控',
      'app.heading': 'PM2 进程与端口监控',
      'app.connecting': '正在连接…',
      'app.managerLine': '{host} · {platform} · 管理台 pid {pid}',

      'pm2.detecting': '检测中',
      'pm2.notFound': '未找到 pm2',
      'pm2.version': 'PM2 v{version}',
      'pm2.readFailed': 'PM2 读取失败：{error}',
      'pm2.connectFailed': '连接后端失败：{error}',

      'common.refresh': '刷新',
      'common.refreshNow': '立即刷新',
      'common.refreshed': '已刷新',
      'common.auto': '自动',
      'common.autoTitle': '开启后每 3 秒自动刷新',
      'common.all': '全部',
      'common.online': '运行中',
      'common.stopped': '已停止',
      'common.errored': '错误',
      'common.launching': '启动中',
      'common.stopping': '停止中',
      'common.hasPorts': '有监听端口',
      'common.addProcess': '＋ 启动新进程',
      'common.cancel': '取消',
      'common.start': '启动',
      'common.stop': '停止',
      'common.restart': '重启',
      'common.reload': '重载',
      'common.delete': '删除',
      'common.logs': '日志',
      'common.edit': '编辑',
      'common.remove': '移除',
      'common.save': '保存',
      'common.close': '关闭',
      'common.clear': '清屏',
      'common.recover': '恢复启动',
      'common.live': '实时',
      'common.liveLog': '实时日志',
      'common.verified': '已校对',
      'common.versionAndUpdate': '版本与更新',
      'common.newVersion': '有新版本',
      'common.declaredPort': '声明端口',
      'common.verifiedTitle': '手工校对过，pm2 的自动收割不会再覆盖它',
      'common.removeDisabledTitle': '进程仍在 pm2 中，移除后会被自动重新收录；想彻底清除请先在进程卡片里「删除」',
      'common.language': '语言 / Language',
      'common.unknown': '未知',
      'common.fail': '操作失败',

      'search.placeholder': '搜索进程名、脚本路径、端口…',

      'stat.total': '进程总数',
      'stat.online': '运行中',
      'stat.stopped': '已停止 / 异常',
      'stat.listening': '监听端口',
      'stat.http': '其中 Web 端口',
      'stat.cpu': '累计 CPU',
      'stat.memory': '累计内存',

      'apps.title': '任务清单',
      'apps.desc': '每个任务的启动参数都会存到本地，即使被 pm2 删除、或 pm2 重启后列表丢失，也能按原参数一键恢复。想彻底清掉某条记录：先在进程卡片里「删除」，再从清单「移除」。',
      'apps.saveList': '保存 pm2 列表',
      'apps.saveListTitle': '执行 pm2 save，把当前列表写入 dump.pm2',
      'apps.resurrect': '恢复全部',
      'apps.resurrectTitle': '执行 pm2 resurrect，把 dump.pm2 里的进程全部拉回来',
      'apps.empty': '任务清单是空的。用「＋ 启动新进程」启动任务，或在终端 <code>pm2 start</code> 后刷新一次，面板会自动收录它的启动参数。',
      'apps.dumpHint': 'dump.pm2 <b>{count}</b> 条 · {time}',
      'apps.dumpHintAutosave': ' · 自动保存已开',
      'apps.dumpNotReady': 'dump.pm2 尚未生成',
      'apps.stateOnline': '运行中',
      'apps.stateStopped': '已停止',
      'apps.stateMissing': 'pm2 已丢失',
      'apps.savedFromDef': '{name} 已按保存的参数启动',

      'empty.title': '还没有任何 PM2 进程',
      'empty.desc': '点击右上角「启动新进程」，或运行 <code>npm run demo:start</code> 启动几个演示应用看看效果。',

      'grid.noMatch': '没有匹配的进程',
      'grid.entry': '入口',
      'grid.portCount': '{n} 端口',
      'grid.pid': 'pid',

      'metric.cpu': 'CPU',
      'metric.memory': '内存',
      'metric.restarts': '重启次数',
      'metric.uptime': '运行时长',
      'spark.trend': 'CPU 趋势',
      'spark.peak': '{value}% 峰值',

      'ports.title': '监听端口',
      'ports.summary': '{total} 个 · Web {web} · 其他 {other}',
      'ports.noneOnline': '未检测到监听端口（该进程可能不是网络服务）',
      'ports.noneStopped': '进程未运行，无法探测端口',
      'ports.openTip': '点击在新标签页打开',
      'ports.server': 'Server: {server}',
      'ports.infra': '中间件常用端口',
      'ports.fromEnv': '来自环境变量声明',
      'ports.tcpOnly': '仅 TCP，非网页服务',
      'ports.reason.stopped': '进程已停止，端口未监听',
      'ports.reason.ECONNREFUSED': '探测时连接被拒',
      'ports.reason.timeout': '未在超时内响应',
      'ports.reason.ECONNRESET': '连接被重置',
      'ports.reason.EPROTO': '非 HTTP/TLS 协议',
      'ports.reason.no-response': '未响应 HTTP 探测',

      'toast.deleteConfirm': '确定要从 pm2 列表中删除「{name}」吗？\n（不会删除文件，只是移出 pm2 列表；任务参数仍保留在下面的任务清单里，可随时恢复启动）',
      'toast.recoverConfirm': '{error}\n\n现在按保存的参数把它启动回来吗？',
      'toast.recoverFailed': '恢复失败',
      'toast.actionOk': '{name} · {action} 成功',
      'toast.actionFailed': '{name} · {action} 失败：{error}',
      'toast.forgetConfirm': '从任务清单移除「{name}」？\n（只删掉本地记录的启动参数，不影响 pm2 里正在跑的进程）',
      'toast.forgetFailed': '移除失败：{error}',
      'toast.forgotten': '已从任务清单移除 {name}',
      'toast.savedList': '已执行 pm2 save，列表写入 dump.pm2',
      'toast.saveFailed': '保存失败：{error}',
      'toast.resurrectConfirm': '按 dump.pm2 恢复进程列表？\n（会把 dump 里登记的进程重新拉起）',
      'toast.resurrected': '已按 dump.pm2 恢复进程',
      'toast.resurrectFailed': '恢复失败：{error}',
      'toast.targetRequired': '启动目标不能为空',
      'toast.defSaved': '任务参数已保存',
      'toast.scriptRequired': '请填写脚本路径',
      'toast.started': '启动成功，参数已记入任务清单',
      'toast.startFailed': '启动失败：{error}',

      'drawer.title': '日志',

      'add.title': '启动新进程',
      'add.desc': '使用 <code>pm2 start</code> 启动一个脚本或 ecosystem 配置文件。',
      'add.target': '脚本 / 配置文件路径',
      'add.targetPh': '/绝对路径/app.js 或 ecosystem.config.js',
      'add.name': '进程名称（可选）',
      'add.cwd': '工作目录（可选）',
      'add.cwdPh': '/绝对路径/project',
      'add.port': '端口（可选，会以 --port 传入）',
      'add.args': '脚本参数（可选，每行一个；填了就以它为准）',

      'edit.title': '编辑任务参数',
      'edit.desc': '这就是「恢复启动」时会执行的 <code>pm2 start</code> 内容。改过的任务会被标记为「已校对」，pm2 的自动收割不再覆盖它。',
      'edit.name': '进程名称',
      'edit.target': '脚本 / 配置文件路径',
      'edit.targetPh': '/绝对路径/app.js',
      'edit.cwd': '工作目录（可选）',
      'edit.port': '端口（可选，会以 --port 传入）',
      'edit.args': '脚本参数（可选，每行一个，按顺序传入）',
      'edit.note': '备注（可选）',
      'edit.notePh': '这个任务是干嘛的',

      'update.title': '版本与更新',
      'update.checking': '正在检查最新版本…',
      'update.current': '当前版本',
      'update.latest': '最新版本',
      'update.mode': '安装方式',
      'update.recheck': '重新检查',
      'update.restart': '重启面板',
      'update.apply': '立即更新',
      'update.applying': '更新中…',
      'update.checkFailed': '检查失败',
      'update.cannotFetch': '无法获取最新版本：{error}',
      'update.found': '发现新版本 v{latest}（当前 v{current}），可以一键更新',
      'update.upToDate': '已经是最新版本',
      'update.notSupported': '当前安装方式不支持自动更新',
      'update.chipHasUpdate': '发现新版本 v{latest}，点击一键更新',
      'update.chipError': '更新检查失败：{error}',
      'update.confirmApply': '确定更新到最新版本吗？\n（会执行对应更新命令，完成后需要重启面板才会生效）',
      'update.running': '正在更新，请勿关闭页面…',
      'update.streamBroken': '更新连接中断，请查看服务端终端输出确认结果',
      'update.doneLine': '✓ 更新完成：v{from} → v{to}',
      'update.doneToast': '已更新到 v{to}，重启面板后生效',
      'update.doneNoChange': '更新命令执行完毕',
      'update.ready': 'v{version} 已就位，重启面板后生效',
      'update.alreadyLatest': '已是最新版本，无需更新',
      'update.failedToast': '更新失败：{error}',
      'update.failedUnknown': '未知错误',
      'update.restarting': '面板正在重启，稍后自动刷新页面…',
      'update.restartTriggered': '已触发 pm2 重启，6 秒后自动刷新',
      'update.restartManual': '请手动重启面板',
      'update.restartInTerminal': '请在终端里重启面板',
      'update.restartFailed': '重启失败：{error}',
    },

    'en-US': {
      'app.title': 'pm2-ui · PM2 Process & Port Monitor',
      'app.heading': 'PM2 Process & Port Monitor',
      'app.connecting': 'Connecting…',
      'app.managerLine': '{host} · {platform} · manager pid {pid}',

      'pm2.detecting': 'Checking',
      'pm2.notFound': 'pm2 not found',
      'pm2.version': 'PM2 v{version}',
      'pm2.readFailed': 'Failed to read PM2 state: {error}',
      'pm2.connectFailed': 'Cannot reach the backend: {error}',

      'common.refresh': 'Refresh',
      'common.refreshNow': 'Refresh now',
      'common.refreshed': 'Refreshed',
      'common.auto': 'Auto',
      'common.autoTitle': 'Refresh automatically every 3 seconds',
      'common.all': 'All',
      'common.online': 'Online',
      'common.stopped': 'Stopped',
      'common.errored': 'Errored',
      'common.launching': 'Launching',
      'common.stopping': 'Stopping',
      'common.hasPorts': 'Listening',
      'common.addProcess': '＋ Start process',
      'common.cancel': 'Cancel',
      'common.start': 'Start',
      'common.stop': 'Stop',
      'common.restart': 'Restart',
      'common.reload': 'Reload',
      'common.delete': 'Delete',
      'common.logs': 'Logs',
      'common.edit': 'Edit',
      'common.remove': 'Remove',
      'common.save': 'Save',
      'common.close': 'Close',
      'common.clear': 'Clear',
      'common.recover': 'Recover',
      'common.live': 'Live',
      'common.liveLog': 'Live log',
      'common.verified': 'Curated',
      'common.versionAndUpdate': 'Version & update',
      'common.newVersion': 'New version',
      'common.declaredPort': 'Declared port',
      'common.verifiedTitle': 'Manually curated — pm2 harvesting will no longer overwrite it',
      'common.removeDisabledTitle': 'Still managed by pm2, so it would be re-harvested right away; delete it from the process card first',
      'common.language': 'Language / 语言',
      'common.unknown': 'unknown',
      'common.fail': 'Action failed',

      'search.placeholder': 'Search name, script path, port…',

      'stat.total': 'Processes',
      'stat.online': 'Online',
      'stat.stopped': 'Stopped / errored',
      'stat.listening': 'Listening ports',
      'stat.http': 'Of which web',
      'stat.cpu': 'Total CPU',
      'stat.memory': 'Total memory',

      'apps.title': 'Saved apps',
      'apps.desc': 'Launch parameters of every app are stored locally. Even if pm2 drops the app — or the whole list is lost after a pm2 restart — you can bring it back with one click. To purge a record completely: delete it from the process card first, then remove it here.',
      'apps.saveList': 'pm2 save',
      'apps.saveListTitle': 'Run pm2 save to write the current list into dump.pm2',
      'apps.resurrect': 'Restore all',
      'apps.resurrectTitle': 'Run pm2 resurrect to bring back every process in dump.pm2',
      'apps.empty': 'The app list is empty. Start something with “＋ Start process”, or run <code>pm2 start</code> in a terminal and refresh — its launch parameters will be picked up automatically.',
      'apps.dumpHint': 'dump.pm2 <b>{count}</b> entries · {time}',
      'apps.dumpHintAutosave': ' · autosave on',
      'apps.dumpNotReady': 'dump.pm2 not created yet',
      'apps.stateOnline': 'Online',
      'apps.stateStopped': 'Stopped',
      'apps.stateMissing': 'Gone from pm2',
      'apps.savedFromDef': '{name} started with the saved parameters',

      'empty.title': 'No PM2 processes yet',
      'empty.desc': 'Click “Start process” in the top-right corner, or run <code>npm run demo:start</code> to launch a few demo apps.',

      'grid.noMatch': 'No matching process',
      'grid.entry': 'entry',
      'grid.portCount': '{n} port(s)',
      'grid.pid': 'pid',

      'metric.cpu': 'CPU',
      'metric.memory': 'Memory',
      'metric.restarts': 'Restarts',
      'metric.uptime': 'Uptime',
      'spark.trend': 'CPU trend',
      'spark.peak': '{value}% peak',

      'ports.title': 'Listening ports',
      'ports.summary': '{total} total · Web {web} · Other {other}',
      'ports.noneOnline': 'No listening port detected (this process may not be a network service)',
      'ports.noneStopped': 'Process is not running — ports cannot be probed',
      'ports.openTip': 'Click to open in a new tab',
      'ports.server': 'Server: {server}',
      'ports.infra': 'Common middleware port',
      'ports.fromEnv': 'Declared via environment variable',
      'ports.tcpOnly': 'TCP only, not a web service',
      'ports.reason.stopped': 'Process stopped, port not listening',
      'ports.reason.ECONNREFUSED': 'Connection refused while probing',
      'ports.reason.timeout': 'No response before the timeout',
      'ports.reason.ECONNRESET': 'Connection reset',
      'ports.reason.EPROTO': 'Not an HTTP/TLS protocol',
      'ports.reason.no-response': 'No HTTP response',

      'toast.deleteConfirm': 'Remove “{name}” from the pm2 list?\n(No file is deleted — it is only taken out of pm2; the launch parameters stay in the saved-apps list below and can be recovered anytime)',
      'toast.recoverConfirm': '{error}\n\nStart it again with the saved parameters now?',
      'toast.recoverFailed': 'Recovery failed',
      'toast.actionOk': '{name} · {action} succeeded',
      'toast.actionFailed': '{name} · {action} failed: {error}',
      'toast.forgetConfirm': 'Remove “{name}” from the saved-apps list?\n(Only the locally stored parameters are dropped; processes running under pm2 are untouched)',
      'toast.forgetFailed': 'Remove failed: {error}',
      'toast.forgotten': 'Removed {name} from the saved-apps list',
      'toast.savedList': 'pm2 save done — the list was written to dump.pm2',
      'toast.saveFailed': 'Save failed: {error}',
      'toast.resurrectConfirm': 'Restore the process list from dump.pm2?\n(Every process recorded in the dump will be started again)',
      'toast.resurrected': 'Processes restored from dump.pm2',
      'toast.resurrectFailed': 'Restore failed: {error}',
      'toast.targetRequired': 'Launch target cannot be empty',
      'toast.defSaved': 'App parameters saved',
      'toast.scriptRequired': 'Please fill in the script path',
      'toast.started': 'Started — parameters stored in the saved-apps list',
      'toast.startFailed': 'Start failed: {error}',

      'drawer.title': 'Logs',

      'add.title': 'Start a new process',
      'add.desc': 'Start a script or an ecosystem config file with <code>pm2 start</code>.',
      'add.target': 'Script / config file path',
      'add.targetPh': '/absolute/path/app.js or ecosystem.config.js',
      'add.name': 'Process name (optional)',
      'add.cwd': 'Working directory (optional)',
      'add.cwdPh': '/absolute/path/project',
      'add.port': 'Port (optional, passed as --port)',
      'add.args': 'Script arguments (optional, one per line; used as-is when provided)',

      'edit.title': 'Edit app parameters',
      'edit.desc': 'This is the exact <code>pm2 start</code> that “Recover” will run. Edited apps are marked as curated and are no longer overwritten by pm2 harvesting.',
      'edit.name': 'Process name',
      'edit.target': 'Script / config file path',
      'edit.targetPh': '/absolute/path/app.js',
      'edit.cwd': 'Working directory (optional)',
      'edit.port': 'Port (optional, passed as --port)',
      'edit.args': 'Script arguments (optional, one per line, passed in order)',
      'edit.note': 'Note (optional)',
      'edit.notePh': 'What is this app for?',

      'update.title': 'Version & update',
      'update.checking': 'Checking for the latest version…',
      'update.current': 'Current',
      'update.latest': 'Latest',
      'update.mode': 'Install mode',
      'update.recheck': 'Check again',
      'update.restart': 'Restart dashboard',
      'update.apply': 'Update now',
      'update.applying': 'Updating…',
      'update.checkFailed': 'Check failed',
      'update.cannotFetch': 'Cannot fetch the latest version: {error}',
      'update.found': 'New version v{latest} available (current v{current}) — one click to update',
      'update.upToDate': 'Already on the latest version',
      'update.notSupported': 'This install mode does not support auto-update',
      'update.chipHasUpdate': 'New version v{latest} is available — click to update',
      'update.chipError': 'Update check failed: {error}',
      'update.confirmApply': 'Update to the latest version?\n(The matching update command will run; restart the dashboard afterwards to apply it)',
      'update.running': 'Updating — please keep this page open…',
      'update.streamBroken': 'Update stream was interrupted; check the server terminal output to confirm the result',
      'update.doneLine': '✓ Update finished: v{from} → v{to}',
      'update.doneToast': 'Updated to v{to} — restart the dashboard to apply',
      'update.doneNoChange': 'Update command finished',
      'update.ready': 'v{version} is in place — restart the dashboard to apply',
      'update.alreadyLatest': 'Already up to date, nothing to update',
      'update.failedToast': 'Update failed: {error}',
      'update.failedUnknown': 'unknown error',
      'update.restarting': 'The dashboard is restarting; the page will reload shortly…',
      'update.restartTriggered': 'pm2 restart triggered — reloading in 6 seconds',
      'update.restartManual': 'Please restart the dashboard manually',
      'update.restartInTerminal': 'Please restart the dashboard from the terminal',
      'update.restartFailed': 'Restart failed: {error}',
    },
  };

  /* ------------------------------ 运行时 ------------------------------ */

  let current = FALLBACK;

  function normalize(input) {
    const s = String(input || '').trim().toLowerCase();
    if (!s) return '';
    if (s.startsWith('zh')) return 'zh-CN';
    if (s.startsWith('en')) return 'en-US';
    return '';
  }

  function detect() {
    try {
      const saved = normalize(localStorage.getItem(STORAGE_KEY));
      if (saved) return saved;
    } catch (_) { /* 隐私模式下 localStorage 可能不可用 */ }
    const list = (navigator.languages && navigator.languages.length)
      ? navigator.languages
      : [navigator.language];
    for (const l of list) {
      const hit = normalize(l);
      if (hit) return hit;
    }
    return FALLBACK;
  }

  function interpolate(str, params) {
    if (!params) return str;
    return str.replace(/\{(\w+)\}/g, (m, k) => (params[k] === undefined || params[k] === null ? m : String(params[k])));
  }

  function t(key, params) {
    const dict = messages[current] || messages[FALLBACK];
    let s = dict[key];
    if (s === undefined) s = messages[FALLBACK][key];
    if (s === undefined) return key;
    return interpolate(s, params);
  }

  /** 运行时长文案（随语言变化） */
  function formatUptime(ms) {
    if (!ms) return '—';
    const sec = Math.floor((Date.now() - ms) / 1000);
    if (sec < 0) return '—';
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (current === 'en-US') {
      if (d) return `${d}d ${h}h`;
      if (h) return `${h}h ${m}m`;
      if (m) return `${m}m ${s}s`;
      return `${s}s`;
    }
    if (d) return `${d}天 ${h}时`;
    if (h) return `${h}时 ${m}分`;
    if (m) return `${m}分 ${s}秒`;
    return `${s} 秒`;
  }

  /* --------------------- 静态文案替换 / 同步界面 --------------------- */

  function applyStatic(root) {
    const scope = root || document;
    for (const el of scope.querySelectorAll('[data-i18n]')) {
      el.textContent = t(el.getAttribute('data-i18n'));
    }
    for (const el of scope.querySelectorAll('[data-i18n-html]')) {
      el.innerHTML = t(el.getAttribute('data-i18n-html'));
    }
    for (const el of scope.querySelectorAll('[data-i18n-placeholder]')) {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    }
    for (const el of scope.querySelectorAll('[data-i18n-title]')) {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    }
  }

  function syncSelect() {
    const sel = document.getElementById('langSelect');
    if (sel) sel.value = current;
  }

  function apply(root) {
    document.documentElement.lang = current;
    document.title = t('app.title');
    applyStatic(root);
    syncSelect();
  }

  function setLang(lang, opts = {}) {
    const next = normalize(lang) || FALLBACK;
    const changed = next !== current;
    current = next;
    try { localStorage.setItem(STORAGE_KEY, current); } catch (_) { /* ignore */ }
    apply();
    if (changed && !opts.silent) {
      global.dispatchEvent(new CustomEvent('pm2ui:langchange', { detail: { lang: current } }));
    }
    return current;
  }

  function bind() {
    const sel = document.getElementById('langSelect');
    if (sel && !sel.dataset.bound) {
      sel.dataset.bound = '1';
      sel.addEventListener('change', (e) => setLang(e.target.value));
    }
  }

  current = detect();

  global.i18n = {
    SUPPORTED,
    FALLBACK,
    STORAGE_KEY,
    messages,
    t,
    normalize,
    formatUptime,
    apply,
    applyStatic,
    bind,
    setLang,
    get lang() { return current; },
    get locale() { return current; },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { apply(); bind(); });
  } else {
    apply();
    bind();
  }
})(window);
