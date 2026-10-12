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
  update: null,            // 版本 / 更新检查结果
  updateAutoCheck: true,   // 服务端是否允许自动检查更新
  updateChecked: false,
  updateStream: null,      // 更新日志的 SSE
  updating: false,
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
    renderApps();
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

function matches(p) {
  if (state.filter === 'online' && p.status !== 'online') return false;
  if (state.filter === 'stopped' && p.status === 'online') return false;
  if (state.filter === 'ports' && !(p.ports || []).length) return false;
  if (state.keyword) {
    const k = state.keyword.toLowerCase();
    const hay = [p.name, p.script, p.cwd, p.namespace,
      ...(p.ports || []).map((e) => e.port)].join(' ').toLowerCase();
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
  const grid = $('grid');
  const list = state.processes.filter(matches);

  $('emptyState').hidden = state.processes.length > 0 || (state.apps || []).length > 0;
  if (!list.length) {
    grid.innerHTML = state.processes.length
      ? `<p class="muted" style="grid-column:1/-1;text-align:center;padding:40px">${esc(t('grid.noMatch'))}</p>`
      : '';
    return;
  }

  grid.innerHTML = list.map((p) => {
    const h = state.history.get(p.name) || { cpu: [], mem: [] };
    const running = p.status === 'online';
    const busy = state.busy.has(p.name);

    return `
    <article class="card ${running ? '' : 'is-stopped'}" data-name="${esc(p.name)}">
      <div class="card-head">
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
        <button class="btn sm" data-act="logs" data-name="${esc(p.name)}">${esc(t('common.logs'))}</button>
        ${running
          ? `<button class="btn sm" data-act="restart" data-name="${esc(p.name)}" ${busy ? 'disabled' : ''}>${esc(t('common.restart'))}</button>
             <button class="btn sm" data-act="reload" data-name="${esc(p.name)}" ${busy ? 'disabled' : ''}>${esc(t('common.reload'))}</button>
             <button class="btn sm danger" data-act="stop" data-name="${esc(p.name)}" ${busy ? 'disabled' : ''}>${esc(t('common.stop'))}</button>`
          : `<button class="btn sm primary" data-act="start" data-name="${esc(p.name)}" ${busy ? 'disabled' : ''}>${esc(t('common.start'))}</button>
             <button class="btn sm danger" data-act="delete" data-name="${esc(p.name)}" ${busy ? 'disabled' : ''}>${esc(t('common.delete'))}</button>`}
      </div>
    </article>`;
  }).join('');
}

/* ------------------------------ 操作 ------------------------------ */

async function doAction(name, act) {
  if (act === 'delete' && !confirm(t('toast.deleteConfirm', { name }))) return;

  state.busy.add(name);
  render();
  try {
    const res = await fetch(api(`/api/processes/${encodeURIComponent(name)}/${act}`), { method: 'POST' });
    const j = await res.json();
    if (!j.ok) {
      // pm2 已经不认这个进程，但任务清单里还有参数 —— 引导一键恢复
      if (j.recoverable && confirm(t('toast.recoverConfirm', { error: j.error }))) {
        const r = await post(api(`/api/apps/${encodeURIComponent(name)}/start`));
        if (!r.ok) throw new Error(r.error || t('toast.recoverFailed'));
        toast(t('apps.savedFromDef', { name }), 'ok');
        await load();
        return;
      }
      throw new Error(j.error || t('common.fail'));
    }
    toast(t('toast.actionOk', { name, action: act }), 'ok');
    await load();
  } catch (e) {
    toast(t('toast.actionFailed', { name, action: act, error: e.message }), 'err');
  } finally {
    state.busy.delete(name);
    render();
  }
}

/* ------------------------------ 任务清单 ------------------------------ */

const APP_STATE_KEY = { online: 'apps.stateOnline', stopped: 'apps.stateStopped', missing: 'apps.stateMissing' };

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

function renderApps() {
  const box = $('appsList');
  const apps = state.apps || [];
  $('appsCount').textContent = apps.length;

  if (!apps.length) {
    box.innerHTML = `<p class="apps-empty muted">${t('apps.empty')}</p>`;
    return;
  }

  box.innerHTML = apps.map((a) => {
    const st = a.state || 'missing';
    const busy = state.busy.has(a.name);
    const dis = busy ? 'disabled' : '';
    const port = a.port || ((a.live && (a.live.ports || [])[0]) ? String(a.live.ports[0].port) : '');

    const actions = st === 'online'
      ? `<button class="btn sm" data-app-act="restart" data-app-name="${esc(a.name)}" ${dis}>${esc(t('common.restart'))}</button>
         <button class="btn sm danger" data-app-act="stop" data-app-name="${esc(a.name)}" ${dis}>${esc(t('common.stop'))}</button>`
      : `<button class="btn sm primary" data-app-act="recover" data-app-name="${esc(a.name)}" ${dis}>${esc(st === 'missing' ? t('common.recover') : t('common.start'))}</button>`;

    // 「移除」只对 pm2 已经不认的任务开放：还在 pm2 里的进程会被自动收割重新收录，
    // 想彻底清掉就先在下面的进程卡片里「删除」，再从清单「移除」。
    const forget = st === 'missing'
      ? `<button class="btn sm ghost" data-app-act="forget" data-app-name="${esc(a.name)}" ${dis}>${esc(t('common.remove'))}</button>`
      : `<button class="btn sm ghost" data-app-act="forget" data-app-name="${esc(a.name)}" disabled
           title="${esc(t('common.removeDisabledTitle'))}">${esc(t('common.remove'))}</button>`;

    return `
      <div class="app-row ${st}" data-name="${esc(a.name)}">
        <span class="app-state-dot ${st}"></span>
        <div class="app-main">
          <div class="app-name">
            <b>${esc(a.name)}</b>
            <span class="pill ${st}">${esc(t(APP_STATE_KEY[st]) || st)}</span>
            ${port ? `<span class="pill port" title="${esc(t('common.declaredPort'))}">:${esc(port)}</span>` : ''}
            ${a.source === 'manual' ? `<span class="pill manual" title="${esc(t('common.verifiedTitle'))}">${esc(t('common.verified'))}</span>` : ''}
          </div>
          <div class="app-cmd" title="${esc(a.cmd || '')}">${esc(a.cmd || '')}</div>
          ${a.note ? `<div class="app-meta">${esc(a.note)}</div>` : ''}
        </div>
        <div class="app-actions">
          ${actions}
          <button class="btn sm ghost" data-app-act="edit" data-app-name="${esc(a.name)}" ${dis}>${esc(t('common.edit'))}</button>
          ${forget}
        </div>
      </div>`;
  }).join('');
}

/* --------------------------- 任务清单操作 --------------------------- */

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function appAction(name, act) {
  if (act === 'edit') return openEdit(name);

  if (act === 'forget') {
    if (!confirm(t('toast.forgetConfirm', { name }))) return;
    try {
      const j = await fetch(api(`/api/apps/${encodeURIComponent(name)}`), { method: 'DELETE' }).then((r) => r.json());
      if (!j.ok) throw new Error(j.error || t('common.fail'));
      toast(t('toast.forgotten', { name }), 'ok');
      await load();
    } catch (e) {
      toast(t('toast.forgetFailed', { error: e.message }), 'err');
    }
    return;
  }

  state.busy.add(name);
  renderApps();
  try {
    const j = act === 'recover'
      ? await post(api(`/api/apps/${encodeURIComponent(name)}/start`))
      : await post(api(`/api/processes/${encodeURIComponent(name)}/${act}`));
    if (!j.ok) throw new Error(j.error || t('common.fail'));
    toast(act === 'recover' ? t('apps.savedFromDef', { name }) : t('toast.actionOk', { name, action: act }), 'ok');
    await load();
  } catch (e) {
    toast(t('toast.actionFailed', { name, action: act, error: e.message }), 'err');
  } finally {
    state.busy.delete(name);
    renderApps();
    render();
  }
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-app-act]');
  if (!btn) return;
  appAction(btn.dataset.appName, btn.dataset.appAct);
});

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
  const name = $('eName').value;
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
  $('eTarget').value = a.target || a.script || '';
  $('eCwd').value = a.cwd || '';
  $('ePort').value = a.port || '';
  $('eArgs').value = (a.args || []).join('\n');
  $('eNote').value = a.note || '';
  previewCmd();
  $('editMask').hidden = false;
  $('eTarget').focus();
}

