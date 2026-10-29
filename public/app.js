/* ============================================================
   PM2 进程与端口监控 — 前端 / Frontend
   （所有面向用户的文案都经 window.i18n.t() 取用）
   ============================================================ */

const $ = (id) => document.getElementById(id);
const t = (key, params) => window.i18n.t(key, params);

/** 给接口地址带上当前语言，服务端据此本地化返回文案 */
function api(path) {
  const sep = path.includes('?') ? '&' : '?';
  return path + sep + 'lang=' + encodeURIComponent(window.i18n.lang);
}

const state = {
  processes: [],
  apps: [],
  overview: null,
  filter: 'all',
  keyword: '',
  autoRefresh: true,
  timer: null,
  history: new Map(),      // name -> { cpu: [], mem: [] }
  busy: new Set(),         // 正在执行操作的进程名
  logStream: null,
  logTarget: null,
  editing: null,           // 正在编辑的任务名
  order: [],               // 任务显示顺序（服务端持久化）
  dragName: null,          // 正在拖动的任务名
  orderSaving: 0,          // 正在保存排序的请求数
  loadSeq: 0,              // 刷新请求序号
  orderSeq: 0,             // 顺序最后一次本地变更时，已经发出的刷新请求数
  update: null,            // 版本 / 更新检查结果
  updateAutoCheck: true,   // 服务端是否允许自动检查更新
  updateChecked: false,
  updateStream: null,      // 更新日志的 SSE
  updating: false,
  view: (() => {           // 任务显示方式：list / card
    try { return localStorage.getItem('pm2-ui-view') === 'list' ? 'list' : 'card'; } catch (_) { return 'card'; }
  })(),
};

/* ------------------------------ 工具 ------------------------------ */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtBytes(n) {
  if (!n) return '0';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)) + ' ' + u[i];
}

const fmtUptime = (ms) => window.i18n.formatUptime(ms);

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 320);
  }, 2600);
}

const STATUS_KEY = {
  online: 'common.online', stopped: 'common.stopped', errored: 'common.errored',
  launching: 'common.launching', stopping: 'common.stopping',
};
const statusText = (s) => (STATUS_KEY[s] ? t(STATUS_KEY[s]) : s);

/* ------------------------------ 数据 ------------------------------ */

async function load({ silent = false } = {}) {
  const seq = ++state.loadSeq;
  try {
    const q = '?refresh=' + (silent ? '0' : '1');
    const [pRes, oRes, aRes] = await Promise.all([
      fetch(api('/api/processes' + q)).then((r) => r.json()),
      fetch(api('/api/overview' + q)).then((r) => r.json()),
      fetch(api('/api/apps' + q)).then((r) => r.json()),
    ]);

    if (oRes.pm2 && !oRes.pm2.available) {
      $('pm2Badge').className = 'pm2-badge bad';
      $('pm2Text').textContent = t('pm2.notFound');
    } else if (oRes.pm2) {
      $('pm2Badge').className = 'pm2-badge ok';
      $('pm2Text').textContent = t('pm2.version', { version: oRes.pm2.version });
    }

    $('hostLine').textContent = t('app.managerLine', {
      host: oRes.host, platform: oRes.platform, pid: oRes.manager.pid,
    });
    state.overview = oRes;
    state.processes = pRes.processes || [];
    state.apps = aRes.apps || [];
    // 排序之前就发出的请求，响应里带的是旧顺序 —— 套上去会闪一下，直接丢掉
    const fresh = seq > state.orderSeq;
    if (Array.isArray(aRes.order) && !state.orderSaving && fresh) {
      state.order = aRes.order;
      // 服务端顺序表漏了任务时补一次，否则这些任务会一直掉到末尾（历史数据 / 部分写入）
      const known = new Set(aRes.order);
      const missing = buildTasks().map((x) => x.name).filter((n) => !known.has(n));
      if (missing.length) saveOrder(aRes.order.concat(missing));
    }
    if (oRes.update) applyUpdateInfo(oRes.update);

    if (oRes.error) toast(t('pm2.readFailed', { error: oRes.error }), 'err');

    state.processes.forEach((p) => {
      const h = state.history.get(p.name) || { cpu: [], mem: [] };
      h.cpu.push(p.cpu || 0);
      h.mem.push(p.memory || 0);
      if (h.cpu.length > 40) h.cpu.shift();
      if (h.mem.length > 40) h.mem.shift();
      state.history.set(p.name, h);
    });

    renderStats();
    renderDumpHint(oRes);
    render();
  } catch (e) {
    toast(t('pm2.connectFailed', { error: e.message }), 'err');
  }
}

/* ------------------------------ 渲染 ------------------------------ */

function renderStats() {
  const s = state.overview?.stats || {};
  $('statbar').innerHTML = `
    <div class="stat"><div class="k">${esc(t('stat.total'))}</div><div class="v">${s.total ?? 0}</div></div>
    <div class="stat good"><div class="k">${esc(t('stat.online'))}</div><div class="v">${s.online ?? 0}</div></div>
    <div class="stat"><div class="k">${esc(t('stat.stopped'))}</div><div class="v">${s.stopped ?? 0}</div></div>
    <div class="stat accent"><div class="k">${esc(t('stat.listening'))}</div><div class="v">${s.listening ?? 0}</div></div>
    <div class="stat accent"><div class="k">${esc(t('stat.http'))}</div><div class="v">${s.httpPorts ?? 0}</div></div>
    <div class="stat"><div class="k">${esc(t('stat.cpu'))}</div><div class="v">${s.cpu ?? 0}<small>%</small></div></div>
    <div class="stat"><div class="k">${esc(t('stat.memory'))}</div><div class="v">${fmtBytes(s.memory || 0)}</div></div>
  `;
}

