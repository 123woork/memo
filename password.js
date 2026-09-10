/* ==========================================================================
   password.js — 사이트 비밀번호 바꾸기 창
   --------------------------------------------------------------------------
   화면만 맡습니다. 계산과 서버 호출은 Auth.changePassword(auth.js)가 합니다.
   비밀번호 원문은 이 브라우저 밖으로 나가지 않습니다.

   바꾸고 나면 서버가 이 기기를 뺀 모든 세션을 끊습니다. 다른 기기는 새
   비밀번호로 다시 로그인해야 합니다.
   ========================================================================== */

const PasswordChange = (() => {
  const $ = id => document.getElementById(id);

  const dialog = $('pw-dialog');
  const msg    = $('pw-msg');
  const save   = $('pw-save');
  const cancel = $('pw-cancel');
  const inputs = {
    current: $('pw-current'),
    next:    $('pw-new'),
    again:   $('pw-new2')
  };

  const MIN_LENGTH  = 12;              // tools/hash.js 와 같은 기준
  const DEFAULT_MSG = msg.textContent;
  let working = false;

  function setMessage(text, isError) {
    msg.textContent = text;
    msg.classList.toggle('gate__msg--error', !!isError);
  }

  function setWorking(on) {
    working = on;
    for (const el of [...Object.values(inputs), save, cancel]) el.disabled = on;
    save.textContent = on ? '계산 중…' : '바꾸기';
  }

  function clearInputs() {
    for (const el of Object.values(inputs)) el.value = '';
  }

  /** 서버에 보내기 전에 걸러 낼 것. 문제가 없으면 null. */
  function problem({ current, next, again }) {
    if (!current) return '지금 비밀번호를 넣으세요.';
    if (next.length < MIN_LENGTH) return `새 비밀번호는 ${MIN_LENGTH}자 이상으로 정하세요.`;
    if (next !== again) return '새 비밀번호 두 칸이 서로 다릅니다.';
    if (next === current) return '지금과 다른 비밀번호를 정하세요.';
    return null;
  }

  async function submit() {
    if (working) return;

    const values = {
      current: inputs.current.value,
      next:    inputs.next.value,
      again:   inputs.again.value
    };
    const issue = problem(values);
    if (issue) { setMessage(issue, true); return; }

    setWorking(true);
    setMessage('계산하는 중입니다. 몇 초 걸립니다.', false);

    let expired = false;
    try {
      await Auth.changePassword(values.current, values.next);
      clearInputs();
      setMessage('바꿨습니다. 다른 기기는 새 비밀번호로 다시 로그인해야 합니다.', false);
      cancel.textContent = '닫기';
    } catch (err) {
      if (err.authRequired) expired = true;
      else setMessage(err.message, true);
    } finally {
      setWorking(false);
    }

    // 세션이 끊겼으면 잠금 화면을 거쳐 이 창을 다시 엽니다
    if (expired) {
      close();
      Auth.open(open);
    }
  }

  function open() {
    clearInputs();
    setMessage(DEFAULT_MSG, false);
    cancel.textContent = '취소';
    dialog.hidden = false;
    inputs.current.focus();
  }

  function close() {
    if (working) return;
    clearInputs();                      // 화면에 비밀번호를 남기지 않습니다
    dialog.hidden = true;
  }

  save.addEventListener('click', submit);
  cancel.addEventListener('click', close);
  dialog.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') submit();
    if (e.key === 'Escape') close();
  });

  return { open };
})();
