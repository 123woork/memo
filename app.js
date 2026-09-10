/* ==========================================================================
   app.js — 메모장 화면을 그리고 사용자의 동작을 처리합니다.
   저장 위치는 모릅니다. 서버 호출은 MemoStore(storage.js)에게 시킵니다.

   성능 규칙 — 되돌리지 마세요
   1. 메모마다 DOM 을 딱 한 번만 만들고 rows 맵에 들고 있습니다.
      목록 전체를 다시 그리는 경로는 없습니다.
        검색  만들어 둔 행의 hidden 만 바꿉니다 (DOM 생성 없음)
        저장  새 행 하나만 맨 앞에 끼웁니다          insertRow
        수정  그 행의 글자만 바꿉니다                refreshRow
        삭제  그 행만 떼어냅니다                    dropRow
   2. 1분 타이머는 "시간 표시가 아직 변할 수 있는" 메모(live)만 훑습니다.
      다 굳으면 타이머를 멈추고, 안 보이는 탭에서는 일하지 않습니다.
   ========================================================================== */

const el = {
  editor:   document.getElementById('editor'),
  save:     document.getElementById('save'),
  cancel:   document.getElementById('cancel'),
  hint:     document.getElementById('hint'),
  composer: document.querySelector('.composer'),
  search:   document.getElementById('search'),
  stream:   document.getElementById('stream'),
  notice:   document.getElementById('notice'),
  count:    document.getElementById('count'),
  logout:   document.getElementById('logout'),
};

/** id → { memo, el, timeEl, bodyEl, lower }
 *  lower는 검색용 소문자 사본입니다. 글자를 칠 때마다 toLowerCase()를
 *  다시 돌리지 않기 위해 미리 만들어 둡니다. */
const rows = new Map();

/** 시간 표시가 아직 바뀔 수 있는 메모들. 이틀이 지나면 날짜로 굳어서 빠집니다. */
const live = new Set();

let ticker = null;
let editingId = null;
let busy = false;          // 서버 응답을 기다리는 중인지


/* --- 오류 알리기 ---------------------------------------------------------
   저장이 서버로 가면서 실패할 수 있게 됐습니다. 조용히 삼키면 사용자는
   저장된 줄 알기 때문에, 입력창 아래 안내 자리에 띄웁니다.
   -------------------------------------------------------------------------- */

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const DEFAULT_HINT = `${isMac ? '⌘' : 'Ctrl'} + Enter로 저장`;
let hintTimer = null;

/** 오류를 6초 동안 보여 주고 원래 안내로 돌아갑니다. */
function flash(message) {
  clearTimeout(hintTimer);
  el.hint.textContent = message;
  el.hint.classList.add('composer__hint--error');
  hintTimer = setTimeout(() => {
    el.hint.classList.remove('composer__hint--error');
    el.hint.textContent = DEFAULT_HINT;
  }, 6000);
}

function setBusy(on) {
  busy = on;
  el.save.disabled = on;
}


/* --- 시간 표시 ----------------------------------------------------------- */

const LIVE_WINDOW = 48 * 60 * 60 * 1000;

function isLive(memo) {
  return Date.now() - memo.createdAt < LIVE_WINDOW;
}

function timeLabel(memo) {
  const now = new Date();
  const then = new Date(memo.createdAt);
  const diffSec = Math.floor((now - then) / 1000);
  const edited = memo.updatedAt - memo.createdAt > 1000 ? ' · 수정함' : '';

  let when;
  if (diffSec < 60) {
    when = '방금';
  } else if (diffSec < 3600) {
    when = `${Math.floor(diffSec / 60)}분 전`;
  } else if (now.toDateString() === then.toDateString()) {
    when = `${Math.floor(diffSec / 3600)}시간 전`;
  } else {
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    when = yesterday.toDateString() === then.toDateString()
      ? `어제 ${then.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })}`
      : then.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  }
  return when + edited;
}


/* --- 행 만들기 (메모 한 건당 딱 한 번) ----------------------------------- */

function toolButton(label, action, extra = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'linkbtn ' + extra;
  b.dataset.action = action;
  b.textContent = label;
  return b;
}

