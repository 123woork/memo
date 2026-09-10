/* ==========================================================================
   lib/auth.js — 서버 쪽 공용 함수들
   --------------------------------------------------------------------------
   비밀은 하나도 들어 있지 않습니다. 실제 비밀(MEMO_SALT, MEMO_VERIFIER,
   사이트에서 바꾼 비밀번호의 검증값)은 Cloudflare 환경 변수와 D1 에만 있고,
   이 파일은 그걸 다루는 방법만 담습니다. 그래서 이 파일이 공개돼도 안전합니다.
   ========================================================================== */

export const SESSION_COOKIE = 'memo_session';
export const SESSION_TTL    = 30 * 24 * 60 * 60 * 1000;   // 30일

/** 사이트 비밀번호 PBKDF2 반복 횟수의 하한과 기본값 */
export const MIN_ITERATIONS     = 100000;
export const DEFAULT_ITERATIONS = 600000;

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

/** 요청 본문을 JSON 으로 읽습니다. 비었거나 깨졌으면 null 을 돌려줍니다. */
export function readJson(request) {
  return request.json().catch(() => null);
}

/** 요청한 사람의 IP. Cloudflare 가 붙여 주는 헤더에서 읽습니다. */
export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

export function bytesToHex(bytes) {
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
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

/** 추측할 수 없는 무작위 값 (256비트, hex 64자). 세션 토큰 등에 씁니다. */
export function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

/** 메모·글·댓글·첨부의 id. 앞은 만든 시각이라 대략 시간순으로 정렬되고,
 *  뒤는 무작위라 같은 순간에 만들어도 겹치지 않습니다. */
export function newId() {
  return Date.now().toString(36) + '-' + crypto.randomUUID().slice(0, 8);
}

/** row 의 키를 열 이름으로 쓰는 INSERT 문을 만듭니다. 실행은 부르는 쪽이
 *  .run() 하거나 batch 에 넣습니다.
 *  열 이름은 코드에 적힌 객체 키에서만 오고, 값은 전부 ? 자리로 묶이므로
 *  사용자 입력이 SQL 문장에 섞이지 않습니다. */
export function insertStatement(db, table, row) {
  const columns = Object.keys(row);
  const slots = columns.map(() => '?').join(', ');
  return db
    .prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${slots})`)
    .bind(...Object.values(row));
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

/** 쿠키의 세션이 살아 있는지 확인합니다. 살아 있으면 { tokenHash, expiresAt } 를 돌려줍니다. */
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

/* ---------------------------------------------- 사이트 설정 (site_settings) */

/** site_settings 표에서 값 하나를 읽습니다. 없으면 null.
 *  오류는 삼키지 않습니다. D1 이 잠깐 죽었을 때 옛 비밀번호(환경 변수)로
 *  조용히 돌아가면 안 되기 때문입니다. */
export async function getSetting(env, key) {
  const row = await env.DB
    .prepare('SELECT value FROM site_settings WHERE key = ?')
    .bind(key)
    .first();
  return row ? row.value : null;
}

/** site_settings 에 값 하나를 넣거나 바꾸는 문장. .run() 하거나 batch 에 넣습니다. */
export function settingStatement(env, key, value) {
  return env.DB
    .prepare(
      'INSERT INTO site_settings (key, value, updatedAt) VALUES (?, ?, ?)' +
      ' ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt'
    )
    .bind(key, value, Date.now());
}

export function cleanIterations(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= MIN_ITERATIONS ? n : DEFAULT_ITERATIONS;
}

/** 사이트 비밀번호를 검사할 재료 { salt, verifier, iterations }.
 *
 *    사이트에서 비밀번호를 바꾼 적이 있으면  D1 site_settings 'auth' 값
 *    아니면                                환경 변수 MEMO_SALT / MEMO_VERIFIER / MEMO_ITERATIONS
 *
 *  둘 다 없으면 null. 비밀번호를 잊었으면 D1 콘솔에서 'auth' 줄을 지우면
 *  환경 변수 쪽 비밀번호로 돌아갑니다. */
export async function siteAuth(env) {
  const saved = await getSetting(env, 'auth');
  if (saved) {
    const a = JSON.parse(saved);
    return { salt: a.salt, verifier: a.verifier, iterations: cleanIterations(a.iterations) };
  }

  if (!env.MEMO_SALT || !env.MEMO_VERIFIER) return null;
  return {
    salt: env.MEMO_SALT,
    verifier: env.MEMO_VERIFIER.trim().toLowerCase(),
    iterations: cleanIterations(env.MEMO_ITERATIONS)
  };
}

/* ------------------------------------------------ 비밀번호 시도 제한 */

/* login_attempts 표에 key 별로 시도 횟수를 셉니다.
     로그인, 사이트 비밀번호 바꾸기   key = IP 원문 (처음부터 쓰던 방식)
     게시판 글·댓글 비밀번호          key = 'board:' + IP 해시 (lib/board.js)
   MAX_FAILS 번째 시도에서 1분 잠금이 걸리고, 잠금이 풀린 뒤 또 틀릴 때마다
   2배씩 최대 64분까지 늘어납니다. 맞히면 기록이 지워집니다(clearFailures).

   시도는 비밀번호를 확인하기 "전에" 한 문장으로 셉니다(reserveAttempt).
   "읽고 → 확인하고 → 나중에 쓰기"로 하면, 요청을 한꺼번에 여러 개 보낸 사람은
   모두 "0번 틀림"을 읽고 지나가 잠금이 영영 안 걸립니다. 세는 순간 잠금까지
   같이 정하므로, 동시에 몇 개를 보내도 잠기기 전에 확인되는 건 MAX_FAILS 번뿐입니다. */
const MAX_FAILS = 5;
const LOCK_BASE = 60 * 1000;

/** 비밀번호 확인 한 번을 셉니다.
 *  잠겨 있으면 세지 않고 { error, status: 429 }, 아니면 null (이 시도는 이미 셌습니다).
 *  확인에 성공하면 clearFailures 로 기록을 지우세요. 틀렸으면 더 할 일이 없습니다. */
export async function reserveAttempt(env, key, now) {
  // 잠겨 있지 않을 때만(WHERE) 하나 올리고, 올린 횟수가 MAX_FAILS 이상이면 바로 잠급니다.
  // SET 의 fails 는 올리기 전 값입니다 (SQLite 규칙).
  const counted = await env.DB.prepare(
    `INSERT INTO login_attempts (ip, fails, lockedUntil, updatedAt)
     VALUES (?1, 1, 0, ?2)
     ON CONFLICT(ip) DO UPDATE SET
       fails       = fails + 1,
       lockedUntil = CASE WHEN fails + 1 >= ?3
                          THEN ?2 + ?4 * (1 << MIN(fails + 1 - ?3, 6))
                          ELSE 0 END,
       updatedAt   = ?2
     WHERE login_attempts.lockedUntil <= ?2
     RETURNING fails`
  ).bind(key, now, MAX_FAILS, LOCK_BASE).first();

  if (counted) return null;

  const row = await env.DB
    .prepare('SELECT lockedUntil FROM login_attempts WHERE ip = ?')
    .bind(key)
    .first();
  const seconds = Math.max(1, Math.ceil(((row?.lockedUntil ?? now) - now) / 1000));
  return { error: `시도가 너무 많습니다. ${seconds}초 후에 다시 해보세요.`, status: 429 };
}

export async function clearFailures(env, key) {
  await env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(key).run();
}
