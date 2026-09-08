/* 비밀번호 → 서버에 넣을 설정값.
   전부 이 브라우저 안에서 계산됩니다. 네트워크 요청이 없습니다. */

const ITERATIONS = 600000;

const $ = id => document.getElementById(id);

function bytesToHex(bytes) {
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function build(password) {
  // 무작위 salt. 같은 비밀번호라도 매번 다른 검증값이 나오게 합니다.
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const salt = bytesToHex(saltBytes);

  // 브라우저가 로그인할 때 하는 계산과 똑같이 합니다.
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: ITERATIONS, hash: 'SHA-256' },
    base, 256
  );
  const key = bytesToHex(new Uint8Array(bits));

  // 서버는 받은 key를 SHA-256 해서 이 값과 비교합니다.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const verifier = bytesToHex(new Uint8Array(digest));

  return { salt, verifier };
}

$('go').addEventListener('click', async () => {
  const pw = $('pw').value;
  const pw2 = $('pw2').value;
  const msg = $('msg');

  if (!crypto.subtle) {
    msg.textContent = '이 브라우저에서는 계산할 수 없습니다. 크롬이나 파이어폭스에서 열어보세요.';
    return;
  }
  if (pw.length < 12) {
    msg.textContent = '12자 이상으로 정하세요. 이 비밀번호 하나가 메모 전체를 지킵니다.';
    return;
  }
  if (pw !== pw2) {
    msg.textContent = '두 번 입력한 값이 다릅니다.';
    return;
  }

  msg.textContent = '';
  $('go').disabled = true;
  $('go').textContent = '계산 중… 몇 초 걸립니다';

  const { salt, verifier } = await build(pw);

  $('salt').value = salt;
  $('verifier').value = verifier;
  $('iter').value = String(ITERATIONS);
  $('out').hidden = false;

  // 화면에 비밀번호를 남기지 않습니다
  $('pw').value = '';
  $('pw2').value = '';
  $('go').disabled = false;
  $('go').textContent = '만들기';
  $('out').scrollIntoView({ behavior: 'smooth' });
});
