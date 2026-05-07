// ===========================================
// 日程調整ツール - メインアプリケーション
// ===========================================

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const main = document.getElementById('main');

const state = {
  screen: 'loading',
  pollId: null,
  poll: null,
  responses: [],
  myName: localStorage.getItem('myName') || '',
  myAnswers: {},
  selectedTool: 'maru',
};

// ===========================================
// ユーティリティ
// ===========================================
function uid() {
  return Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getMonth() + 1}/${d.getDate()}<br><span style="font-size:10px">(${days[d.getDay()]})</span>`;
}

function fmtDateShort(iso) {
  const d = new Date(iso + 'T00:00:00');
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]})`;
}

function fmtHour(h) {
  return String(h).padStart(2, '0') + ':00';
}

function toLocalDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dateRange(start, end) {
  const out = [];
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  if (e < s) return [];
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    out.push(toLocalDateStr(d));
    if (out.length > 60) break;
  }
  return out;
}

function hourRange(startH, endH) {
  const out = [];
  for (let h = startH; h < endH; h++) out.push(h);
  return out;
}

function slotKey(date, hour) {
  return date + '_' + hour;
}

function getPollIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('p');
}

function setPollIdInUrl(id) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('p', id);
  else url.searchParams.delete('p');
  history.replaceState(null, '', url.toString());
}

function getShareUrl(id) {
  const url = new URL(window.location.href);
  url.searchParams.set('p', id);
  url.hash = '';
  return url.toString();
}

// ===========================================
// Supabase 操作
// ===========================================
async function createPoll(data) {
  const id = uid();
  const { error } = await sb.from('polls').insert({
    id,
    title: data.title,
    dates: data.dates,
    hours: data.hours,
  });
  if (error) throw error;
  return id;
}

async function loadPoll(id) {
  const { data: poll, error: e1 } = await sb
    .from('polls')
    .select('*')
    .eq('id', id)
    .single();
  if (e1) return null;

  const { data: responses, error: e2 } = await sb
    .from('responses')
    .select('*')
    .eq('poll_id', id);
  if (e2) throw e2;

  return { poll, responses: responses || [] };
}

async function saveResponse(pollId, name, answers) {
  const { error } = await sb
    .from('responses')
    .upsert(
      { poll_id: pollId, name, answers, updated_at: new Date().toISOString() },
      { onConflict: 'poll_id,name' }
    );
  if (error) throw error;
}

// ===========================================
// 画面ルーター
// ===========================================
function render() {
  if (state.screen === 'loading') return renderLoading();
  if (state.screen === 'landing') return renderLanding();
  if (state.screen === 'create') return renderCreate();
  if (state.screen === 'share') return renderShare();
  if (state.screen === 'respond') return renderRespond();
  if (state.screen === 'results') return renderResults();
  if (state.screen === 'error') return renderError();
}

function renderLoading() {
  main.innerHTML = `<div class="loading">読み込み中...</div>`;
}

function renderError() {
  main.innerHTML = `
    <div class="card">
      <div class="error">${escapeHtml(state.errorMsg || 'エラーが発生しました')}</div>
      <button onclick="goLanding()">最初に戻る</button>
    </div>
  `;
}

