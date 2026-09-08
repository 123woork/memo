/* ==========================================================================
   board.js — 게시판 화면
   --------------------------------------------------------------------------
   서버와의 대화는 board-store.js 가 전담합니다. 이 파일은 그리기만 합니다.

   화면에 남의 글이 올라오므로 규칙이 하나 있습니다.
   ---> 사람이 쓴 값은 반드시 textContent 로만 넣습니다. innerHTML 금지. <---
   그래야 남이 쓴 <script> 나 onerror= 가 코드로 실행되지 않습니다.
   _headers 의 CSP(script-src 'self')가 한 겹 더 막아 주지만, 첫 번째 방어선은
   여기입니다.
   ========================================================================== */

(() => {
  const $ = id => document.getElementById(id);

  const views = {
    list:  $('view-list'),
    write: $('view-write'),
    read:  $('view-read')
  };

  const els = {
    count:      $('count'),
    notice:     $('notice'),

    postList:   $('post-list'),
    listEmpty:  $('list-empty'),
    pager:      $('pager'),
    pagerAt:    $('pager-at'),
    prev:       $('prev'),
    next:       $('next'),
    goWrite:    $('go-write'),

    writeTitle: $('write-title'),
    wTitle:     $('w-title'),
    wNickname:  $('w-nickname'),
    wPassword:  $('w-password'),
    wBody:      $('w-body'),
    wWebsite:   $('w-website'),
    wNickField: $('w-nickname-field'),
    wPassField: $('w-password-field'),
    wTurnstile: $('w-turnstile'),
    writeMsg:   $('write-msg'),
    writeSave:  $('write-save'),
    writeCancel:$('write-cancel'),

    rTitle:     $('r-title'),
    rNickname:  $('r-nickname'),
    rDate:      $('r-date'),
    rEdited:    $('r-edited'),
    rBody:      $('r-body'),
    rBack:      $('r-back'),
    rEdit:      $('r-edit'),
    rDelete:    $('r-delete'),

    cCount:     $('c-count'),
    cList:      $('comment-list'),
    cNickname:  $('c-nickname'),
    cPassword:  $('c-password'),
    cBody:      $('c-body'),
    cWebsite:   $('c-website'),
    cNickField: $('c-nickname-field'),
    cPassField: $('c-password-field'),
    cTurnstile: $('c-turnstile'),
    commentMsg: $('comment-msg'),
    commentSave:$('comment-save'),

    ask:        $('ask'),
    askMsg:     $('ask-msg'),
    askInput:   $('ask-input'),
    askOk:      $('ask-ok'),
    askCancel:  $('ask-cancel')
  };

  let cfg      = { turnstileSiteKey: null, owner: false, limits: {} };
  let page     = 1;
  let current  = null;    // 지금 읽고 있는 글
  let editingId = null;   // 수정 중이면 그 글의 id
  let busy     = false;

  /* ------------------------------------------------------------ 시간 표시 */

  const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;

  function whenText(ts) {
    const gap = Date.now() - ts;
    if (gap < MIN)  return '방금';
    if (gap < HOUR) return Math.floor(gap / MIN) + '분 전';
    if (gap < DAY)  return Math.floor(gap / HOUR) + '시간 전';
    const d = new Date(ts);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    const md = (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
    return sameYear ? md : d.getFullYear() + '년 ' + md;
  }

  /* ------------------------------------------------------------ 화면 전환 */

  function show(name) {
    for (const key of Object.keys(views)) views[key].hidden = key !== name;
    window.scrollTo(0, 0);
  }

  function setNotice(text) {
    els.notice.textContent = text || '';
    els.notice.hidden = !text;
  }

  function setMsg(el, text, isError) {
    el.textContent = text || '';
    el.classList.toggle('field__msg--error', !!isError);
  }

  /* ------------------------------------------------- 사람 확인 (Turnstile) */

  /* 사이트 키가 없으면 위젯을 아예 그리지 않고, 서버도 검사를 건너뜁니다.
     키를 넣는 순간부터 양쪽이 자동으로 켜집니다. */
  const captcha = (() => {
    const widgets = new Map();
    let loading = null;

    function loadScript() {
      if (loading) return loading;
      loading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        s.async = true;
        s.onload = resolve;
        s.onerror = () => reject(new Error('사람 확인을 불러오지 못했습니다.'));
        document.head.appendChild(s);
      });
      return loading;
    }

    return {
      enabled() {
        return !!cfg.turnstileSiteKey;
      },

      async mount(el) {
        if (!cfg.turnstileSiteKey || widgets.has(el)) return;
        await loadScript();
        widgets.set(el, window.turnstile.render(el, {
          sitekey: cfg.turnstileSiteKey,
          theme: 'light'
        }));
      },

      token(el) {
        if (!cfg.turnstileSiteKey) return undefined;
        const id = widgets.get(el);
        return id === undefined ? '' : window.turnstile.getResponse(id);
      },

      /* 토큰은 한 번 쓰면 버려집니다. 보내고 나면 반드시 새로 받아야 합니다. */
      reset(el) {
        const id = widgets.get(el);
        if (id !== undefined) window.turnstile.reset(id);
      }
    };
  })();

  /* --------------------------------------------------- 비밀번호 물어보기 */

  let askResolve = null;

  function askPassword(message) {
    els.askMsg.textContent = message;
    els.askInput.value = '';
    els.ask.hidden = false;
    els.askInput.focus();
    return new Promise(resolve => { askResolve = resolve; });
  }

  function closeAsk(value) {
    els.ask.hidden = true;
    const done = askResolve;
    askResolve = null;
    if (done) done(value);
  }

  els.askOk.addEventListener('click', () => closeAsk(els.askInput.value));
  els.askCancel.addEventListener('click', () => closeAsk(null));
  els.askInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') closeAsk(els.askInput.value);
    if (e.key === 'Escape') closeAsk(null);
  });

  /* ------------------------------------------------------------ 목록 화면 */

  function makeRow(post) {
    const li = document.createElement('li');
    li.className = 'board__row';

    const link = document.createElement('a');
    link.className = 'board__link';
    link.href = '/board?p=' + encodeURIComponent(post.id);
    link.textContent = post.title;          // 사람이 쓴 값 — textContent
    link.addEventListener('click', e => {
      e.preventDefault();
      goToPost(post.id);
    });

    const meta = document.createElement('p');
    meta.className = 'board__meta';

    const who = document.createElement('span');
    who.textContent = post.nickname;        // 사람이 쓴 값 — textContent
    if (post.isOwner) who.className = 'board__owner';
    meta.appendChild(who);

    meta.appendChild(document.createTextNode(' · '));

    const when = document.createElement('span');
    when.textContent = whenText(post.createdAt);
    meta.appendChild(when);

    if (post.commentCount > 0) {
      const c = document.createElement('span');
      c.className = 'board__comments';
      c.textContent = '댓글 ' + post.commentCount;
      meta.appendChild(document.createTextNode(' · '));
      meta.appendChild(c);
    }

    li.appendChild(link);
    li.appendChild(meta);
    return li;
  }

  async function loadList(p) {
    setNotice('');
    try {
      const data = await BoardStore.listPosts(p);
      page = data.page;

      els.postList.replaceChildren(...data.posts.map(makeRow));
      els.listEmpty.hidden = data.posts.length > 0;

      els.count.textContent = data.total > 0 ? '글 ' + data.total : '';
      els.pager.hidden = data.totalPages <= 1;
      els.pagerAt.textContent = data.page + ' / ' + data.totalPages;
      els.prev.disabled = data.page <= 1;
      els.next.disabled = data.page >= data.totalPages;
    } catch (err) {
      setNotice(err.message);
    }
  }

  /* ------------------------------------------------------------ 읽기 화면 */

  function makeComment(comment) {
    const li = document.createElement('li');
    li.className = 'comment';

    const meta = document.createElement('p');
    meta.className = 'comment__meta';

    const who = document.createElement('span');
    who.textContent = comment.nickname;     // 사람이 쓴 값 — textContent
    if (comment.isOwner) who.className = 'board__owner';
    meta.appendChild(who);

    meta.appendChild(document.createTextNode(' · '));
    const when = document.createElement('span');
    when.textContent = whenText(comment.createdAt);
    meta.appendChild(when);

    // 지울 수 있는 경우에만 버튼을 답니다
    if (cfg.owner || comment.hasPassword) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'linkbtn comment__del';
      del.textContent = '삭제';
      del.addEventListener('click', () => removeComment(comment, li));
      meta.appendChild(document.createTextNode(' · '));
      meta.appendChild(del);
    }

    const body = document.createElement('div');
    body.className = 'comment__body';
    body.textContent = comment.body;        // 사람이 쓴 값 — textContent

    li.appendChild(meta);
    li.appendChild(body);
    return li;
  }

  function paintPost(post, comments) {
    current = post;

    els.rTitle.textContent    = post.title;      // 사람이 쓴 값
    els.rNickname.textContent = post.nickname;   // 사람이 쓴 값
    els.rNickname.className   = post.isOwner ? 'board__owner' : '';
    els.rDate.textContent     = whenText(post.createdAt);
    els.rEdited.hidden        = post.updatedAt <= post.createdAt;
    els.rBody.textContent     = post.body;       // 사람이 쓴 값. 줄바꿈은 CSS가 살립니다.

    const mayTouch = cfg.owner || post.hasPassword;
    els.rEdit.hidden   = !mayTouch;
    els.rDelete.hidden = !mayTouch;

    els.cCount.textContent = String(comments.length);
    els.cList.replaceChildren(...comments.map(makeComment));

    els.cBody.value = '';
    setMsg(els.commentMsg, '');
    if (!cfg.owner && captcha.enabled()) captcha.mount(els.cTurnstile);
  }

  async function openPost(id) {
    setNotice('');
    try {
      const data = await BoardStore.readPost(id);
      paintPost(data.post, data.comments);
      show('read');
    } catch (err) {
      setNotice(err.message);
      show('list');
    }
  }

  /* ------------------------------------------------------ 글쓰기 / 수정 */

  function openWrite(post) {
    editingId = post ? post.id : null;

    els.writeTitle.textContent = post ? '글 수정' : '글쓰기';
    els.wTitle.value = post ? post.title : '';
    els.wBody.value  = post ? post.body  : '';
    els.wNickname.value = '';
    els.wPassword.value = '';
    els.wWebsite.value  = '';

    // 주인은 닉네임도 비밀번호도 필요 없습니다.
    // 수정할 때는 닉네임을 바꾸지 않으므로 감춥니다.
    els.wNickField.hidden = cfg.owner || !!post;
    els.wPassField.hidden = cfg.owner || !!post;

    // 사람 확인은 "새 글"에만 붙입니다.
    // 수정은 비밀번호(또는 주인 세션)로 이미 자격을 확인하므로 필요 없습니다.
    setMsg(els.writeMsg, '');
    const needsCaptcha = !cfg.owner && !editingId && captcha.enabled();
    if (needsCaptcha) captcha.mount(els.wTurnstile);
    els.wTurnstile.hidden = !needsCaptcha;

    show('write');
    els.wTitle.focus();
  }

  async function saveWrite() {
    if (busy) return;

    const title = els.wTitle.value.trim();
    const body  = els.wBody.value.trim();

    if (!title) { setMsg(els.writeMsg, '제목을 적어 주세요.', true); return; }
    if (!body)  { setMsg(els.writeMsg, '내용을 적어 주세요.', true); return; }

    busy = true;
    els.writeSave.disabled = true;
    setMsg(els.writeMsg, '올리는 중입니다.');

    try {
      if (editingId) {
        // 수정 — 주인이 아니면 글 비밀번호를 물어봅니다
        let password;
        if (!cfg.owner) {
          password = await askPassword('글을 쓸 때 정한 비밀번호를 넣으세요.');
          if (password === null) { setMsg(els.writeMsg, ''); return; }
        }
        await BoardStore.updatePost(editingId, { title, body, password });
        await openPost(editingId);
      } else {
        const created = await BoardStore.createPost({
          title, body,
          nickname: els.wNickname.value,
          password: els.wPassword.value,
          website:  els.wWebsite.value,
          turnstileToken: cfg.owner ? undefined : captcha.token(els.wTurnstile)
        });
        captcha.reset(els.wTurnstile);
        goToPost(created.id);
      }
    } catch (err) {
      setMsg(els.writeMsg, err.message, true);
      captcha.reset(els.wTurnstile);
    } finally {
      busy = false;
      els.writeSave.disabled = false;
    }
  }

  async function removePost() {
    if (!current || busy) return;

    let password;
    if (!cfg.owner) {
      password = await askPassword('글을 지웁니다. 쓸 때 정한 비밀번호를 넣으세요.');
      if (password === null) return;
    } else if (!window.confirm('이 글을 지울까요? 댓글도 같이 지워집니다.')) {
      return;
    }

    busy = true;
    try {
      await BoardStore.deletePost(current.id, password);
      goToList();
    } catch (err) {
      setNotice(err.message);
    } finally {
      busy = false;
    }
  }

  /* ---------------------------------------------------------------- 댓글 */

  async function addComment() {
    if (!current || busy) return;

    const body = els.cBody.value.trim();
    if (!body) { setMsg(els.commentMsg, '댓글 내용을 적어 주세요.', true); return; }

    busy = true;
    els.commentSave.disabled = true;
    setMsg(els.commentMsg, '올리는 중입니다.');

    try {
      const created = await BoardStore.createComment(current.id, {
        body,
        nickname: els.cNickname.value,
        password: els.cPassword.value,
        website:  els.cWebsite.value,
        turnstileToken: cfg.owner ? undefined : captcha.token(els.cTurnstile)
      });

      // 목록 전체를 다시 그리지 않고 새 댓글 하나만 붙입니다
      els.cList.appendChild(makeComment(created));
      els.cCount.textContent = String(els.cList.children.length);
      els.cBody.value = '';
      setMsg(els.commentMsg, '');
      captcha.reset(els.cTurnstile);
    } catch (err) {
      setMsg(els.commentMsg, err.message, true);
      captcha.reset(els.cTurnstile);
    } finally {
      busy = false;
      els.commentSave.disabled = false;
    }
  }

  async function removeComment(comment, row) {
    if (busy) return;

    let password;
    if (!cfg.owner) {
      password = await askPassword('댓글을 지웁니다. 쓸 때 정한 비밀번호를 넣으세요.');
      if (password === null) return;
    }

    busy = true;
    try {
      await BoardStore.deleteComment(comment.id, password);
      row.remove();                                   // 그 줄만 지웁니다
      els.cCount.textContent = String(els.cList.children.length);
      setMsg(els.commentMsg, '');
    } catch (err) {
      setMsg(els.commentMsg, err.message, true);
    } finally {
      busy = false;
    }
  }

  /* ------------------------------------------------------------ 주소 이동 */

  function goToList() {
    history.pushState({}, '', '/board');
    current = null;
    show('list');
    loadList(page);
  }

  function goToPost(id) {
    history.pushState({}, '', '/board?p=' + encodeURIComponent(id));
    openPost(id);
  }

  function routeFromUrl() {
    const id = new URLSearchParams(location.search).get('p');
    if (id) {
      openPost(id);
    } else {
      show('list');
      loadList(page);
    }
  }

  window.addEventListener('popstate', routeFromUrl);

  /* ------------------------------------------------------------ 버튼 연결 */

  els.goWrite.addEventListener('click', () => openWrite(null));
  els.writeCancel.addEventListener('click', () => {
    if (editingId) openPost(editingId); else goToList();
  });
  els.writeSave.addEventListener('click', saveWrite);

  els.rBack.addEventListener('click', goToList);
  els.rEdit.addEventListener('click', () => openWrite(current));
  els.rDelete.addEventListener('click', removePost);

  els.commentSave.addEventListener('click', addComment);

  els.prev.addEventListener('click', () => { if (page > 1) loadList(page - 1); });
  els.next.addEventListener('click', () => loadList(page + 1));

  /* ------------------------------------------------------------------ 시작 */

  (async () => {
    try {
      cfg = await BoardStore.config();
    } catch {
      // 설정을 못 받아도 목록은 보여 줍니다. 글쓰기에서 다시 실패하며 이유를 알려 줍니다.
      setNotice('설정을 불러오지 못했습니다. 새로고침해 보세요.');
    }

    // 주인으로 로그인한 상태면 닉네임/비밀번호 칸을 감춥니다
    els.cNickField.hidden = cfg.owner;
    els.cPassField.hidden = cfg.owner;
    els.cTurnstile.hidden = cfg.owner || !captcha.enabled();

    routeFromUrl();
  })();
})();