function closeEdit() {
  $('editMask').hidden = true;
  state.editing = null;
}

['eTarget', 'eCwd', 'ePort', 'eArgs'].forEach((id) => $(id).addEventListener('input', previewCmd));
$('cancelEdit').addEventListener('click', closeEdit);
$('editMask').addEventListener('click', (e) => { if (e.target.id === 'editMask') closeEdit(); });

$('confirmEdit').addEventListener('click', async () => {
  if (!state.editing) return;
  const btn = $('confirmEdit');
  if (!$('eTarget').value.trim()) return toast(t('toast.targetRequired'), 'err');
  btn.disabled = true;
  try {
    const res = await fetch(api(`/api/apps/${encodeURIComponent(state.editing)}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target: $('eTarget').value.trim(),
        cwd: $('eCwd').value.trim(),
        port: $('ePort').value.trim(),
        args: splitLines($('eArgs').value),
        note: $('eNote').value.trim(),
      }),
    });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error);
    toast(t('toast.defSaved'), 'ok');
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
  const { act, name } = btn.dataset;
  if (act === 'logs') return openLogs(name);
  doAction(name, act);
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

$('closeDrawer').addEventListener('click', closeLogs);
$('drawerMask').addEventListener('click', closeLogs);
$('clearLog').addEventListener('click', () => { $('logView').textContent = ''; });
$('liveLog').addEventListener('change', startLogStream);

$('addBtn').addEventListener('click', () => { $('modalMask').hidden = false; $('fTarget').focus(); });
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
  renderApps();
  render();
  renderUpdateChip();
  if (!$('updateMask').hidden) renderUpdateModal();
  if (state.update) checkUpdate(true);   // modeLabel / reason 由服务端本地化，需要重查
  load({ silent: true });                // 服务端返回的 error 文案也重新取一次
}

window.addEventListener('pm2ui:langchange', rerenderForLang);

/* ------------------------------ 启动 ------------------------------ */

load();
setupTimer();

// 面板长时间开着时，每 30 分钟重新看一眼有没有新版本
setInterval(() => { if (state.updateAutoCheck) checkUpdate(); }, 30 * 60 * 1000);