// ===========================================
// ランディング画面
// ===========================================
function renderLanding() {
  setPollIdInUrl(null);
  main.innerHTML = `
    <div class="card">
      <h2 style="font-size:18px; margin-bottom:8px;">はじめに</h2>
      <p class="help-text">作成すると専用のURLが発行されます。そのURLをLINEなどで共有すれば、誰でも◯△☓で回答できます。</p>

      <div class="landing-options">
        <button class="option-card" onclick="goCreate()">
          <div class="option-title">＋ 新しい調整を作成</div>
          <div class="option-desc">日付範囲と時間範囲を選んで調整を作成</div>
        </button>
        <div class="option-card" style="cursor:default;">
          <div class="option-title">🔗 既存の調整に参加</div>
          <div class="option-desc" style="margin-bottom:8px;">他の人から共有されたURLを開いてください。または調整IDを入力：</div>
          <div class="share-url">
            <input id="joinId" type="text" placeholder="調整ID" />
            <button onclick="handleJoin()">開く</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function goLanding() {
  state.screen = 'landing';
  state.pollId = null;
  state.poll = null;
  state.responses = [];
  state.myAnswers = {};
  render();
}

function goCreate() {
  state.screen = 'create';
  render();
}

async function handleJoin() {
  const id = document.getElementById('joinId').value.trim();
  if (!id) return;
  await openPoll(id);
}

// ===========================================
// 作成画面
// ===========================================
function renderCreate() {
  const today = toLocalDateStr(new Date());
  const oneWeek = toLocalDateStr(new Date(Date.now() + 7 * 86400000));

  main.innerHTML = `
    <div class="card">
      <div class="nav-row">
        <h2>新しい調整を作成</h2>
        <button class="btn-small" onclick="goLanding()">← 戻る</button>
      </div>

      <div class="field">
        <label>イベント名</label>
        <input id="title" type="text" placeholder="例: 5月の飲み会" />
      </div>

      <div class="row">
        <div class="field">
          <label>開始日</label>
          <input id="startDate" type="date" value="${today}" />
        </div>
        <div class="field">
          <label>終了日</label>
          <input id="endDate" type="date" value="${oneWeek}" />
        </div>
      </div>

      <div class="row">
        <div class="field">
          <label>開始時刻</label>
          <select id="startHour">${Array.from({ length: 24 }, (_, i) =>
            `<option value="${i}" ${i === 9 ? 'selected' : ''}>${fmtHour(i)}</option>`
          ).join('')}</select>
        </div>
        <div class="field">
          <label>終了時刻</label>
          <select id="endHour">${Array.from({ length: 24 }, (_, i) =>
            `<option value="${i + 1}" ${i === 21 ? 'selected' : ''}>${fmtHour(i + 1)}</option>`
          ).join('')}</select>
        </div>
      </div>

      <p class="help-text" style="margin-top:8px; margin-bottom:20px;">※ 最大60日間 / 連絡先など個人情報は入れないでください</p>

      <button class="primary" onclick="handleCreate()">作成して共有URLを取得</button>
    </div>
  `;
}

async function handleCreate() {
  const title = document.getElementById('title').value.trim() || '日程調整';
  const startDate = document.getElementById('startDate').value;
  const endDate = document.getElementById('endDate').value;
  const startHour = parseInt(document.getElementById('startHour').value);
  const endHour = parseInt(document.getElementById('endHour').value);

  if (!startDate || !endDate) { alert('日付を入力してください'); return; }
  if (endHour <= startHour) { alert('終了時刻は開始時刻より後にしてください'); return; }

  const dates = dateRange(startDate, endDate);
  if (dates.length === 0) { alert('日付範囲が無効です（最大60日）'); return; }

  state.screen = 'loading';
  render();

  try {
    const id = await createPoll({ title, dates, hours: hourRange(startHour, endHour) });
    state.pollId = id;
    setPollIdInUrl(id);
    await openPoll(id, 'share');
  } catch (e) {
    state.screen = 'error';
    state.errorMsg = '作成に失敗しました: ' + (e.message || e);
    render();
  }
}

// ===========================================
// 共有画面
// ===========================================
function renderShare() {
  const url = getShareUrl(state.pollId);
  main.innerHTML = `
    <div class="card">
      <div class="success-banner">✓ 調整を作成しました</div>

      <h2 style="font-size:20px; margin-bottom:4px;">${escapeHtml(state.poll.title)}</h2>
      <p class="help-text">${state.poll.dates.length}日間 × ${state.poll.hours.length}時間枠</p>

      <div class="field" style="margin-top:24px;">
        <label>共有URL（このURLをLINEなどで送ってください）</label>
        <div class="share-url">
          <input id="shareUrl" type="text" readonly value="${escapeHtml(url)}" />
          <button class="primary" onclick="copyShareUrl()">コピー</button>
        </div>
      </div>

      <div style="display:flex; gap:8px; margin-top:24px;">
        <button class="primary" onclick="goRespond()">自分も回答する</button>
        <button onclick="goResults()">集計を見る</button>
      </div>
    </div>
  `;
}

function copyShareUrl() {
  const f = document.getElementById('shareUrl');
  f.select();
  navigator.clipboard.writeText(f.value).then(() => {
    const btn = event.target;
    const orig = btn.textContent;
    btn.textContent = 'コピー済';
    setTimeout(() => btn.textContent = orig, 1500);
  }).catch(() => {
    document.execCommand('copy');
  });
}

function goRespond() {
  state.screen = 'respond';
  render();
}

function goResults() {
  state.screen = 'results';
  render();
}

// ===========================================
// 回答画面
// ===========================================
function renderRespond() {
  const p = state.poll;
  const totalSlots = p.dates.length * p.hours.length;
  const answered = Object.keys(state.myAnswers).length;

  main.innerHTML = `
    <div class="card">
      <div class="nav-row">
        <h2>${escapeHtml(p.title)}</h2>
        <div class="nav-buttons">
          <button class="btn-small" onclick="goResults()">集計を見る</button>
        </div>
      </div>

      <div class="field">
        <label>あなたの名前</label>
        <input id="nameInput" type="text" placeholder="例: 田中" value="${escapeHtml(state.myName)}" />
      </div>

      <p class="help-text">下から ◯ △ ☓ を選んで、表のセルをクリックまたはドラッグで回答</p>

      <div class="tool-palette">
        <button class="tool-btn maru ${state.selectedTool === 'maru' ? 'active' : ''}" onclick="selectTool('maru')">◯</button>
        <button class="tool-btn sankaku ${state.selectedTool === 'sankaku' ? 'active' : ''}" onclick="selectTool('sankaku')">△</button>
        <button class="tool-btn batsu ${state.selectedTool === 'batsu' ? 'active' : ''}" onclick="selectTool('batsu')">☓</button>
        <button class="tool-btn clear ${state.selectedTool === 'clear' ? 'active' : ''}" onclick="selectTool('clear')">クリア</button>
      </div>

      <p class="help-text" id="counter">回答済み: ${answered} / ${totalSlots}</p>

      ${renderRespondGrid()}

      <div style="display:flex; gap:8px; margin-top:24px;">
        <button class="primary" onclick="handleSubmit()">この内容で回答を保存</button>
        <button onclick="goLanding()">キャンセル</button>
      </div>
    </div>
  `;

  document.getElementById('nameInput').addEventListener('input', e => {
    state.myName = e.target.value;
  });

  attachGridDragHandlers();
}

function renderRespondGrid() {
  const p = state.poll;
  const cols = p.dates.length;
  const tmplCols = `60px repeat(${cols}, minmax(56px, 1fr))`;
  let html = `<div class="grid-wrap"><div class="grid" style="grid-template-columns:${tmplCols}; min-width:${60 + cols * 56}px;">`;
  html += `<div class="day-header"></div>`;
  p.dates.forEach(d => { html += `<div class="day-header">${fmtDate(d)}</div>`; });

  p.hours.forEach(h => {
    html += `<div class="time-label">${fmtHour(h)}</div>`;
    p.dates.forEach(d => {
      const k = slotKey(d, h);
      const ans = state.myAnswers[k];
      const cls = ans || '';
      const sym = ans === 'maru' ? '◯' : ans === 'sankaku' ? '△' : ans === 'batsu' ? '☓' : '';
      html += `<div class="cell ${cls}" data-key="${k}">${sym}</div>`;
    });
  });
  html += `</div></div>`;
  return html;
}

function selectTool(tool) {
  state.selectedTool = tool;
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.tool-btn.${tool}`).classList.add('active');
}