/** 把 pm2 的实时进程与本地保存的任务定义合并成统一的任务列表 */
function buildTasks() {
  const map = new Map();
  for (const p of state.processes) map.set(p.name, { name: p.name, proc: p, app: null });
  for (const a of state.apps || []) {
    const cur = map.get(a.name) || { name: a.name, proc: null, app: null };
    cur.app = a;
    map.set(a.name, cur);
  }

  const tasks = [...map.values()];
  // 按用户拖出来的顺序排；没排过的（新任务）留在末尾，保持原有相对次序
  if (state.order.length) {
    const idx = new Map(state.order.map((name, i) => [name, i]));
    const rank = (name) => (idx.has(name) ? idx.get(name) : Infinity);
    tasks.sort((x, y) => {
      const a = rank(x.name);
      const b = rank(y.name);
      return a === b ? 0 : (a < b ? -1 : 1);
    });
  }
  return tasks;
}

/** 任务状态：以 pm2 实时状态为准；pm2 已经不认的任务记为 missing */
const taskStatus = (task) => (task.proc ? task.proc.status : 'missing');

function taskMatches(task) {
  const p = task.proc;
  const a = task.app || {};
  const running = taskStatus(task) === 'online';

  if (state.filter === 'online' && !running) return false;
  if (state.filter === 'stopped' && running) return false;
  if (state.filter === 'ports' && !((p && p.ports) || []).length) return false;
  if (state.keyword) {
    const k = state.keyword.toLowerCase();
    const hay = [task.name, p && p.script, p && p.cwd, a.target, a.cwd, a.note,
      ...(((p && p.ports) || []).map((e) => e.port))]
      .filter(Boolean).join(' ').toLowerCase();
    if (!hay.includes(k)) return false;
  }
  return true;
}

function sparkline(values, color) {
  if (!values || values.length < 2) return '';
  const w = 100, h = 30;
  const max = Math.max(...values, 1);
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 6)).toFixed(1)}`);
  const line = pts.join(' ');
  const area = `0,${h} ${line} ${w},${h}`;
  const id = 'g' + Math.random().toString(36).slice(2, 8);
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity=".28"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    <polygon points="${area}" fill="url(#${id})"/>
    <polyline points="${line}" fill="none" stroke="${color}" stroke-width="1.6"
      stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

/** 单个端口的展示：HTTP 端口整体是一个链接，点击在新标签页打开 */
function portChip(p) {
  const openIcon = `<svg viewBox="0 0 24 24" width="12" height="12"><path d="M14 3v2h3.6l-9.8 9.8 1.4 1.4L19 6.4V10h2V3h-7zM5 5h5V3H3v18h18v-7h-2v5H5V5z" fill="currentColor"/></svg>`;

  if (p.verified) {
    const url = p.url || `${p.protocol}://localhost:${p.port}`;
    const tip = [t('ports.openTip'), t('ports.server', { server: p.server || t('common.unknown') }),
      p.infra ? t('ports.infra') : '', p.source === 'env' ? t('ports.fromEnv') : '']
      .filter(Boolean).join(' · ');
    return `
      <a class="port web" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${esc(tip)}">
        <span class="pnum">:${p.port}</span>
        <span class="pproto">${esc(p.protocol)}</span>
        ${p.status ? `<span class="pstatus">${p.status}</span>` : ''}
        <span class="purl">${esc(url)}</span>
        <span class="popen">${openIcon}</span>
      </a>`;
  }
  const reasonKey = 'ports.reason.' + p.reason;
  const desc = p.infra
    ? t('ports.infra')
    : (p.reason && window.i18n.messages[window.i18n.lang][reasonKey] ? t(reasonKey) : (p.reason || t('ports.tcpOnly')));
  return `
    <div class="port tcp" title="${esc(desc)}">
      <span class="pnum">:${p.port}</span>
      <span class="pproto">tcp</span>
      <span class="pdesc">${esc(desc)}</span>
    </div>`;
}

/** 端口监控区块 */
function portBlock(p) {
  const ports = p.ports || [];

  if (!ports.length) {
    const hint = p.status === 'online' ? t('ports.noneOnline') : t('ports.noneStopped');
    return `
      <div class="port-block">
        <div class="port-none">
          <svg viewBox="0 0 24 24" width="15" height="15"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" fill="currentColor"/></svg>
          <span>${esc(hint)}</span>
        </div>
      </div>`;
  }

  const webPorts = ports.filter((x) => x.verified);
  const otherPorts = ports.filter((x) => !x.verified);

  return `
    <div class="port-block">
      <div class="port-head">
        <span class="port-title">${esc(t('ports.title'))}</span>
        <span class="port-summary">${esc(t('ports.summary', { total: ports.length, web: webPorts.length, other: otherPorts.length }))}</span>
      </div>
      <div class="port-list">${ports.map(portChip).join('')}</div>
    </div>`;
}

function render() {
  // 拖动过程中不重画：3 秒一次的自动刷新会把拖到一半的卡片冲掉
  if (state.dragName) return;

  const grid = $('grid');
  const tasks = buildTasks();
  const list = tasks.filter(taskMatches);

  $('taskCount').textContent = tasks.length;
  $('emptyState').hidden = tasks.length > 0;
  grid.className = state.view === 'list' ? 'task-list' : 'grid';

  if (!list.length) {
    grid.innerHTML = tasks.length ? `<p class="no-match muted">${esc(t('grid.noMatch'))}</p>` : '';
    return;
  }

  grid.innerHTML = list.map(state.view === 'list' ? renderTaskRow : renderTaskCard).join('');
}

