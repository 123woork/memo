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
    wOwnerNote: $('w-owner-note'),
    wTurnstile: $('w-turnstile'),
    wFilesField:$('w-files-field'),
    wFileInput: $('w-file-input'),
    wFileClear: $('w-file-clear'),
    wFileNames: $('w-file-names'),
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

    filesSec:   $('files-section'),
    fileList:   $('file-list'),
    fileAdd:    $('file-add'),
    fileInput:  $('file-input'),
    fileMsg:    $('file-msg'),

    cCount:     $('c-count'),
    cList:      $('comment-list'),
    cNickname:  $('c-nickname'),
    cPassword:  $('c-password'),
    cBody:      $('c-body'),
    cWebsite:   $('c-website'),
    cOwnerNote: $('c-owner-note'),
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
  let pending  = [];      // 글쓰기 화면에서 고른 HTML 파일 (아직 안 올림)

  /* 첨부 상한은 서버(/api/board/config)가 알려 줍니다. 서버가 최종 판정을 하고,
     여기서는 큰 파일을 헛되이 올리지 않게 미리 걸러 냅니다.
     설정을 못 받았을 때만 아래 기본값을 씁니다. */
  const fileMax   = () => cfg.limits.fileBytes    || 500000;
  const fileCount = () => cfg.limits.filesPerPost || 10;

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

  /* ----------------------------------------------------------- HTML 첨부 */

  function sizeText(bytes) {
    return bytes < 1000 ? bytes + 'B' : Math.round(bytes / 1000) + 'KB';
  }

  function makeFileRow(file) {
    const li = document.createElement('li');
    li.className = 'file';

    const bar = document.createElement('p');
    bar.className = 'file__bar';

    const name = document.createElement('span');
    name.className = 'file__name';
    name.textContent = file.name;          // 사람이 올린 값 — textContent
    bar.appendChild(name);

    const size = document.createElement('span');
    size.className = 'file__size';
    size.textContent = ' ' + sizeText(file.size);
    bar.appendChild(size);

    // 보기 — 격리된 틀을 이 줄 아래에 폈다 접었다 합니다
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'linkbtn file__act';
    toggle.textContent = '보기';
    bar.appendChild(toggle);

    // 새 창 — 주소를 직접 열어도 서버가 같은 격리 헤더를 붙여 내려줍니다
    const open = document.createElement('a');
    open.className = 'linkbtn file__act';
    open.textContent = '새 창';
    open.href = BoardStore.fileViewUrl(file.id);
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
    bar.appendChild(open);

    if (cfg.owner) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'linkbtn file__act';
      del.textContent = '삭제';
      del.addEventListener('click', () => removeFile(file, li));
      bar.appendChild(del);
    }

    li.appendChild(bar);

    let frame = null;
    toggle.addEventListener('click', () => {
      if (frame) {
        frame.remove();
        frame = null;
        toggle.textContent = '보기';
        return;
      }
      frame = document.createElement('iframe');
      frame.className = 'file__frame';
      frame.title = file.name;
      frame.loading = 'lazy';
      /* 서버가 CSP sandbox 로 이미 격리해 내려주지만, 틀에도 한 번 더 겁니다.
         allow-same-origin 은 넣지 않습니다. 넣으면 격리가 풀립니다. */
      frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-modals');
      frame.src = BoardStore.fileViewUrl(file.id);
      li.appendChild(frame);
      toggle.textContent = '접기';
    });

    return li;
  }

  function paintFiles(files) {
    els.fileList.replaceChildren(...files.map(makeFileRow));
    els.fileAdd.hidden = !cfg.owner;
    // 첨부가 없고 주인도 아니면 이 영역 자체를 감춥니다
    els.filesSec.hidden = files.length === 0 && !cfg.owner;
    setMsg(els.fileMsg, '');
  }

  /** 올리기 전에 크기를 봅니다. 문제가 없으면 null. */
  function fileProblem(files) {
    // 서버에서도 다시 재지만, 큰 파일을 통째로 보내기 전에 여기서 걸러 줍니다
    const big = files.find(f => f.size > fileMax());
    if (big) return '"' + big.name + '" 이(가) 너무 큽니다. ' + sizeText(fileMax()) + '까지 올릴 수 있습니다.';
    return null;
  }

  /** 파일을 하나씩 올립니다. 올라간 것마다 onDone(서버가 준 첨부 정보)을 부릅니다.
   *  중간에 실패하면 그 자리에서 멈추고 오류를 던집니다(앞서 올린 건 남습니다). */
  async function uploadAll(postId, files, onDone) {
    for (let i = 0; i < files.length; i++) {
      setMsg(els.fileMsg, '올리는 중입니다. (' + (i + 1) + '/' + files.length + ')');
      const html = await files[i].text();
      onDone(await BoardStore.uploadFile(postId, files[i].name, html));
    }
  }

  function addFileRow(created) {
    els.fileList.appendChild(makeFileRow(created));
    els.filesSec.hidden = false;
  }

  async function uploadPicked() {
    const picked = Array.from(els.fileInput.files || []);
    els.fileInput.value = '';                 // 같은 파일을 다시 골라도 반응하도록
    if (!picked.length || !current || busy) return;

    const problem = fileProblem(picked);
    if (problem) { setMsg(els.fileMsg, problem, true); return; }

    busy = true;
    try {
      await uploadAll(current.id, picked, addFileRow);
      setMsg(els.fileMsg, picked.length + '개 올렸습니다.');
    } catch (err) {
      setMsg(els.fileMsg, err.message, true);
    } finally {
      busy = false;
    }
  }

  /* --- 글쓰기 화면에서 고른 파일. 글이 올라간 뒤에 이어서 올립니다. --- */

  function paintPending() {
    els.wFileNames.replaceChildren(...pending.map(file => {
      const li = document.createElement('li');
      li.textContent = file.name + ' · ' + sizeText(file.size);   // 파일 이름 — textContent
      return li;
    }));
    els.wFileClear.hidden = pending.length === 0;
  }

  function pickPending() {
    const picked = Array.from(els.wFileInput.files || []);
    els.wFileInput.value = '';                // 같은 파일을 다시 골라도 반응하도록
    if (!picked.length) return;

    // 다시 고르면 앞의 선택에 더합니다. 같은 이름은 새로 고른 쪽으로 바꿉니다.
    const names = new Set(picked.map(f => f.name));
    pending = pending.filter(f => !names.has(f.name)).concat(picked);
    paintPending();

    const problem = fileProblem(pending) ||
      (pending.length > fileCount() ? '글 하나에 ' + fileCount() + '개까지 붙일 수 있습니다.' : null);
    setMsg(els.writeMsg, problem, !!problem);
  }

  function clearPending() {
    pending = [];
    paintPending();
    setMsg(els.writeMsg, '');
  }

  async function removeFile(file, row) {
    if (busy) return;
    if (!window.confirm('"' + file.name + '" 을(를) 지울까요?')) return;

    busy = true;
    try {
      await BoardStore.deleteFile(file.id);
      row.remove();                            // 그 줄만 지웁니다
      setMsg(els.fileMsg, '');
    } catch (err) {
      setMsg(els.fileMsg, err.message, true);
    } finally {
      busy = false;
    }
  }

  /* ------------------------------------------------------------ 읽기 화면 */

  function paintPost(post, comments, files) {
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

    paintFiles(files);

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
      paintPost(data.post, data.comments, data.files || []);
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

    /* 닉네임과 비밀번호는 새 글에만 받습니다. 수정할 때는 바꾸지 않습니다.
       주인이라고 감추지 않습니다. 주인도 원하면 비밀번호를 걸 수 있고,
       비우면 '주인' 이름으로 올라갑니다. 위의 안내문이 그걸 설명합니다. */
    els.wNickField.hidden = !!post;
    els.wPassField.hidden = !!post;
    els.wOwnerNote.hidden = !cfg.owner || !!post;

    // HTML 첨부는 주인이 새 글을 쓸 때만. 이미 있는 글은 읽기 화면에서 붙입니다.
    els.wFilesField.hidden = !cfg.owner || !!post;
    pending = [];
    paintPending();

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

    // 첨부에 문제가 있으면 글도 올리지 않습니다. 글만 올라가고 첨부가 빠지는 일을 막습니다.
    const files = editingId ? [] : pending;
    const fileIssue = fileProblem(files) ||
      (files.length > fileCount() ? '글 하나에 ' + fileCount() + '개까지 붙일 수 있습니다.' : null);
    if (fileIssue) { setMsg(els.writeMsg, fileIssue, true); return; }

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

        // 글이 올라갔으니 여기서부터는 실패해도 글 화면으로 넘어갑니다.
        // 못 올린 첨부는 글 화면의 "HTML 올리기"로 다시 붙이면 됩니다.
        pending = [];
        await goToPost(created.id);
        if (files.length) {
          try {
            await uploadAll(created.id, files, addFileRow);
            setMsg(els.fileMsg, files.length + '개 올렸습니다. "보기"를 누르면 실행됩니다.');
          } catch (err) {
            setMsg(els.fileMsg, '글은 올라갔지만 첨부 중 실패했습니다: ' + err.message, true);
          }
        }
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
    return openPost(id);
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
  els.fileInput.addEventListener('change', uploadPicked);
  els.wFileInput.addEventListener('change', pickPending);
  els.wFileClear.addEventListener('click', clearPending);

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

    // 닉네임/비밀번호 칸은 주인에게도 보여 줍니다. 비우면 '주인' 이름으로 달립니다.
    els.cOwnerNote.hidden = !cfg.owner;
    els.cTurnstile.hidden = cfg.owner || !captcha.enabled();

    // 안내문의 첨부 상한을 서버 값으로 맞춥니다
    for (const el of document.querySelectorAll('.js-file-max'))   el.textContent = sizeText(fileMax());
    for (const el of document.querySelectorAll('.js-file-count')) el.textContent = String(fileCount());

    routeFromUrl();
  })();
})();