function attachGridDragHandlers() {
  let dragging = false;
  let lastKey = null;

  function applyTool(cell) {
    const k = cell.dataset.key;
    const tool = state.selectedTool;
    cell.className = 'cell';
    if (tool === 'clear') {
      delete state.myAnswers[k];
      cell.textContent = '';
    } else {
      state.myAnswers[k] = tool;
      cell.classList.add(tool);
      cell.textContent = tool === 'maru' ? '◯' : tool === 'sankaku' ? '△' : '☓';
    }
    updateCounter();
  }

  function updateCounter() {
    const c = document.getElementById('counter');
    if (c) {
      const total = state.poll.dates.length * state.poll.hours.length;
      c.textContent = `回答済み: ${Object.keys(state.myAnswers).length} / ${total}`;
    }
  }

  document.querySelectorAll('.cell').forEach(cell => {
    cell.addEventListener('mousedown', e => {
      e.preventDefault();
      dragging = true;
      lastKey = cell.dataset.key;
      applyTool(cell);
    });
    cell.addEventListener('mouseenter', () => {
      if (dragging && cell.dataset.key !== lastKey) {
        lastKey = cell.dataset.key;
        applyTool(cell);
      }
    });
    cell.addEventListener('touchstart', e => {
      e.preventDefault();
      dragging = true;
      lastKey = cell.dataset.key;
      applyTool(cell);
    }, { passive: false });
  });

  const onUp = () => { dragging = false; };
  document.addEventListener('mouseup', onUp);
  document.addEventListener('touchend', onUp);

  document.addEventListener('touchmove', e => {
    if (!dragging) return;
    const t = e.touches[0];
    const el = document.elementFromPoint(t.clientX, t.clientY);
    if (el && el.classList.contains('cell') && el.dataset.key !== lastKey) {
      lastKey = el.dataset.key;
      applyTool(el);
    }
  }, { passive: true });
}