/** 任务可执行的操作：列表视图与卡片视图共用同一套按钮 */
function taskActions(task) {
  const { name, proc: p, app: a } = task;
  const dis = state.busy.has(name) ? 'disabled' : '';
  const btn = (act, label, cls = '') =>
    `<button class="btn sm ${cls}" data-act="${act}" data-name="${esc(name)}" ${dis}>${esc(label)}</button>`;
  const parts = [];

  // 日志：pm2 里还有这个进程才能读到
  parts.push(p
    ? btn('logs', t('common.logs'))
    : `<button class="btn sm" disabled title="${esc(t('common.logsUnavailable'))}">${esc(t('common.logs'))}</button>`);

  if (p && p.status === 'online') {
    parts.push(btn('restart', t('common.restart')), btn('reload', t('common.reload')), btn('stop', t('common.stop'), 'danger'));
  } else if (p) {
    parts.push(btn('start', t('common.start'), 'primary'), btn('delete', t('common.delete'), 'danger'));
  } else if (a) {
    parts.push(btn('recover', t('common.recover'), 'primary'));
  }

  if (a) {
    parts.push(btn('edit', t('common.edit')));
    // 「移除」只对 pm2 已经不认的任务开放，否则会被自动收割重新收录
    parts.push(p
      ? `<button class="btn sm ghost" disabled title="${esc(t('common.removeDisabledTitle'))}">${esc(t('common.remove'))}</button>`
      : btn('forget', t('common.remove'), 'ghost'));
  }

  return parts.join('');
}

/** 状态 / 端口 / 已校对 等标签 */
function taskPills(task) {
  const { proc: p, app: a } = task;
  const st = taskStatus(task);
  const out = [`<span class="pill ${esc(st)}">${esc(st === 'missing' ? t('apps.stateMissing') : statusText(st))}</span>`];

  const ports = (p && p.ports) || [];
  ports.slice(0, 3).forEach((po) => {
    if (po.verified && po.url) {
      out.push(`<a class="pill port link" href="${esc(po.url)}" target="_blank" rel="noopener noreferrer" title="${esc(t('ports.openTip'))}">:${po.port}</a>`);
    } else {
      out.push(`<span class="pill port">:${po.port}</span>`);
    }
  });
  if (ports.length > 3) out.push(`<span class="pill port">+${ports.length - 3}</span>`);
  if (!p && a && a.port) out.push(`<span class="pill port" title="${esc(t('common.declaredPort'))}">:${esc(a.port)}</span>`);
  if (a && a.source === 'manual') out.push(`<span class="pill manual" title="${esc(t('common.verifiedTitle'))}">${esc(t('common.verified'))}</span>`);

  return out.join('');
}

/** 拖动手柄：只有从它按下才能拖动排序，避免误触按钮和选中文字 */
function dragHandle() {
  const label = esc(t('common.dragToSort'));
  return `<span class="drag-handle" title="${label}" aria-label="${label}">
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M8 5h2v2H8zM14 5h2v2h-2zM8 9h2v2H8zM14 9h2v2h-2zM8 13h2v2H8zM14 13h2v2h-2zM8 17h2v2H8zM14 17h2v2h-2z" fill="currentColor"/></svg>
  </span>`;
}

/** 列表视图：一行一个任务 */
function renderTaskRow(task) {
  const { name, proc: p, app: a } = task;
  const running = taskStatus(task) === 'online';
  const sub = (p && p.script) || (a && (a.target || a.cmd)) || '';

  const metrics = running
    ? `<div class="task-metrics">
        <span><b>${(p.cpu || 0).toFixed(1)}</b><i>%</i></span>
        <span><b>${fmtBytes(p.memory)}</b></span>
        <span><b>${fmtUptime(p.uptime)}</b></span>
      </div>`
    : '';

  return `
  <div class="task-row ${running ? '' : 'is-stopped'}" data-name="${esc(name)}">
    ${dragHandle()}
    <span class="status-dot ${esc(taskStatus(task))}"></span>
    <div class="task-main">
      <div class="task-name"><b>${esc(name)}</b>${taskPills(task)}</div>
      <div class="task-sub" title="${esc(sub)}">${esc(sub || '—')}</div>
      ${a && a.note ? `<div class="app-meta" title="${esc(a.note)}">${esc(a.note)}</div>` : ''}
    </div>
    ${metrics}
    <div class="task-actions">${taskActions(task)}</div>
  </div>`;
}

