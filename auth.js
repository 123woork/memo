/* ==========================================================================
   auth.js — 잠금 화면과 로그인 처리
   --------------------------------------------------------------------------
   비밀번호는 이 파일 밖으로 나가지 않습니다.
   PBKDF2를 60만 번 돌려 만든 값만 서버로 보냅니다.

   왜 브라우저에서 돌리나:
   느린 해싱은 비밀번호 보안의 핵심인데, Cloudflare Workers는 요청당 CPU
   시간이 짧아서 서버에서 돌리면 시간 초과가 납니다. 그래서 계산은 여기서
   하고, 서버는 그 결과만 빠르게 대조합니다.
   비밀번호가 네트워크를 안 탄다는 이점도 같이 얻습니다.
   ========================================================================== */

const Auth = (() => {
  const gate  = document.getElementById('gate');
  const input = document.getElementById('gate-input');
  const btn   = document.getElementById('gate-btn');
  const msg   = document.getElementById('gate-msg');

  const DEFAULT_MSG = '비밀번호를 입력하세요.';
  let onUnlock = null;
  let working = false;

  function hexToBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  function bytesToHex(bytes) {
    return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /** 비밀번호를 서버로 보낼 값으로 바꿉니다. 되돌릴 수 없습니다. */
  async function derive(password, saltHex, iterations) {
    const base = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations, hash: 'SHA-256' },
      base, 256
    );
    return bytesToHex(new Uint8Array(bits));
  }

  async function post(url, options) {
    const res = await fetch(url, { credentials: 'same-origin', ...options });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error || `오류 ${res.status}`);
    return body;
  }

  function setMessage(text, isError) {
    msg.textContent = text;
    msg.classList.toggle('gate__msg--error', !!isError);
  }

  function setWorking(on) {
    working = on;
    btn.disabled = on;
    input.disabled = on;
    btn.textContent = on ? '확인 중…' : '열기';
  }

  async function attempt() {
    if (working) return;
    const password = input.value;
    if (!password) { input.focus(); return; }

    setWorking(true);
    setMessage('확인하는 중입니다. 몇 초 걸립니다.', false);

    try {
      const { salt, iterations } = await post('/api/login', { method: 'GET' });
      const key = await derive(password, salt, iterations);

      await post('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key })
      });

      input.value = '';                 // 화면에도 남기지 않습니다
      setMessage(DEFAULT_MSG, false);
      gate.hidden = true;
      setWorking(false);

      const cb = onUnlock;
      onUnlock = null;
      if (cb) cb();
    } catch (err) {
      setWorking(false);
      setMessage(err.message, true);
      input.select();
    }
  }

  btn.addEventListener('click', attempt);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') attempt(); });

  return {
    /** 잠금 화면을 띄우고, 풀리면 콜백을 부릅니다 */
    open(callback) {
      onUnlock = callback;
      gate.hidden = false;
      setMessage(DEFAULT_MSG, false);
      input.value = '';
      input.focus();
    },

    async logout() {
      try {
        await fetch('/api/login', { method: 'DELETE', credentials: 'same-origin' });
      } finally {
        location.reload();
      }
    }
  };
})();
