/* ==========================================================================
   storage.js — 메모를 어디에 저장할지 담당하는 유일한 파일
   --------------------------------------------------------------------------
   서버(Cloudflare D1) 저장 버전입니다.
   앞 버전은 브라우저에만 저장해서 기기끼리 안 보였습니다.
   지금은 /api/memos 를 통해 서버에 저장하므로 어느 기기에서든 같은 메모가
   보입니다. 누가 로그인했는지는 서버가 Cloudflare Access 토큰으로 알아냅니다.

   app.js에 보이는 함수 이름(list/create/update/remove)은 그대로입니다.
   ========================================================================== */

const MemoStore = (() => {
  const API = '/api/memos';

  async function call(url, options = {}) {
    let res;
    try {
      res = await fetch(url, {
        credentials: 'same-origin',   // Access 로그인 쿠키를 같이 보냅니다
        ...options
      });
    } catch {
      throw new Error('서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요.');
    }

    if (res.status === 401) {
      const err = new Error('로그인이 필요합니다.');
      err.authRequired = true;   // app.js가 이걸 보고 잠금 화면을 띄웁니다
      throw err;
    }

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error || `저장하지 못했습니다 (오류 ${res.status})`);
    }

    if (res.status === 204) return null;
    return res.json();
  }

  function send(url, method, text) {
    return call(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
  }

  const one = id => `${API}/${encodeURIComponent(id)}`;

  return {
    /** 최신순 목록. 서버가 이미 정렬해서 보내줍니다. */
    async list() {
      return call(API);
    },

    async create(text) {
      return send(API, 'POST', text);
    },

    async update(id, text) {
      return send(one(id), 'PUT', text);
    },

    async remove(id) {
      await call(one(id), { method: 'DELETE' });
    },

    /** 서버에 저장하므로 항상 false입니다. */
    isTemporary() {
      return false;
    }
  };
})();