/** 卡片视图：一个任务一张卡 */
function renderTaskCard(task) {
  const { name, proc: p, app: a } = task;
  const running = taskStatus(task) === 'online';

  // pm2 已经不认这个任务了，只剩本地保存的启动参数
  if (!p) {
    return `
    <article class="card is-missing" data-name="${esc(name)}">
      <div class="card-head">
        ${dragHandle()}
        <span class="status-dot missing"></span>
        <div style="min-width:0">
          <div class="card-title">${esc(name)}</div>
          <div class="card-meta">${esc(t('grid.savedOnly'))}</div>
        </div>
        <div class="card-head-right">
          <span class="pill missing">${esc(t('apps.stateMissing'))}</span>
          ${a.port ? `<span class="pill port" title="${esc(t('common.declaredPort'))}">:${esc(a.port)}</span>` : ''}
        </div>
      </div>
      <div class="card-body">
        <div class="pathline" title="${esc(a.target || '')}"><b>${esc(t('grid.entry'))}</b> ${esc(a.target || '—')}</div>
        ${a.note ? `<div class="app-meta" style="margin-top:8px">${esc(a.note)}</div>` : ''}
      </div>
      <div class="card-foot">
        <span class="pid">${esc(t('apps.stateMissing'))}</span>
        <div class="spacer"></div>
        <div class="card-actions">${taskActions(task)}</div>
      </div>
    </article>`;
  }

  const h = state.history.get(name) || { cpu: [], mem: [] };

  return `
  <article class="card ${running ? '' : 'is-stopped'}" data-name="${esc(p.name)}">
    <div class="card-head">
      ${dragHandle()}
      <span class="status-dot ${esc(p.status)}"></span>
      <div style="min-width:0">
        <div class="card-title">${esc(p.name)}</div>
        <div class="card-meta">${esc(p.execMode || 'fork')}${p.instances > 1 ? ' ×' + p.instances : ''} · ${esc(p.namespace)}</div>
      </div>
      <div class="card-head-right">
        <span class="pill ${esc(p.status)}">${esc(statusText(p.status))}</span>
        <span class="pill pmid">${esc(t('grid.portCount', { n: (p.ports || []).length }))}</span>
      </div>
    </div>

    ${portBlock(p)}

    <div class="card-body">
      <div class="metrics">
        <div class="metric"><div class="k">${esc(t('metric.cpu'))}</div><div class="v">${(p.cpu || 0).toFixed(1)}<span>%</span></div></div>
        <div class="metric"><div class="k">${esc(t('metric.memory'))}</div><div class="v">${fmtBytes(p.memory)}</div></div>
        <div class="metric"><div class="k">${esc(t('metric.restarts'))}</div><div class="v">${p.restarts}${p.unstableRestarts ? `<span> +${p.unstableRestarts}</span>` : ''}</div></div>
        <div class="metric"><div class="k">${esc(t('metric.uptime'))}</div><div class="v" style="font-size:13px">${running ? fmtUptime(p.uptime) : '—'}</div></div>
      </div>
      <div class="spark">
        <div class="spark-label"><span>${esc(t('spark.trend'))}</span><span>${h.cpu.length ? esc(t('spark.peak', { value: Math.max(...h.cpu).toFixed(0) })) : ''}</span></div>
        ${sparkline(h.cpu, '#2f6bff')}
      </div>
      <div class="pathline" title="${esc(p.script)}"><b>${esc(t('grid.entry'))}</b> ${esc(p.script || '—')}</div>
    </div>

    <div class="card-foot">
      <span class="pid">${esc(t('grid.pid'))} ${p.pid || '—'} · #${p.pmId}</span>
      <div class="spacer"></div>
      <div class="card-actions">${taskActions(task)}</div>
    </div>
  </article>`;
}

/* --------------------------- 拖动排序 --------------------------- */

/**
 * 把可见任务的顺序合并回完整顺序：
 * 被筛选隐藏的任务保持原位，参与拖动的任务按新顺序填回它们原本占的位置。
 */
function commitOrder(visible) {
  const full = buildTasks().map((x) => x.name);
  // 只填回「当前还存在的任务」：拖动期间任务被删除 / 新增时两边集合对不上，直接对应会错位
  const known = new Set(full);
  const seen = new Set();
  // 去重 + 只保留当前存在的任务：拿到的顺序里混进按钮、重复项时也不会把结果算歪
  const moved = visible.filter((name) => {
    if (!known.has(name) || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
  const movedSet = new Set(moved);
  let i = 0;
  const next = full.map((name) => (movedSet.has(name) ? moved[i++] : name));

  // 数据暂时不全（这一秒只拿到部分任务）时，别把还没出现的任务从顺序表里丢掉
  const kept = new Set(next);
  for (const name of state.order) {
    if (!known.has(name) && !kept.has(name)) { kept.add(name); next.push(name); }
  }

  state.order = next;
  // 此刻在飞的刷新请求都是排序前发出的，别让它们的旧顺序覆盖回来
  state.orderSeq = state.loadSeq;
  return next;
}

async function saveOrder(order) {
  state.orderSaving++;
  try {
    const j = await post(api('/api/apps/order'), { order });
    if (!j.ok) throw new Error(j.error || t('common.fail'));
    if (Array.isArray(j.order)) {
      // 服务端回来的顺序和提交的不一样，说明落盘时被改写了，留个痕迹方便排查
      if (j.order.join('\n') !== order.join('\n')) {
        console.warn('[pm2-ui] 排序回写不一致', { sent: order, got: j.order });
      }
      state.order = j.order;
    }
    // 落盘之前发出的刷新请求同样带的是旧顺序
    state.orderSeq = state.loadSeq;
  } catch (e) {
    toast(t('common.orderSaveFailed', { error: e.message }), 'err');
  } finally {
    state.orderSaving--;
  }
}

/**
 * 任务元素（卡片 / 列表行）的定位选择器。
 * 注意不能只写 `[data-name]`：卡片内的操作按钮也带 data-name，
 * 那样查出来的"顺序"会混进一堆按钮，提交上去的顺序就是错的。
 */
const ITEM_SEL = '.card[data-name], .task-row[data-name]';

/** 网格里的任务元素，按 DOM 顺序 */
const gridItems = () => [...$('grid').children].filter((el) => el.matches(ITEM_SEL));

/**
 * FLIP：先量旧位置，再改 DOM，然后让被挤开的卡片从旧位置滑到新位置。
 * 不这么做的话每跨过一次中点，卡片就是硬跳一下，手感很顿。
 */
function flipMove(mutate, skip) {
  const items = gridItems().filter((el) => el !== skip);
  // 用 offset 而不是 rect：rect 会带上上一次动画残留的 transform，连续换位时会算错位移
  const before = items.map((el) => ({ x: el.offsetLeft, y: el.offsetTop }));

  mutate();

  items.forEach((el, i) => {
    const dx = before[i].x - el.offsetLeft;
    const dy = before[i].y - el.offsetTop;
    if (!dx && !dy) return;

    el.classList.add('flipping');
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    requestAnimationFrame(() => { el.style.transform = ''; });
    clearTimeout(el._flipTimer);
    el._flipTimer = setTimeout(() => {
      el.classList.remove('flipping');
      el.style.transform = '';
    }, 260);
  });
}

/* 不用原生 HTML5 拖放（draggable + dragstart/dragover）了：
   那套东西在部分环境里只有拖影在动、卡片本身没换位，松手后写回的仍是旧顺序。
   这里改用 pointer 事件自己实现：卡片直接 transform 跟手，命中判定用 elementFromPoint，
   换位立刻落到 DOM 上，松手时读到的顺序就是用户看到的顺序。 */

const DRAG_THRESHOLD = 4;
let drag = null;   // { el, name, pointerId, startX, startY, grabDX, grabDY, started }

/** 把拖动中的卡片摆到指针位置（先清 transform 量 layout，避免误差累积） */
function followPointer(d, x, y) {
  d.el.style.transform = '';
  const r = d.el.getBoundingClientRect();
  d.el.style.transform = `translate(${x - d.grabDX - r.left}px, ${y - d.grabDY - r.top}px)`;
}

$('grid').addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const handle = e.target.closest && e.target.closest('.drag-handle');
  const el = handle && handle.closest(ITEM_SEL);
  if (!el) return;

  const r = el.getBoundingClientRect();
  drag = {
    el,
    name: el.dataset.name,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    grabDX: e.clientX - r.left,
    grabDY: e.clientY - r.top,
    started: false,
  };
  e.preventDefault();   // 别触发原生拖拽 / 选中文字
});

document.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pointerId) return;

  if (!drag.started) {
    const moved = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    if (moved < DRAG_THRESHOLD) return;
    drag.started = true;
    drag.el.classList.add('dragging');
    state.dragName = drag.name;   // 拖动期间冻结重绘
  }

  e.preventDefault();
  followPointer(drag, e.clientX, e.clientY);

  // 拖动中的卡片设了 pointer-events:none，这里拿到的是它底下那张卡
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const target = under && under.closest && under.closest(ITEM_SEL);
  if (!target || target === drag.el) return;

  // 落到哪张卡上，就占哪张卡的位置（目标卡让位），跟鼠标在卡内偏左偏右无关
  const items = gridItems();
  const from = items.indexOf(drag.el);
  const to = items.indexOf(target);
  if (from < 0 || to < 0 || from === to) return;

  flipMove(() => (from > to ? target.before(drag.el) : target.after(drag.el)), drag.el);
  followPointer(drag, e.clientX, e.clientY);   // 换位后 layout 变了，重新贴一次指针
}, { passive: false });