async function handleSubmit() {
  const name = state.myName.trim();
  if (!name) { alert('名前を入力してください'); return; }
  if (Object.keys(state.myAnswers).length === 0) {
    if (!confirm('回答が空ですが保存しますか？')) return;
  }

  localStorage.setItem('myName', name);

  state.screen = 'loading';
  render();

  try {
    await saveResponse(state.pollId, name, state.myAnswers);
    await openPoll(state.pollId, 'results');
  } catch (e) {
    state.screen = 'error';
    state.errorMsg = '保存に失敗しました: ' + (e.message || e);
    render();
  }
}

// ===========================================
// 集計画面
// ===========================================
function renderResults() {
  const p = state.poll;
  const respondents = state.responses;

  main.innerHTML = `
    <div class="card">
      <div class="nav-row">
        <h2>${escapeHtml(p.title)}</h2>
        <div class="nav-buttons">
          <button class="btn-small" onclick="reloadResults()">↻ 更新</button>
          <button class="btn-small" onclick="goRespondFromResults()">回答する</button>
        </div>
      </div>

      <p class="help-text">回答者 ${respondents.length}人</p>

      <div class="respondent-list">
        ${respondents.length === 0
          ? '<span style="color:var(--text-faint); font-size:13px;">まだ回答がありません</span>'
          : respondents.map(r => `<span class="respondent ${r.name === state.myName ? 'me' : ''}">${escapeHtml(r.name)}</span>`).join('')}
      </div>

      <p class="help-text">セル内の数字: ◯人数 / △人数 / ☓人数（セルをクリックで詳細）</p>

      ${renderResultsGrid()}

      <h3 style="font-size:16px; margin-top:32px; margin-bottom:12px;">参加できる人が多い時間 トップ5</h3>
      ${renderTopSlots()}

      <div style="margin-top:32px; padding:12px 16px; background:var(--bg-subtle); border-radius:var(--radius); font-size:13px;">
        <div style="margin-bottom:6px;"><strong>共有URL:</strong></div>
        <div class="share-url">
          <input type="text" readonly value="${escapeHtml(getShareUrl(state.pollId))}" id="resultsShareUrl" />
          <button class="btn-small" onclick="copyResultsUrl()">コピー</button>
        </div>
      </div>
    </div>
  `;
}

function copyResultsUrl() {
  const f = document.getElementById('resultsShareUrl');
  f.select();
  navigator.clipboard.writeText(f.value).then(() => {
    const btn = event.target;
    btn.textContent = 'コピー済';
    setTimeout(() => btn.textContent = 'コピー', 1500);
  });
}

async function reloadResults() {
  await openPoll(state.pollId, 'results');
}

function goRespondFromResults() {
  // 自分の既存回答を探してプリロード
  const mine = state.responses.find(r => r.name === state.myName);
  if (mine) state.myAnswers = mine.answers || {};
  state.screen = 'respond';
  render();
}

function tally(date, hour) {
  const k = slotKey(date, hour);
  let maru = 0, sankaku = 0, batsu = 0;
  state.responses.forEach(r => {
    const a = r.answers && r.answers[k];
    if (a === 'maru') maru++;
    else if (a === 'sankaku') sankaku++;
    else if (a === 'batsu') batsu++;
  });
  return { maru, sankaku, batsu };
}

function heatClass(t, total) {
  if (total === 0) return 'h0';
  if (t.batsu > 0) return 'batsu';
  const score = (t.maru + t.sankaku * 0.5) / total;
  if (score >= 0.85) return 'h5';
  if (score >= 0.6) return 'h4';
  if (score >= 0.4) return 'h3';
  if (score >= 0.2) return 'h2';
  if (score > 0) return 'h1';
  return 'h0';
}

function renderResultsGrid() {
  const p = state.poll;
  const cols = p.dates.length;
  const total = state.responses.length;
  const tmplCols = `60px repeat(${cols}, minmax(60px, 1fr))`;
  let html = `<div class="grid-wrap"><div class="grid" style="grid-template-columns:${tmplCols}; min-width:${60 + cols * 60}px;">`;
  html += `<div class="day-header"></div>`;
  p.dates.forEach(d => { html += `<div class="day-header">${fmtDate(d)}</div>`; });

  p.hours.forEach(h => {
    html += `<div class="time-label">${fmtHour(h)}</div>`;
    p.dates.forEach(d => {
      const t = tally(d, h);
      const cls = heatClass(t, total);
      const display = total === 0 ? '–' : `${t.maru}/${t.sankaku}/${t.batsu}`;
      const clickable = total > 0 ? `onclick="showSlotDetail('${d}', ${h})" style="cursor:pointer"` : '';
      html += `<div class="heat-cell ${cls}" ${clickable}>${display}</div>`;
    });
  });
  html += `</div></div>`;
  return html;
}

