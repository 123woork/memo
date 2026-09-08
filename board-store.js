/* ==========================================================================
   board-store.js — 게시판이 서버와 이야기하는 유일한 파일
   --------------------------------------------------------------------------
   storage.js 가 개인 메모를 맡듯이, 이 파일은 게시판만 맡습니다.
   board.js 는 아래 함수 이름만 알면 되고, 주소나 요청 방식은 모릅니다.

   개인 메모(/api/memos)는 절대 건드리지 않습니다.
   ========================================================================== */

const BoardStore = (() => {
  const API = '/api/board';

  async function call(url, options = {}) {
    let res;
    try {
      res = await fetch(url, { credentials: 'same-origin', ...options });
    } catch {
      throw new Error('서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요.');
    }

    const body = await res.json().catch(() => null);

    if (!res.ok) {
      const err = new Error((body && body.error) || '요청에 실패했습니다 (오류 ' + res.status + ')');
      err.status = res.status;
      throw err;
    }

    return body;
  }

  function sendJson(url, method, payload) {
    return call(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  const postUrl = id => API + '/posts/' + encodeURIComponent(id);

  return {
    /** 사이트 키, 주인 여부, 길이 상한. 화면이 뜰 때 한 번 부릅니다. */
    config() {
      return call(API + '/config');
    },

    /** 목록 한 쪽 */
    listPosts(page) {
      return call(API + '/posts?page=' + encodeURIComponent(page));
    },

    /** 글 하나 + 댓글 전부 */
    readPost(id) {
      return call(postUrl(id));
    },

    createPost(payload) {
      return sendJson(API + '/posts', 'POST', payload);
    },

    updatePost(id, payload) {
      return sendJson(postUrl(id), 'PUT', payload);
    },

    /** 비밀번호는 주소가 아니라 본문에 담아 보냅니다.
     *  주소에 넣으면 서버 기록과 브라우저 방문 기록에 남습니다. */
    deletePost(id, password) {
      return sendJson(postUrl(id), 'DELETE', { password });
    },

    /** HTML 첨부 올리기 (주인만). 파일 내용을 글자 그대로 실어 보냅니다. */
    uploadFile(postId, name, html) {
      return sendJson(postUrl(postId) + '/files', 'POST', { name, html });
    },

    deleteFile(fileId) {
      return call(API + '/files/' + encodeURIComponent(fileId), { method: 'DELETE' });
    },

    /** 첨부 내용을 보여 줄 주소.
     *  이 응답은 격리된 출처로 내려오므로 iframe 에 그대로 넣어도 안전합니다. */
    fileViewUrl(fileId) {
      return API + '/files/' + encodeURIComponent(fileId) + '/raw';
    },

    createComment(postId, payload) {
      return sendJson(postUrl(postId) + '/comments', 'POST', payload);
    },

    deleteComment(commentId, password) {
      return sendJson(
        API + '/comments/' + encodeURIComponent(commentId),
        'DELETE',
        { password }
      );
    }
  };
})();
