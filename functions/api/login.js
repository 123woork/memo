/* ==========================================================================
   functions/api/login.js
   GET    /api/login   로그인에 필요한 salt와 반복 횟수를 알려줍니다
   POST   /api/login   브라우저가 계산한 값을 검사하고 세션을 만듭니다
   DELETE /api/login   세션을 지웁니다 (잠그기)

   비밀번호 자체는 이 서버에 오지 않습니다.
   브라우저가 PBKDF2로 오래 돌려 만든 값(key)만 옵니다.
   서버는 그 값을 SHA-256 한 번 돌려 저장된 검증값과 비교합니다.

   - 서버는 비밀번호를 모릅니다
   - 환경 변수가 유출돼도 거기서 비밀번호를 되돌릴 수 없습니다
   - 무거운 계산은 브라우저가 하므로 Workers의 CPU 시간 제한에 안 걸립니다
   ========================================================================== */

import {
  json, sha256Hex, timingSafeEqual, getCookie, randomToken,
  sessionCookie, clearedCookie, findSession, sameOrigin,
  SESSION_COOKIE, SESSION_TTL
} from '../../lib/auth.js';

const MAX_FAILS  = 5;             // 이 횟수부터 잠급니다
const LOCK_BASE  = 60 * 1000;     // 첫 잠금 1분, 실패할수록 2배씩

function configError(env) {
  if (!env.DB) return 'D1 데이터베이스가 연결되지 않았습니다. 바인딩 이름을 DB로 맞추세요.';
  if (!env.MEMO_SALT || !env.MEMO_VERIFIER) {
    return 'MEMO_SALT와 MEMO_VERIFIER 환경 변수가 설정되지 않았습니다.';
  }
  return null;
}

function iterationsOf(env) {
  const n = parseInt(env.MEMO_ITERATIONS, 10);
  return Number.isFinite(n) && n >= 100000 ? n : 600000;
}

export async function onRequestGet({ env }) {
  const problem = configError(env);
  if (problem) return json({ error: problem }, 500);

  // salt는 비밀이 아닙니다. 브라우저가 같은 값으로 계산해야 하므로 공개합니다.
  return json({ salt: env.MEMO_SALT, iterations: iterationsOf(env) });
}

export async function onRequestPost({ request, env }) {
  const problem = configError(env);
  if (problem) return json({ error: problem }, 500);
  if (!sameOrigin(request)) return json({ error: '잘못된 요청입니다.' }, 403);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Date.now();

  // 잠겨 있는지 먼저 확인
  const record = await env.DB
    .prepare('SELECT fails, lockedUntil FROM login_attempts WHERE ip = ?')
    .bind(ip).first();

  if (record && record.lockedUntil > now) {
    const seconds = Math.ceil((record.lockedUntil - now) / 1000);
    return json({ error: `시도가 너무 많습니다. ${seconds}초 후에 다시 해보세요.` }, 429);
  }

  const body = await request.json().catch(() => null);
  const key  = typeof body?.key === 'string' ? body.key : '';

  const given    = await sha256Hex(key);
  const expected = env.MEMO_VERIFIER.trim().toLowerCase();

  if (!timingSafeEqual(given, expected)) {
    const fails = (record?.fails ?? 0) + 1;
    const lockedUntil = fails >= MAX_FAILS
      ? now + LOCK_BASE * Math.pow(2, Math.min(fails - MAX_FAILS, 6))   // 최대 64분
      : 0;

    await env.DB.prepare(
      `INSERT INTO login_attempts (ip, fails, lockedUntil, updatedAt)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(ip) DO UPDATE SET
         fails = excluded.fails,
         lockedUntil = excluded.lockedUntil,
         updatedAt = excluded.updatedAt`
    ).bind(ip, fails, lockedUntil, now).run();

    // 남은 횟수를 알려주지 않습니다. 공격자에게 주는 정보를 줄입니다.
    return json({ error: '비밀번호가 맞지 않습니다.' }, 401);
  }

  // 성공 — 실패 기록을 지우고 세션을 만듭니다
  await env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run();
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