function normalTools(toolsEl) {
  toolsEl.replaceChildren(
    toolButton('수정', 'edit'),
    toolButton('삭제', 'ask-delete', 'linkbtn--danger')
  );
}

function buildRow(memo) {
  const li = document.createElement('li');
  li.className = 'memo';
  li.dataset.id = memo.id;

  const timeEl = document.createElement('time');
  timeEl.className = 'memo__time';
  timeEl.dateTime = new Date(memo.createdAt).toISOString();
  timeEl.textContent = timeLabel(memo);

  // textContent라서 메모에 <script>를 적어도 그냥 글자로 남습니다.
  const bodyEl = document.createElement('div');
  bodyEl.className = 'memo__body';
  bodyEl.textContent = memo.text;

  const toolsEl = document.createElement('div');
  toolsEl.className = 'memo__tools';
  normalTools(toolsEl);

  li.append(timeEl, bodyEl, toolsEl);

  const entry = { memo, el: li, timeEl, bodyEl, toolsEl, lower: memo.text.toLowerCase() };
  rows.set(memo.id, entry);
  if (isLive(memo)) live.add(memo.id);
  return entry;
}


/* --- 화면 갱신은 전부 이 세 개로만 일어납니다 ---------------------------- */

function insertRow(memo) {
  const entry = buildRow(memo);
  el.stream.prepend(entry.el);

  entry.el.classList.add('memo--new');
  entry.el.addEventListener('animationend', () => {
    entry.el.classList.remove('memo--new');
  }, { once: true });

  startTicker();
  updateCount();
  applyFilter();
}

function refreshRow(entry) {
  entry.bodyEl.textContent = entry.memo.text;
  entry.lower = entry.memo.text.toLowerCase();
  entry.timeEl.textContent = timeLabel(entry.memo);
  applyFilter();
}

function dropRow(id) {
  const entry = rows.get(id);
  if (!entry) return;
  entry.el.remove();
  rows.delete(id);
  live.delete(id);
  updateCount();
  applyFilter();
}


/* --- 검색: 행을 새로 만들지 않고 숨기고 보이기만 합니다 ------------------ */

function applyFilter() {
  const raw = el.search.value.trim();
  const q = raw.toLowerCase();
  let visible = 0;

  for (const entry of rows.values()) {
    const shouldHide = !!q && !entry.lower.includes(q);
    if (entry.el.hidden !== shouldHide) entry.el.hidden = shouldHide;  // 바뀔 때만 건드립니다
    if (!shouldHide) visible++;
  }

  if (visible > 0) {
    el.notice.hidden = true;
  } else {
    el.notice.hidden = false;
    el.notice.textContent = rows.size
      ? `"${raw}"에 해당하는 메모가 없습니다.`
      : '아직 메모가 없습니다. 위에 적고 저장하면 여기에 쌓입니다.';
  }
}

function updateCount() {
  el.count.textContent = rows.size ? `메모 ${rows.size}개` : '';
}


/* --- 1분 타이머: 아직 변할 수 있는 것만, 볼 때만 ------------------------- */

function tick() {
  if (document.hidden) return;

  for (const id of live) {
    const entry = rows.get(id);
    if (!entry) { live.delete(id); continue; }

    const label = timeLabel(entry.memo);
    if (entry.timeEl.textContent !== label) entry.timeEl.textContent = label;

    if (!isLive(entry.memo)) live.delete(id);   // 날짜로 굳었으니 더 볼 필요 없음
  }

  if (live.size === 0) { clearInterval(ticker); ticker = null; }
}

function startTicker() {
  if (!ticker && live.size > 0) ticker = setInterval(tick, 60000);
}

// 가려져 있는 동안은 쉬었으므로, 다시 보일 때 한 번 따라잡습니다.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) tick();
});


/* --- 저장 / 수정 --------------------------------------------------------- */

