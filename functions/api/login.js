/* ==========================================================================
   functions/api/login.js
   GET    /api/login   로그인에 필요한 salt와 반복 횟수를 알려줍니다
   POST   /api/login   브라우저가 계산한 값을 검사하고 세션을 만듭니다
   DELETE /api/login   세션을 지웁니다 (잠그기)

   비밀번호 자체는 이 서버에 오지 않습니다.
   브라우저가 PBKDF2로 오래 돌려 만든 값(key)만 옵니다.
   서버는 그 값을 SHA-256 한 번 돌려 저장된 검증값과 비교합니다.

   - 서버는 비밀번호를 모릅니다
   - 검증값이 유출돼도 거기서 비밀번호를 되돌릴 수 없습니다
   - 무거운 계산은 브라우저가 하므로 Workers의 CPU 시간 제한에 안 걸립니다

   검증값은 사이트에서 비밀번호를 바꾼 적이 있으면 D1 값을, 아니면 환경
   변수 값을 씁니다 (lib/auth.js siteAuth, functions/api/password.js).
   ========================================================================== */

import {
  json, readJson, clientIp, sha256Hex, timingSafeEqual, getCookie, randomToken,
  sessionCookie, clearedCookie, findSession, sameOrigin, siteAuth,
  reserveAttempt, clearFailures,
  SESSION_COOKIE, SESSION_TTL
} from '../../lib/auth.js';

const NO_DB = 'D1 데이터베이스가 연결되지 않았습니다. 바인딩 이름을 DB로 맞추세요.';
const NOT_CONFIGURED = 'MEMO_SALT와 MEMO_VERIFIER 환경 변수가 설정되지 않았습니다.';

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ error: NO_DB }, 500);
  const auth = await siteAuth(env);
  if (!auth) return json({ error: NOT_CONFIGURED }, 500);

  // salt는 비밀이 아닙니다. 브라우저가 같은 값으로 계산해야 하므로 공개합니다.
  return json({ salt: auth.salt, iterations: auth.iterations });
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: NO_DB }, 500);
  const auth = await siteAuth(env);
  if (!auth) return json({ error: NOT_CONFIGURED }, 500);
  if (!sameOrigin(request)) return json({ error: '잘못된 요청입니다.' }, 403);

  const ip = clientIp(request);
  const now = Date.now();

  // 확인하기 전에 시도를 먼저 셉니다. 잠겨 있으면 여기서 끝납니다.
  const locked = await reserveAttempt(env, ip, now);
  if (locked) return json({ error: locked.error }, locked.status);

  const body = await readJson(request);
  const key  = typeof body?.key === 'string' ? body.key : '';

  if (!timingSafeEqual(await sha256Hex(key), auth.verifier)) {
    // 남은 횟수를 알려주지 않습니다. 공격자에게 주는 정보를 줄입니다.
    return json({ error: '비밀번호가 맞지 않습니다.' }, 401);
  }

  // 성공 — 실패 기록을 지우고 세션을 만듭니다
  await clearFailures(env, ip);
  await env.DB.prepare('DELETE FROM sessions WHERE expiresAt <= ?').bind(now).run();

  const token = randomToken();
  await env.DB.prepare(
    'INSERT INTO sessions (tokenHash, createdAt, expiresAt) VALUES (?, ?, ?)'
  ).bind(await sha256Hex(token), now, now + SESSION_TTL).run();

  return json({ ok: true }, 200, {
    'Set-Cookie': sessionCookie(token, Math.floor(SESSION_TTL / 1000))
  });
}

export async function onRequestDelete({ request, env }) {
  if (!env.DB) return json({ error: 'D1이 연결되지 않았습니다.' }, 500);
  if (!sameOrigin(request)) return json({ error: '잘못된 요청입니다.' }, 403);

  const token = getCookie(request, SESSION_COOKIE);
  if (token) {
    const session = await findSession(env, token);
    if (session) {
      await env.DB.prepare('DELETE FROM sessions WHERE tokenHash = ?')
        .bind(session.tokenHash).run();
    }
  }

  return json({ ok: true }, 200, { 'Set-Cookie': clearedCookie });
}
