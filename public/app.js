/* ============================================================
   PM2 进程与端口监控 — 前端
   ============================================================ */

const $ = (id) => document.getElementById(id);

const state = {
  processes: [],
  overview: null,
  filter: 'all',
  keyword: '',
  autoRefresh: true,
  timer: null,
  history: new Map(),      // name -> { cpu: [], mem: [] }
  busy: new Set(),         // 正在执行操作的进程名
  logStream: null,
  logTarget: null,
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

function fmtUptime(ms) {
  if (!ms) return '—';
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 0) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d) return `${d}天 ${h}时`;
  if (h) return `${h}时 ${m}分`;
  if (m) return `${m}分 ${s}秒`;
  return `${s} 秒`;
}

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

const STATUS_TEXT = {
  online: '运行中', stopped: '已停止', errored: '错误',
  launching: '启动中', stopping: '停止中',
};
const statusText = (s) => STATUS_TEXT[s] || s;

/* ------------------------------ 数据 ------------------------------ */

async function load({ silent = false } = {}) {
  try {
    const [pRes, oRes] = await Promise.all([
      fetch('/api/processes?refresh=' + (silent ? '0' : '1')).then((r) => r.json()),
      fetch('/api/overview?refresh=' + (silent ? '0' : '1')).then((r) => r.json()),
    ]);

    if (oRes.pm2 && !oRes.pm2.available) {
      $('pm2Badge').className = 'pm2-badge bad';
      $('pm2Text').textContent = '未找到 pm2';
    } else if (oRes.pm2) {
      $('pm2Badge').className = 'pm2-badge ok';
      $('pm2Text').textContent = 'PM2 v' + oRes.pm2.version;
    }

    $('hostLine').textContent = `${oRes.host} · ${oRes.platform} · 管理台 pid ${oRes.manager.pid}`;
    state.overview = oRes;
    state.processes = pRes.processes || [];

    if (oRes.error) toast('PM2 读取失败：' + oRes.error, 'err');

    state.processes.forEach((p) => {
      const h = state.history.get(p.name) || { cpu: [], mem: [] };
      h.cpu.push(p.cpu || 0);
      h.mem.push(p.memory || 0);
      if (h.cpu.length > 40) h.cpu.shift();
      if (h.mem.length > 40) h.mem.shift();
      state.history.set(p.name, h);
    });

    renderStats();
    render();
  } catch (e) {
    toast('连接后端失败：' + e.message, 'err');
  }
}

/* ------------------------------ 渲染 ------------------------------ */

function renderStats() {
  const s = state.overview?.stats || {};
  $('statbar').innerHTML = `
    <div class="stat"><div class="k">进程总数</div><div class="v">${s.total ?? 0}</div></div>
    <div class="stat good"><div class="k">运行中</div><div class="v">${s.online ?? 0}</div></div>
    <div class="stat"><div class="k">已停止 / 异常</div><div class="v">${s.stopped ?? 0}</div></div>
    <div class="stat accent"><div class="k">监听端口</div><div class="v">${s.listening ?? 0}</div></div>
    <div class="stat accent"><div class="k">其中 Web 端口</div><div class="v">${s.httpPorts ?? 0}</div></div>
    <div class="stat"><div class="k">累计 CPU</div><div class="v">${s.cpu ?? 0}<small>%</small></div></div>
    <div class="stat"><div class="k">累计内存</div><div class="v">${fmtBytes(s.memory || 0)}</div></div>
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
    const tip = ['点击在新标签页打开', `Server: ${p.server || '未知'}`,
      p.infra ? '中间件常用端口' : '', p.source === 'env' ? '来自环境变量声明' : '']
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
  const reasonMap = {
    stopped: '进程已停止，端口未监听',
    ECONNREFUSED: '探测时连接被拒',
    timeout: '未在超时内响应',
    ECONNRESET: '连接被重置',
    EPROTO: '非 HTTP/TLS 协议',
    'no-response': '未响应 HTTP 探测',
  };
  const desc = p.infra
    ? '中间件常用端口'
    : (reasonMap[p.reason] || p.reason || '仅 TCP，非网页服务');
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
    const hint = p.status === 'online'
      ? '未检测到监听端口（该进程可能不是网络服务）'
      : '进程未运行，无法探测端口';
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
        <span class="port-title">监听端口</span>
        <span class="port-summary">${ports.length} 个 · Web ${webPorts.length} · 其他 ${otherPorts.length}</span>
      </div>
      <div class="port-list">${ports.map(portChip).join('')}</div>
    </div>`;
}