function endDrag() {
  const d = drag;
  drag = null;
  if (!d) return;

  d.el.classList.remove('dragging');
  d.el.style.transform = '';
  if (!d.started) return;   // 只是点了一下手柄，不算拖动
  state.dragName = null;

  const names = gridItems().map((el) => el.dataset.name);
  const before = state.order.join('\n');
  const next = commitOrder(names);
  // 顺序真的变了才回写，原地放下不用打一次请求
  if (next.join('\n') !== before) saveOrder(next);
}

document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);
window.addEventListener('blur', endDrag);

/* ------------------------------ 操作 ------------------------------ */

async function doAction(name, act) {
  if (act === 'logs') return openLogs(name);
  if (act === 'edit') return openEdit(name);
  if (act === 'forget') return forgetTask(name);
  if (act === 'delete' && !confirm(t('toast.deleteConfirm', { name }))) return;

  state.busy.add(name);
  render();
  try {
    const url = act === 'recover'
      ? `/api/apps/${encodeURIComponent(name)}/start`
      : `/api/processes/${encodeURIComponent(name)}/${act}`;
    const res = await fetch(api(url), { method: 'POST' });
    const j = await res.json();
    if (!j.ok) {
      // pm2 已经不认这个进程，但本地还存着启动参数 —— 引导一键恢复
      if (j.recoverable && confirm(t('toast.recoverConfirm', { error: j.error }))) {
        const r = await post(api(`/api/apps/${encodeURIComponent(name)}/start`));
        if (!r.ok) throw new Error(r.error || t('toast.recoverFailed'));
        toast(t('apps.savedFromDef', { name }), 'ok');
        await load();
        return;
      }
      throw new Error(j.error || t('common.fail'));
    }
    toast(act === 'recover'
      ? t('apps.savedFromDef', { name })
      : t('toast.actionOk', { name, action: act }), 'ok');
    await load();
  } catch (e) {
    toast(t('toast.actionFailed', { name, action: act, error: e.message }), 'err');
  } finally {
    state.busy.delete(name);
    render();
  }
}

/** 从任务里移除本地保存的启动参数（不动 pm2 里正在跑的进程） */
async function forgetTask(name) {
  if (!confirm(t('toast.forgetConfirm', { name }))) return;
  try {
    const j = await fetch(api(`/api/apps/${encodeURIComponent(name)}`), { method: 'DELETE' }).then((r) => r.json());
    if (!j.ok) throw new Error(j.error || t('common.fail'));
    toast(t('toast.forgotten', { name }), 'ok');
    await load();
  } catch (e) {
    toast(t('toast.forgetFailed', { error: e.message }), 'err');
  }
}

/* --------------------------- dump.pm2 状态提示 --------------------------- */

function renderDumpHint(o) {
  const hint = $('dumpHint');
  const d = o && o.dump;
  if (!d) { hint.textContent = ''; return; }
  if (d.exists) {
    const time = new Date(d.mtime).toLocaleString(window.i18n.locale, { hour12: false });
    const suffix = o.autosave ? t('apps.dumpHintAutosave') : '';
    hint.innerHTML = t('apps.dumpHint', { count: d.count, time: esc(time) }) + esc(suffix);
  } else {
    hint.textContent = t('apps.dumpNotReady');
  }
  hint.title = d.file || '';
}

/* ------------------------------ 请求工具 ------------------------------ */

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

