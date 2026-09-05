/* ==========================================================================
   storage.js — 메모를 어디에 저장할지 담당하는 유일한 파일
   --------------------------------------------------------------------------
   외부에 보이는 함수(list/create/update/remove/isTemporary)는 그대로입니다.
   나중에 Cloudflare Workers + D1로 옮길 때 이 파일만 바꾸면 됩니다.

   [고친 것]
   전에는 create/update/remove가 매번 이렇게 동작했습니다:
       전체를 JSON.parse → 배열 수정 → 전체를 JSON.stringify → 저장
   메모가 500개면 한 건 고치는 데 500개를 전부 문자열로 만들었다 되돌렸습니다.

   지금은 시작할 때 딱 한 번만 파싱하고, 그 배열이 곧 원본입니다.
   읽기에는 파싱이 아예 없고, 쓰기는 아래처럼 묶어서 처리합니다.
   ========================================================================== */

const MemoStore = (() => {
  const KEY = 'memo.v1';
  const WRITE_DELAY = 200;   // ms

  let cache = [];            // 최신순 정렬을 유지합니다. 이 배열이 원본입니다.
  let persistent = true;     // localStorage를 실제로 쓸 수 있는지
  let writeTimer = null;
  let dirty = false;

  /* --- 시작할 때 한 번만 ------------------------------------------------ */

  (function init() {
    try {
      const probe = '__probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      cache = JSON.parse(window.localStorage.getItem(KEY)) || [];
    } catch {
      // 사파리 비공개 모드, 용량 초과, 미리보기 화면 등
      persistent = false;
      cache = [];
    }
    cache.sort((a, b) => b.createdAt - a.createdAt);
  })();

  /* --- 쓰기 -------------------------------------------------------------
     연달아 고쳐도 실제 저장은 200ms에 한 번만 일어납니다.

     타이머가 이미 걸려 있으면 새로 걸지 않는 방식(스로틀)을 썼습니다.
     매번 타이머를 미루는 방식(디바운스)이면 계속 입력하는 동안 저장이
     무한정 밀릴 수 있어서, 첫 변경 후 200ms 안에는 반드시 한 번
     저장되도록 했습니다.
     ---------------------------------------------------------------------- */

  function flush() {
    if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
    if (!dirty) return;
    dirty = false;
    if (!persistent) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(cache));
    } catch {
      persistent = false;   // 용량이 찼습니다. 이후로는 메모리에만 남습니다.
    }
  }

  function scheduleWrite() {
    dirty = true;
    if (!writeTimer) writeTimer = setTimeout(flush, WRITE_DELAY);
  }

  // 저장이 밀린 상태로 탭이 닫히거나 가려지면 잃어버리므로, 그때는 즉시 씁니다.
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flush();
  });

  function newId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  return {
    /** 최신순 목록. 이미 정렬돼 있어 정렬 비용이 없습니다.
     *  내부 원본 배열이므로 읽기 전용으로만 쓰세요. */
    async list() {
      return cache;
    },

    async create(text) {
      const now = Date.now();
      const memo = { id: newId(), text, createdAt: now, updatedAt: now };
      cache.unshift(memo);   // 새 메모가 항상 제일 최신 → 맨 앞에 넣으면 정렬이 유지됩니다
      scheduleWrite();
      return memo;
    },

    async update(id, text) {
      const memo = cache.find(m => m.id === id);
      if (!memo) return null;
      memo.text = text;
      memo.updatedAt = Date.now();
      scheduleWrite();       // 순서는 createdAt 기준이라 자리는 그대로입니다
      return memo;
    },

    async remove(id) {
      const i = cache.findIndex(m => m.id === id);
      if (i !== -1) {
        cache.splice(i, 1);
        scheduleWrite();
      }
    },

    /** 저장이 유지되지 않는 환경인지 (화면 안내용) */
    isTemporary() {
      return !persistent;
    }
  };
})();
