/* ==========================================================================
   storage.js — 개인 메모가 서버와 이야기하는 유일한 파일
   --------------------------------------------------------------------------
   /api/memos 를 통해 Cloudflare D1 에 저장하므로 어느 기기에서든 같은 메모가
   보입니다. app.js 는 아래 네 함수(list/create/update/remove)만 압니다.

   로그인은 세션 쿠키(HttpOnly)로 확인합니다. 세션이 없거나 끊기면 서버가
   401 을 주고, 여기서 err.authRequired 표시를 달아 던집니다. app.js 가 그걸
   보고 잠금 화면을 띄웁니다.
   ========================================================================== */

const MemoStore = (() => {
  const API = '/api/memos';

  async function call(url, options = {}) {
    let res;
    try {
      res = await fetch(url, {
        credentials: 'same-origin',   // 세션 쿠키를 같이 보냅니다
        ...options
      });
    } catch {
      throw new Error('서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요.');
    }

    if (res.status === 401) {
      const err = new Error('로그인이 필요합니다.');
      err.authRequired = true;
      throw err;
    }

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error || `저장하지 못했습니다 (오류 ${res.status})`);
    }

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
    list() {
      return call(API);
    },

    create(text) {
      return send(API, 'POST', text);
    },

    /** 서버가 고친 뒤의 메모 전체를 돌려줍니다. */
    update(id, text) {
      return send(one(id), 'PUT', text);
    },

    async remove(id) {
      await call(one(id), { method: 'DELETE' });
    }
  };
})();