$('saveListBtn').addEventListener('click', async () => {
  const btn = $('saveListBtn');
  btn.disabled = true;
  try {
    const j = await post(api('/api/pm2/save'));
    if (!j.ok) throw new Error(j.error);
    toast(t('toast.savedList'), 'ok');
    await load();
  } catch (e) {
    toast(t('toast.saveFailed', { error: e.message }), 'err');
  } finally {
    btn.disabled = false;
  }
});

$('resurrectBtn').addEventListener('click', async () => {
  if (!confirm(t('toast.resurrectConfirm'))) return;
  const btn = $('resurrectBtn');
  btn.disabled = true;
  try {
    const j = await post(api('/api/pm2/resurrect'));
    if (!j.ok) throw new Error(j.error);
    toast(t('toast.resurrected'), 'ok');
    await load();
  } catch (e) {
    toast(t('toast.resurrectFailed', { error: e.message }), 'err');
  } finally {
    btn.disabled = false;
  }
});

/* --------------------------- 编辑任务参数 --------------------------- */

const splitLines = (v) => String(v || '').split('\n').map((s) => s.trim()).filter(Boolean);

function previewCmd() {
  const target = $('eTarget').value.trim();
  const name = $('eName').value.trim();
  const cwd = $('eCwd').value.trim();
  const port = $('ePort').value.trim();
  const args = splitLines($('eArgs').value);
  const extra = args.length ? args : (port ? ['--port', port] : []);
  const q = (s) => (/[\s"'$`\\|&;<>()*?[\]{}!#~]/.test(s) ? JSON.stringify(s) : s);

  const parts = ['pm2', 'start', q(target || '')];
  if (name) parts.push('--name', q(name));
  if (cwd) parts.push('--cwd', q(cwd));
  if (extra.length) parts.push('--', ...extra.map(q));
  $('ePreview').textContent = parts.join(' ');
}

function openEdit(name) {
  const a = (state.apps || []).find((x) => x.name === name);
  if (!a) return;
  state.editing = name;
  $('eName').value = a.name;
  $('eName').classList.remove('invalid');
  $('eTarget').value = a.target || a.script || '';
  $('eCwd').value = a.cwd || '';
  $('ePort').value = a.port || '';
  $('eArgs').value = (a.args || []).join('\n');
  $('eNote').value = a.note || '';
  previewCmd();
  $('editMask').hidden = false;
  $('editMask').querySelector('.modal-body').scrollTop = 0;
  $('eTarget').focus();
}

function closeEdit() {
  $('editMask').hidden = true;
  state.editing = null;
}

/** 名称是否合法：非空、不含空格/斜杠、不以 - 开头 */
const nameInvalid = (v) => !v || /[\s/]/.test(v) || v.startsWith('-');

/** 名称查重：改名时不能和其他任务撞名（和自己重名不算） */
function nameDuplicate(v) {
  if (!v || v === state.editing) return false;
  return (state.apps || []).some((a) => a.name === v);
}

/** 编辑过程中即时报错：名称非法或重复时输入框标红（沿用原名不校验格式） */
function validateNameInput() {
  const v = $('eName').value.trim();
  const bad = v !== '' && v !== state.editing && (nameInvalid(v) || nameDuplicate(v));
  $('eName').classList.toggle('invalid', bad);
  return !bad;
}

['eName', 'eTarget', 'eCwd', 'ePort', 'eArgs'].forEach((id) => $(id).addEventListener('input', previewCmd));
$('eName').addEventListener('input', validateNameInput);
$('cancelEdit').addEventListener('click', closeEdit);
$('editMask').addEventListener('click', (e) => { if (e.target.id === 'editMask') closeEdit(); });

$('confirmEdit').addEventListener('click', async () => {
  if (!state.editing) return;
  const btn = $('confirmEdit');
  const from = state.editing;
  const name = $('eName').value.trim();

  if (!name) return toast(t('toast.nameRequired'), 'err');
  if (name !== from && nameInvalid(name)) return toast(t('toast.nameInvalid'), 'err');
  if (nameDuplicate(name)) return toast(t('toast.nameExists', { name }), 'err');
  if (!$('eTarget').value.trim()) return toast(t('toast.targetRequired'), 'err');

  // 改名会按新名字重建 pm2 进程，先让用户知情
  const cur = (state.apps || []).find((a) => a.name === from);
  if (name !== from && cur && cur.state !== 'missing'
    && !confirm(t('toast.renameRestartConfirm', { from, to: name }))) return;

  btn.disabled = true;
  try {
    const res = await fetch(api(`/api/apps/${encodeURIComponent(from)}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        target: $('eTarget').value.trim(),
        cwd: $('eCwd').value.trim(),
        port: $('ePort').value.trim(),
        args: splitLines($('eArgs').value),
        note: $('eNote').value.trim(),
      }),
    });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error);
    toast(name === from ? t('toast.defSaved') : t('toast.renamed', { from, to: name }), 'ok');
    if (j.warning) toast(j.warning, 'err');
    closeEdit();
    await load();
  } catch (e) {
    toast(t('toast.saveFailed', { error: e.message }), 'err');
  } finally {
    btn.disabled = false;
  }
});

/* ------------------------------ 日志抽屉 ------------------------------ */

function openLogs(name) {
  state.logTarget = name;
  $('drawerTitle').textContent = name;
  $('drawerSub').textContent = t('common.liveLog');
  $('logView').textContent = '';
  $('drawerMask').hidden = false;
  $('drawer').hidden = false;
  startLogStream();
}

function closeLogs() {
  $('drawerMask').hidden = true;
  $('drawer').hidden = true;
  if (state.logStream) { state.logStream.close(); state.logStream = null; }
  state.logTarget = null;
}

function startLogStream() {
  if (state.logStream) { state.logStream.close(); state.logStream = null; }
  if (!$('liveLog').checked) {
    fetch(api(`/api/processes/${encodeURIComponent(state.logTarget)}/logs?lines=400`))
      .then((r) => r.json())
      .then((j) => {
        const view = $('logView');
        view.textContent = '';
        appendLog(j.out || '', 'out');
        appendLog(j.err || '', 'err');
        view.scrollTop = view.scrollHeight;
      });
    return;
  }
  const es = new EventSource(api(`/api/processes/${encodeURIComponent(state.logTarget)}/logs/stream`));
  es.onmessage = (ev) => {
    try {
      const { text, kind } = JSON.parse(ev.data);
      appendLog(text, kind);
    } catch (_) { /* ignore */ }
  };
  state.logStream = es;
}

function appendLog(text, kind) {
  const view = $('logView');
  const atBottom = view.scrollHeight - view.scrollTop - view.clientHeight < 40;
  const span = document.createElement('span');
  span.className = 'l-' + (kind === 'err' ? 'err' : kind === 'sys' ? 'sys' : 'out');
  span.textContent = text + '\n';
  view.appendChild(span);
  while (view.childElementCount > 4000) view.removeChild(view.firstChild);
  if (atBottom) view.scrollTop = view.scrollHeight;
}

/* --------------------------- 版本与更新 --------------------------- */

/** overview 里带回来的更新状态：有结果直接用，没有就按需查一次 */
function applyUpdateInfo(u) {
  if (u.info) {
    state.update = u.info;
    renderUpdateChip();
  } else if (u.autoCheck && !state.updateChecked) {
    state.updateChecked = true;
    checkUpdate();
  }
  if (typeof u.autoCheck === 'boolean') state.updateAutoCheck = u.autoCheck;
}

function renderUpdateChip() {
  const u = state.update;
  const mgr = state.overview && state.overview.manager;
  const ver = (u && u.current) || (mgr && mgr.version) || '';
  $('versionText').textContent = ver ? 'v' + ver : 'v—';

  const has = Boolean(u && u.hasUpdate);
  $('versionBtn').classList.toggle('has-update', has);
  $('updateDot').hidden = !has;
  $('versionBtn').title = has
    ? t('update.chipHasUpdate', { latest: u.latest })
    : (u && u.error ? t('update.chipError', { error: u.error }) : t('common.versionAndUpdate'));
}

function setUpdateStatus(text) {
  $('uStatus').textContent = text;
}

async function checkUpdate(force = false) {
  const btn = $('versionBtn');
  btn.classList.add('checking');
  if (!$('updateMask').hidden) setUpdateStatus(t('update.checking'));
  try {
    const j = await fetch(api('/api/update/check' + (force ? '?force=1' : ''))).then((r) => r.json());
    if (!j.ok) throw new Error(j.error || t('update.checkFailed'));
    state.update = j;
  } catch (e) {
    state.update = { ...(state.update || {}), error: e.message };
  } finally {
    state.updateChecked = true;
    btn.classList.remove('checking');
    renderUpdateChip();
    if (!$('updateMask').hidden) renderUpdateModal();
  }
}

function renderUpdateModal() {
  const u = state.update || {};
  $('uCurrent').textContent = 'v' + (u.current || '—');
  $('uLatest').textContent = u.latest ? 'v' + u.latest : '—';
  $('uLatest').className = u.hasUpdate ? 'new' : '';
  $('uMode').textContent = u.modeLabel || u.mode || '—';

  if (!u.latest) {
    setUpdateStatus(u.error ? t('update.cannotFetch', { error: u.error }) : t('update.checking'));
  } else if (u.hasUpdate) {
    setUpdateStatus(t('update.found', { latest: u.latest, current: u.current }));
  } else {
    setUpdateStatus(t('update.upToDate'));
  }

  $('uPlan').textContent = u.canUpdate
    ? (u.planText || '')
    : (u.reason || t('update.notSupported'));

  const apply = $('uApply');
  apply.disabled = state.updating || !u.canUpdate || !u.hasUpdate;
  apply.textContent = state.updating ? t('update.applying') : t('update.apply');
  $('uCheck').disabled = state.updating;
}

function openUpdate() {
  $('uLog').hidden = !$('uLog').textContent;
  $('updateMask').hidden = false;
  $('updateMask').querySelector('.modal-body').scrollTop = 0;
  renderUpdateModal();
  if (!state.update) checkUpdate(true);
}

function closeUpdate() {
  $('updateMask').hidden = true;
}

function appendUpdateLine(text, kind) {
  const log = $('uLog');
  log.hidden = false;
  const span = document.createElement('span');
  span.className = 'l-' + (kind === 'err' ? 'err' : kind === 'sys' ? 'sys' : 'out');
  span.textContent = text + '\n';
  log.appendChild(span);
  log.scrollTop = log.scrollHeight;
}

/** 执行更新：走 SSE 拿实时输出 */
async function applyUpdate() {
  if (state.updating) return;
  if (!confirm(t('update.confirmApply'))) return;

  state.updating = true;
  $('uLog').textContent = '';
  $('uLog').hidden = false;
  $('uRestart').hidden = true;
  setUpdateStatus(t('update.running'));
  renderUpdateModal();

  await new Promise((resolve) => {
    const es = new EventSource(api('/api/update/apply?confirm=1'));
    state.updateStream = es;
    let done = false;
    // done 兜底：流结束后浏览器可能再补一个 error 事件，避免重复收尾
    const finish = (r) => {
      if (done) return;
      done = true;
      es.close();
      state.updateStream = null;
      finishUpdate(r).finally(resolve);
    };
    es.onmessage = (ev) => {
      let data;
      try { data = JSON.parse(ev.data); } catch (_) { return; }
      if (data.ping) return;
      if (data.done) return finish(data);
      if (data.text) appendUpdateLine(data.text, data.kind);
    };
    es.onerror = () => finish({ ok: false, error: t('update.streamBroken') });
  });
}

async function finishUpdate(r) {
  state.updating = false;
  if (r.ok) {
    appendUpdateLine(t('update.doneLine', { from: r.from, to: r.to }), 'sys');
    toast(r.changed ? t('update.doneToast', { to: r.to }) : t('update.doneNoChange'), 'ok');
    $('uRestart').hidden = false;
    await checkUpdate(true);
    setUpdateStatus(r.changed
      ? t('update.ready', { version: r.to })
      : t('update.alreadyLatest'));
  } else {
    appendUpdateLine('✗ ' + (r.error || t('update.failedUnknown')), 'err');
    toast(t('update.failedToast', { error: r.error || t('update.failedUnknown') }), 'err');
  }
  renderUpdateModal();
}

/** 重启面板（pm2 托管时直接 pm2 restart 自己） */
async function restartPanel() {
  const btn = $('uRestart');
  btn.disabled = true;
  try {
    const j = await post(api('/api/update/restart'));
    if (j.ok && j.mode === 'pm2') {
      setUpdateStatus(t('update.restarting'));
      toast(t('update.restartTriggered'), 'ok');
      setTimeout(() => location.reload(), 6000);
      return;
    }
    setUpdateStatus(j.message || t('update.restartManual'));
    toast(j.message || t('update.restartInTerminal'), '');
  } catch (e) {
    toast(t('update.restartFailed', { error: e.message }), 'err');
  } finally {
    btn.disabled = false;
  }
}

$('versionBtn').addEventListener('click', openUpdate);
$('uClose').addEventListener('click', closeUpdate);
$('uCheck').addEventListener('click', () => checkUpdate(true));
$('uApply').addEventListener('click', applyUpdate);
$('uRestart').addEventListener('click', restartPanel);
$('updateMask').addEventListener('click', (e) => { if (e.target.id === 'updateMask') closeUpdate(); });

/* ------------------------------ 事件绑定 ------------------------------ */

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  doAction(btn.dataset.name, btn.dataset.act);
});

$('refreshBtn').addEventListener('click', () => { load(); toast(t('common.refreshed')); });

$('autoRefresh').addEventListener('change', (e) => {
  state.autoRefresh = e.target.checked;
  setupTimer();
});

$('searchInput').addEventListener('input', (e) => {
  state.keyword = e.target.value.trim();
  render();
});

$('filterChips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  [...$('filterChips').children].forEach((c) => c.classList.remove('active'));
  chip.classList.add('active');
  state.filter = chip.dataset.filter;
  render();
});

/* --------------------------- 列表 / 卡片切换 --------------------------- */

function setView(view) {
  state.view = view === 'list' ? 'list' : 'card';
  try { localStorage.setItem('pm2-ui-view', state.view); } catch (_) { /* ignore */ }
  [...$('viewSwitch').querySelectorAll('.view-btn')]
    .forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  render();
}

$('viewSwitch').addEventListener('click', (e) => {
  const btn = e.target.closest('.view-btn');
  if (btn) setView(btn.dataset.view);
});

$('closeDrawer').addEventListener('click', closeLogs);
$('drawerMask').addEventListener('click', closeLogs);
$('clearLog').addEventListener('click', () => { $('logView').textContent = ''; });
$('liveLog').addEventListener('change', startLogStream);

$('addBtn').addEventListener('click', () => {
  $('modalMask').hidden = false;
  $('modalMask').querySelector('.modal-body').scrollTop = 0;
  $('fTarget').focus();
});
$('cancelAdd').addEventListener('click', () => { $('modalMask').hidden = true; });
$('modalMask').addEventListener('click', (e) => { if (e.target.id === 'modalMask') $('modalMask').hidden = true; });

$('confirmAdd').addEventListener('click', async () => {
  const body = {
    target: $('fTarget').value.trim(),
    name: $('fName').value.trim() || undefined,
    cwd: $('fCwd').value.trim() || undefined,
    port: $('fPort').value.trim() || undefined,
    args: splitLines($('fArgs').value),
  };
  if (!body.target) return toast(t('toast.scriptRequired'), 'err');
  const btn = $('confirmAdd');
  btn.disabled = true;
  try {
    const res = await fetch(api('/api/start'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error);
    toast(t('toast.started'), 'ok');
    $('modalMask').hidden = true;
    ['fTarget', 'fName', 'fCwd', 'fPort', 'fArgs'].forEach((id) => { $(id).value = ''; });
    setTimeout(() => load(), 700);
  } catch (e) {
    toast(t('toast.startFailed', { error: e.message }), 'err');
  } finally {
    btn.disabled = false;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    $('modalMask').hidden = true;
    closeEdit();
    closeLogs();
    closeUpdate();
  }
});

function setupTimer() {
  if (state.timer) clearInterval(state.timer);
  if (state.autoRefresh) state.timer = setInterval(() => load({ silent: true }), 3000);
}

/* ------------------------------ 语言切换 ------------------------------ */

/** 语言变化后，重画所有由 JS 生成的文案，并重新拉一次数据 */
function rerenderForLang() {
  if (state.logTarget) $('drawerSub').textContent = t('common.liveLog');
  renderStats();
  if (state.overview) renderDumpHint(state.overview);
  render();
  renderUpdateChip();
  if (!$('updateMask').hidden) renderUpdateModal();
  if (state.update) checkUpdate(true);   // modeLabel / reason 由服务端本地化，需要重查
  load({ silent: true });                // 服务端返回的 error 文案也重新取一次
}

window.addEventListener('pm2ui:langchange', rerenderForLang);

/* ------------------------------ 启动 ------------------------------ */

setView(state.view);
load();
setupTimer();

// 面板长时间开着时，每 30 分钟重新看一眼有没有新版本
setInterval(() => { if (state.updateAutoCheck) checkUpdate(); }, 30 * 60 * 1000);