function showSlotDetail(date, hour) {
  const k = slotKey(date, hour);
  const maru = [], sankaku = [], batsu = [], unanswered = [];
  state.responses.forEach(r => {
    const a = r.answers && r.answers[k];
    if (a === 'maru') maru.push(r.name);
    else if (a === 'sankaku') sankaku.push(r.name);
    else if (a === 'batsu') batsu.push(r.name);
    else unanswered.push(r.name);
  });

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <h3>${fmtDateShort(date)} ${fmtHour(hour)}</h3>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()" aria-label="閉じる">×</button>
      </div>
      <div class="modal-body">
        <div class="detail-section">
          <div class="detail-label maru-label">◯ 参加できる (${maru.length}人)</div>
          <div class="detail-names">${maru.length > 0 ? maru.map(n => `<span class="name-chip maru">${escapeHtml(n)}</span>`).join('') : '<span class="name-chip empty">なし</span>'}</div>
        </div>
        <div class="detail-section">
          <div class="detail-label sankaku-label">△ 微妙・調整可能 (${sankaku.length}人)</div>
          <div class="detail-names">${sankaku.length > 0 ? sankaku.map(n => `<span class="name-chip sankaku">${escapeHtml(n)}</span>`).join('') : '<span class="name-chip empty">なし</span>'}</div>
        </div>
        <div class="detail-section">
          <div class="detail-label batsu-label">☓ 参加できない (${batsu.length}人)</div>
          <div class="detail-names">${batsu.length > 0 ? batsu.map(n => `<span class="name-chip batsu">${escapeHtml(n)}</span>`).join('') : '<span class="name-chip empty">なし</span>'}</div>
        </div>
        ${unanswered.length > 0 ? `
        <div class="detail-section">
          <div class="detail-label">未回答 (${unanswered.length}人)</div>
          <div class="detail-names">${unanswered.map(n => `<span class="name-chip empty">${escapeHtml(n)}</span>`).join('')}</div>
        </div>` : ''}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

function renderTopSlots() {
  const p = state.poll;
  const total = state.responses.length;
  if (total === 0) return '<p class="help-text">回答が集まったらここに表示されます</p>';

  const slots = [];
  p.dates.forEach(d => {
    p.hours.forEach(h => {
      const t = tally(d, h);
      // ☓が1人でもいれば実質除外（大きなマイナス）
      const score = t.maru + t.sankaku * 0.5 - t.batsu * 1000;
      slots.push({ d, h, t, score });
    });
  });
  slots.sort((a, b) => b.score - a.score);
  const top = slots.filter(s => s.score > 0).slice(0, 5);
  if (top.length === 0) return '<p class="help-text">全員参加可能な時間はまだありません</p>';

  return top.map((s, i) => `
    <div class="top-slot">
      <span class="rank">${i + 1}</span>
      <span class="when">${fmtDateShort(s.d)} ${fmtHour(s.h)}</span>
      <span class="stats">◯${s.t.maru} △${s.t.sankaku} ☓${s.t.batsu}</span>
    </div>
  `).join('');
}

// ===========================================
// 初期化 / ルーティング
// ===========================================
async function openPoll(id, targetScreen) {
  state.screen = 'loading';
  render();
  try {
    const result = await loadPoll(id);
    if (!result) {
      state.screen = 'error';
      state.errorMsg = '指定された調整が見つかりません（ID: ' + id + '）';
      render();
      return;
    }
    state.pollId = id;
    state.poll = result.poll;
    state.responses = result.responses;
    setPollIdInUrl(id);

    // 自分の回答があればプリロード
    const mine = state.responses.find(r => r.name === state.myName);
    if (mine && targetScreen === 'respond') {
      state.myAnswers = mine.answers || {};
    }

    state.screen = targetScreen || (state.responses.length > 0 ? 'results' : 'respond');
    render();
  } catch (e) {
    state.screen = 'error';
    state.errorMsg = '読み込みに失敗しました: ' + (e.message || e);
    render();
  }
}

async function init() {
  const id = getPollIdFromUrl();
  if (id) {
    await openPoll(id);
  } else {
    state.screen = 'landing';
    render();
  }
}

init();
