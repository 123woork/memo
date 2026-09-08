/* ==========================================================================
   lib/auth.js — 서버 쪽 공용 함수들
   --------------------------------------------------------------------------
   비밀은 하나도 들어 있지 않습니다. 실제 비밀(MEMO_SALT, MEMO_VERIFIER)은
   Cloudflare 환경 변수에만 있고, 이 파일은 그걸 다루는 방법만 담습니다.
   그래서 이 파일이 공개돼도 안전합니다.
   ========================================================================== */

export const SESSION_COOKIE = 'memo_session';
export const SESSION_TTL    = 30 * 24 * 60 * 60 * 1000;   // 30일

export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders
    }
  });
}

export function bytesToHex(bytes) {
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return bytesToHex(new Uint8Array(digest));
}

/** 길이가 같은 두 문자열을 시간 차이 없이 비교합니다.
 *  보통의 === 는 앞부분이 맞을수록 오래 걸려서, 그 시간차로 정답을
 *  한 글자씩 알아내는 공격(타이밍 공격)이 가능합니다. */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function getCookie(request, name) {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const c = part.trim();
    if (c.startsWith(name + '=')) return c.slice(name.length + 1);
  }
  return null;
}

/** 추측할 수 없는 세션 토큰 (256비트) */
export function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export function sessionCookie(token, maxAgeSeconds) {
  // HttpOnly  : 자바스크립트가 못 읽습니다 (XSS로 훔쳐갈 수 없음)
  // Secure    : HTTPS로만 전송됩니다
  // SameSite=Strict : 다른 사이트에서 온 요청에는 안 붙습니다 (CSRF 차단)
  return [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`
  ].join('; ');
}

export const clearedCookie = sessionCookie('', 0);

/** 쿠키의 세션이 살아 있는지 확인합니다. 살아 있으면 만료 시각을 돌려줍니다. */
export async function findSession(env, token) {
  if (!token || token.length !== 64) return null;
  const hash = await sha256Hex(token);
  const row = await env.DB
    .prepare('SELECT tokenHash, expiresAt FROM sessions WHERE tokenHash = ?')
    .bind(hash)
    .first();
  if (!row || row.expiresAt <= Date.now()) return null;
  return row;
}

/** 상태를 바꾸는 요청이 우리 사이트에서 온 게 맞는지 확인합니다.
 *  SameSite 쿠키만으로도 대부분 막히지만, 한 겹 더 둡니다. */
export function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;              // 같은 사이트 요청은 Origin이 없을 수 있습니다
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}