async function submit() {
  if (busy) return;                       // 응답 오기 전 연타 방지
  const text = el.editor.value.trim();
  if (!text) { el.editor.focus(); return; }

  setBusy(true);
  try {
    if (editingId) {
      const entry = rows.get(editingId);
      const updated = await MemoStore.update(editingId, text);
      leaveEditMode();
      // 저장소가 돌려준 객체를 다시 들고 있습니다.
      if (entry && updated) {
        entry.memo = updated;
        refreshRow(entry);
      }
    } else {
      const memo = await MemoStore.create(text);
      leaveEditMode();
      insertRow(memo);
    }
  } catch (err) {
    // 입력창 내용은 지우지 않습니다. 쓴 글이 사라지면 안 되니까요.
    if (err.authRequired) {
      Auth.open(() => submit());   // 다시 잠기면 풀고 나서 이어서 저장합니다
    } else {
      flash(err.message);
    }
  } finally {
    setBusy(false);
  }
}

function enterEditMode(memo) {
  editingId = memo.id;
  el.editor.value = memo.text;
  el.save.textContent = '수정 완료';
  el.cancel.hidden = false;
  el.composer.classList.add('is-editing');
  el.editor.focus();
  el.editor.setSelectionRange(memo.text.length, memo.text.length);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function leaveEditMode() {
  editingId = null;
  el.editor.value = '';
  el.save.textContent = '저장';
  el.cancel.hidden = true;
  el.composer.classList.remove('is-editing');
}


/* --- 목록에서 일어나는 일 (행 하나만 건드립니다) ------------------------- */

el.stream.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const entry = rows.get(btn.closest('.memo').dataset.id);
  if (!entry) return;

  switch (btn.dataset.action) {
    case 'edit':
      enterEditMode(entry.memo);
      break;

    // 삭제는 되돌릴 수 없으니 그 줄에서 바로 확인받습니다.
    case 'ask-delete': {
      const ask = document.createElement('span');
      ask.className = 'memo__ask';
      ask.textContent = '삭제할까요?';
      entry.toolsEl.replaceChildren(
        ask,
        toolButton('삭제', 'confirm-delete', 'linkbtn--danger'),
        toolButton('그대로 두기', 'cancel-delete')
      );
      break;
    }

    case 'confirm-delete':
      try {
        await MemoStore.remove(entry.memo.id);
        if (editingId === entry.memo.id) leaveEditMode();
        dropRow(entry.memo.id);   // 서버에서 지워진 걸 확인한 뒤에만 화면에서 뺍니다
      } catch (err) {
        normalTools(entry.toolsEl);
        if (err.authRequired) Auth.open(() => {}); else flash(err.message);
      }
      break;

    case 'cancel-delete':
      normalTools(entry.toolsEl);
      break;
  }
});


/* --- 입력 관련 ----------------------------------------------------------- */

el.save.addEventListener('click', submit);
el.cancel.addEventListener('click', () => { leaveEditMode(); el.editor.focus(); });
el.search.addEventListener('input', applyFilter);

el.editor.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    submit();
  }
  if (e.key === 'Escape' && editingId) leaveEditMode();
});


/* --- 시작 ---------------------------------------------------------------- */

el.hint.textContent = DEFAULT_HINT;

el.logout.addEventListener('click', () => Auth.logout());

async function start() {
  el.notice.hidden = false;
  el.notice.textContent = '불러오는 중…';

  let memos;
  try {
    memos = await MemoStore.list();
  } catch (err) {
    if (err.authRequired) { Auth.open(start); return; }   // 잠겨 있으면 풀고 다시
    el.notice.textContent = err.message;
    return;   // 목록을 못 받았으므로 빈 화면으로 두지 않고 이유를 남깁니다
  }

  // 다시 부를 수 있으므로 이전 내용을 비웁니다
  el.stream.replaceChildren();
  rows.clear();
  live.clear();

  // 한 번에 붙여서 화면 재계산을 한 번만 일으킵니다.
  const frag = document.createDocumentFragment();
  for (const memo of memos) frag.appendChild(buildRow(memo).el);
  el.stream.appendChild(frag);

  el.logout.hidden = false;
  updateCount();
  applyFilter();
  startTicker();
  el.editor.focus();
}

start();