function render() {
  const grid = $('grid');
  const list = state.processes.filter(matches);

  $('emptyState').hidden = state.processes.length > 0;
  if (!list.length) {
    grid.innerHTML = state.processes.length
      ? `<p class="muted" style="grid-column:1/-1;text-align:center;padding:40px">没有匹配的进程</p>`
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
          <span class="pill pmid">${(p.ports || []).length} 端口</span>
        </div>
      </div>

      ${portBlock(p)}

      <div class="card-body">
        <div class="metrics">
          <div class="metric"><div class="k">CPU</div><div class="v">${(p.cpu || 0).toFixed(1)}<span>%</span></div></div>
          <div class="metric"><div class="k">内存</div><div class="v">${fmtBytes(p.memory)}</div></div>
          <div class="metric"><div class="k">重启次数</div><div class="v">${p.restarts}${p.unstableRestarts ? `<span> +${p.unstableRestarts}</span>` : ''}</div></div>
          <div class="metric"><div class="k">运行时长</div><div class="v" style="font-size:13px">${running ? fmtUptime(p.uptime) : '—'}</div></div>
        </div>
        <div class="spark">
          <div class="spark-label"><span>CPU 趋势</span><span>${h.cpu.length ? Math.max(...h.cpu).toFixed(0) + '% 峰值' : ''}</span></div>
          ${sparkline(h.cpu, '#2f6bff')}
        </div>
        <div class="pathline" title="${esc(p.script)}"><b>入口</b> ${esc(p.script || '—')}</div>
      </div>

      <div class="card-foot">
        <span class="pid">pid ${p.pid || '—'} · #${p.pmId}</span>
        <div class="spacer"></div>
        <button class="btn sm" data-act="logs" data-name="${esc(p.name)}">日志</button>
        ${running
          ? `<button class="btn sm" data-act="restart" data-name="${esc(p.name)}" ${busy ? 'disabled' : ''}>重启</button>
             <button class="btn sm" data-act="reload" data-name="${esc(p.name)}" ${busy ? 'disabled' : ''}>重载</button>
             <button class="btn sm danger" data-act="stop" data-name="${esc(p.name)}" ${busy ? 'disabled' : ''}>停止</button>`
          : `<button class="btn sm primary" data-act="start" data-name="${esc(p.name)}" ${busy ? 'disabled' : ''}>启动</button>
             <button class="btn sm danger" data-act="delete" data-name="${esc(p.name)}" ${busy ? 'disabled' : ''}>删除</button>`}
      </div>
    </article>`;
  }).join('');
}

/* ------------------------------ 操作 ------------------------------ */

async function doAction(name, act) {
  if (act === 'delete' && !confirm(`确定要从 pm2 列表中删除「${name}」吗？\n（不会删除文件，只是移出 pm2 列表）`)) return;

  state.busy.add(name);
  render();
  try {
    const res = await fetch(`/api/processes/${encodeURIComponent(name)}/${act}`, { method: 'POST' });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || '操作失败');
    toast(`${name} · ${act} 成功`, 'ok');
    await load();
  } catch (e) {
    toast(`${name} · ${act} 失败：${e.message}`, 'err');
  } finally {
    state.busy.delete(name);
    render();
  }
}

/* ------------------------------ 日志抽屉 ------------------------------ */

function openLogs(name) {
  state.logTarget = name;
  $('drawerTitle').textContent = name;
  $('drawerSub').textContent = '实时日志';
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
    fetch(`/api/processes/${encodeURIComponent(state.logTarget)}/logs?lines=400`)
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
  const es = new EventSource(`/api/processes/${encodeURIComponent(state.logTarget)}/logs/stream`);
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

/* ------------------------------ 事件绑定 ------------------------------ */

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const { act, name } = btn.dataset;
  if (act === 'logs') return openLogs(name);
  doAction(name, act);
});

$('refreshBtn').addEventListener('click', () => { load(); toast('已刷新'); });

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
  };
  if (!body.target) return toast('请填写脚本路径', 'err');
  const btn = $('confirmAdd');
  btn.disabled = true;
  try {
    const res = await fetch('/api/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error);
    toast('启动成功', 'ok');
    $('modalMask').hidden = true;
    ['fTarget', 'fName', 'fCwd', 'fPort'].forEach((id) => { $(id).value = ''; });
    setTimeout(() => load(), 700);
  } catch (e) {
    toast('启动失败：' + e.message, 'err');
  } finally {
    btn.disabled = false;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    $('modalMask').hidden = true;
    closeLogs();
  }
});

function setupTimer() {
  if (state.timer) clearInterval(state.timer);
  if (state.autoRefresh) state.timer = setInterval(() => load({ silent: true }), 3000);
}

/* ------------------------------ 启动 ------------------------------ */
load();
setupTimer();
