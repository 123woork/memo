/* ==========================================================================
   lib/board.js — 게시판 서버 공용 함수
   --------------------------------------------------------------------------
   개인 메모(memos)와는 완전히 분리돼 있습니다. 이 파일의 어떤 함수도
   memos / sessions 테이블을 읽거나 쓰지 않습니다.

   게시판은 로그인 없이 누구나 읽고 쓸 수 있는 공개 영역입니다.
   그래서 방어를 여기에 모아 뒀습니다:
     1) Turnstile   — 사람인지 확인 (Cloudflare 무료, 키가 없으면 자동 생략)
     2) 허니팟       — 사람 눈에 안 보이는 칸. 봇이 채우면 거절
     3) 도배 제한    — IP별 작성 간격과 하루 상한
     4) 길이 제한    — 제목/본문/닉네임/댓글
     5) Origin 검사  — _middleware.js 에서 이미 함
     6) 비밀번호 시도 제한 — 글/댓글 비밀번호를 5번 틀리면 잠깐 잠급니다
   내용 자체는 거르지 않습니다(필터링 없음).

   공개 범위 (posts.visibility)
     public   누구나 봅니다
     locked   목록에는 "잠긴 글"로만 뜹니다. 제목·내용·댓글·첨부는 글 비밀번호로
              열람 토큰을 받아야 보입니다. 주인(로그인)은 바로 봅니다.
     private  주인만 봅니다. 다른 사람에게는 목록에도 없고 주소로 열어도 404 입니다.
   ========================================================================== */

import {
  bytesToHex, hexToBytes, sha256Hex, timingSafeEqual, clientIp,
  getSetting, reserveAttempt, clearFailures
} from './auth.js';

/** 입력 길이 상한 */
export const LIMITS = {
  title:       120,
  body:        10000,
  nickname:    20,
  comment:     1000,
  pwMin:       4,
  pwMax:       32,
  pageSize:    30,     // 목록 한 쪽에 보여줄 글 수
  maxComments: 500,    // 글 하나에 딸린 댓글을 한 번에 내려주는 상한

  // HTML 첨부 (주인만 올릴 수 있습니다)
  fileName:     100,
  fileBytes:    500000,   // 한 파일 500KB. D1 한 칸 상한(2MB)보다 넉넉히 아래
  filesPerPost: 10
};

/** 도배 제한. 주인(로그인 상태)은 적용받지 않습니다. */
export const RATE = {
  post:    { gap: 30 * 1000, perDay: 20  },
  comment: { gap: 10 * 1000, perDay: 100 }
};

const DAY = 24 * 60 * 60 * 1000;

/* 글 비밀번호 파생 횟수.
   로그인 비밀번호(60만 회)와 달리 이건 서버에서 돌리므로 Workers의 CPU
   시간 안에 들어와야 합니다. 그래서 1만 회로 낮춥니다.
   대신 틀린 횟수를 세어 잠그므로(checkPassword) 서버에 대고 맞히기는 어렵습니다.
   화면에서도 사이트 비밀번호를 재사용하지 말라고 안내합니다. */
const PW_ITERATIONS = 10000;

/* 화면을 망가뜨릴 수 있는 "보이지 않는 글자"를 지웁니다.
   탭과 줄바꿈은 남기고 나머지 제어문자만 걷어냅니다.
   내용을 검열하는 게 아니라 저장 형태만 고르는 것입니다. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/* ---------------------------------------------------------------- 입력 정리 */

/** 제어문자를 걷어내고 줄바꿈을 통일합니다. */
export function cleanText(value, { multiline = false } = {}) {
  if (typeof value !== 'string') return '';
  let s = value.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '');
  if (multiline) {
    s = s.replace(/\n{3,}/g, '\n\n');   // 빈 줄 도배 방지
  } else {
    s = s.replace(/\n/g, ' ');
  }
  return s.trim();
}

/** 닉네임이 비면 '익명'. */
export function cleanNickname(value) {
  const s = cleanText(value).slice(0, LIMITS.nickname);
  return s || '익명';
}

/* ------------------------------------------------------------------- 신원 */

/** IP 원본은 어디에도 저장하지 않습니다.
 *  MEMO_VERIFIER 를 후추(pepper)로 섞어 해시만 남깁니다. 이 값은 서버 밖으로
 *  나가지 않으므로, DB가 통째로 유출돼도 IP를 되돌리기 어렵습니다. */
export async function ipHashOf(env, request) {
  const pepper = env.MEMO_VERIFIER || 'no-pepper';
  return sha256Hex(clientIp(request) + '|' + pepper);
}

/* --------------------------------------------------------- 글 비밀번호 */

export function randomSaltHex() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export async function derivePassword(password, saltHex) {
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations: PW_ITERATIONS, hash: 'SHA-256' },
    base, 256
  );
  return bytesToHex(new Uint8Array(bits));
}

/** 글/댓글에 적힌 비밀번호가 맞는지. 시간 차이로 새어나가지 않게 비교합니다. */
export async function passwordMatches(password, row) {
  if (!row || !row.pwSalt || !row.pwHash) return false;
  if (typeof password !== 'string' || !password) return false;
  const given = await derivePassword(password, row.pwSalt);
  return timingSafeEqual(given, row.pwHash);
}

/** 새 글/댓글에 붙일 비밀번호 재료를 만듭니다. */
export async function makePassword(password) {
  const salt = randomSaltHex();
  return { pwSalt: salt, pwHash: await derivePassword(password, salt) };
}

export function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < LIMITS.pwMin) {
    return '비밀번호를 ' + LIMITS.pwMin + '자 이상 정하세요. 글을 지울 때 필요합니다.';
  }
  if (password.length > LIMITS.pwMax) {
    return '비밀번호는 ' + LIMITS.pwMax + '자까지입니다.';
  }
  return null;
}

/** 글/댓글 비밀번호를 확인합니다. 시도를 IP 해시별로 세어, 로그인처럼
 *  5번째 시도에서 잠급니다. 잠긴 글을 서버에 대고 맞혀 보는 걸 막습니다.
 *  시도는 확인 "전에" 셉니다(lib/auth.js reserveAttempt). 동시에 여러 개를 보내도
 *  잠기기 전에 확인되는 건 5번뿐입니다.
 *  맞으면 null, 틀리거나 잠겨 있으면 { error, status }. */
export async function checkPassword(env, request, row, password) {
  const key = 'board:' + await ipHashOf(env, request);

  const locked = await reserveAttempt(env, key, Date.now());
  if (locked) return locked;

  if (await passwordMatches(password, row)) {
    await clearFailures(env, key);
    return null;
  }
  return { error: '비밀번호가 맞지 않습니다.', status: 403 };
}

/* ------------------------------------------------------------- 봇 차단 */

/** 사람 눈에는 안 보이는 칸입니다. 폼을 기계적으로 채우는 봇만 여기에 씁니다. */
export function honeypotFilled(body) {
  return typeof body?.website === 'string' && body.website.trim() !== '';
}

/** Cloudflare Turnstile 검사.
 *  TURNSTILE_SECRET 이 없으면 검사를 건너뜁니다(키를 넣기 전에도 게시판이
 *  동작하도록). 키를 넣는 순간부터 자동으로 켜집니다. */
export async function turnstileProblem(env, request, token) {
  if (!env.TURNSTILE_SECRET) return null;

  if (typeof token !== 'string' || !token) {
    return '사람 확인을 먼저 마쳐 주세요.';
  }

  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  form.append('remoteip', clientIp(request));

  try {
    const res = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      { method: 'POST', body: form }
    );
    const data = await res.json();
    if (data && data.success) return null;
  } catch {
    // Turnstile 쪽이 잠깐 죽었다고 글쓰기를 통째로 막지는 않습니다.
    // 아래 도배 제한이 여전히 막아 줍니다.
    return null;
  }

  return '사람 확인에 실패했습니다. 새로고침하고 다시 해보세요.';
}

/* ----------------------------------------------------------- 도배 제한 */

/** kind: 'post' | 'comment'
 *  통과하면 null, 막히면 { error, status } 를 돌려줍니다.
 *  통과하면 카운터를 올려 둡니다. */
export async function rateProblem(env, ipHash, kind, now) {
  const rule = RATE[kind];

  const row = await env.DB
    .prepare(
      'SELECT lastPostAt, lastCommentAt, dayStart, dayPosts, dayComments,' +
      '       strikes, blockedUntil' +
      '  FROM board_limits WHERE ipHash = ?'
    )
    .bind(ipHash)
    .first();

  if (row && row.blockedUntil > now) {
    const minutes = Math.ceil((row.blockedUntil - now) / 60000);
    return { error: '잠시 막혀 있습니다. ' + minutes + '분 후에 다시 해보세요.', status: 429 };
  }

  // 하루 창이 지났으면 카운터를 새로 시작합니다
  const fresh = !row || now - row.dayStart >= DAY;
  const dayStart    = fresh ? now : row.dayStart;
  let   dayPosts    = fresh ? 0   : row.dayPosts;
  let   dayComments = fresh ? 0   : row.dayComments;
  let   strikes     = fresh ? 0   : row.strikes;

  const lastAt = kind === 'post'
    ? (row ? row.lastPostAt : 0)
    : (row ? row.lastCommentAt : 0);
  const used = kind === 'post' ? dayPosts : dayComments;

  let problem = null;

  if (now - lastAt < rule.gap) {
    const seconds = Math.ceil((rule.gap - (now - lastAt)) / 1000);
    problem = { error: '조금 천천히 써 주세요. ' + seconds + '초 후에 가능합니다.', status: 429 };
  } else if (used >= rule.perDay) {
    problem = { error: '오늘 쓸 수 있는 만큼 다 썼습니다. 내일 다시 해주세요.', status: 429 };
  }

  if (problem) {
    // 막힌 뒤에도 계속 두드리면 점점 길게 잠급니다
    strikes += 1;
    const blockedUntil = strikes >= 5
      ? now + 10 * 60 * 1000 * Math.min(strikes - 4, 6)   // 최대 60분
      : 0;
    await saveLimits(env, ipHash, {
      lastPostAt:    row ? row.lastPostAt : 0,
      lastCommentAt: row ? row.lastCommentAt : 0,
      dayStart, dayPosts, dayComments, strikes, blockedUntil, updatedAt: now
    });
    return problem;
  }

  if (kind === 'post') dayPosts += 1; else dayComments += 1;

  await saveLimits(env, ipHash, {
    lastPostAt:    kind === 'post'    ? now : (row ? row.lastPostAt : 0),
    lastCommentAt: kind === 'comment' ? now : (row ? row.lastCommentAt : 0),
    dayStart, dayPosts, dayComments,
    strikes: 0,
    blockedUntil: 0,
    updatedAt: now
  });

  return null;
}

async function saveLimits(env, ipHash, v) {
  await env.DB.prepare(
    'INSERT INTO board_limits' +
    '  (ipHash, lastPostAt, lastCommentAt, dayStart, dayPosts, dayComments,' +
    '   strikes, blockedUntil, updatedAt)' +
    ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)' +
    ' ON CONFLICT(ipHash) DO UPDATE SET' +
    '   lastPostAt    = excluded.lastPostAt,' +
    '   lastCommentAt = excluded.lastCommentAt,' +
    '   dayStart      = excluded.dayStart,' +
    '   dayPosts      = excluded.dayPosts,' +
    '   dayComments   = excluded.dayComments,' +
    '   strikes       = excluded.strikes,' +
    '   blockedUntil  = excluded.blockedUntil,' +
    '   updatedAt     = excluded.updatedAt'
  ).bind(
    ipHash, v.lastPostAt, v.lastCommentAt, v.dayStart, v.dayPosts, v.dayComments,
    v.strikes, v.blockedUntil, v.updatedAt
  ).run();
}

/* ------------------------------------------------------------ 공개 범위 */

export const VISIBILITY = ['public', 'locked', 'private'];

/** 모르는 값은 공개로 봅니다. */
export function cleanVisibility(value) {
  return VISIBILITY.includes(value) ? value : 'public';
}

/** 이 공개 범위를 이 글에 걸 수 있는지. 문제 없으면 null.
 *    비공개  주인만 걸 수 있습니다 (주인만 보는 글이므로)
 *    잠금    글 비밀번호가 있어야 합니다 (그 비밀번호로 여는 글이므로) */
export function visibilityProblem(visibility, { owner, hasPassword }) {
  if (visibility === 'private' && !owner) {
    return { error: '비공개 글은 주인만 쓸 수 있습니다.', status: 403 };
  }
  if (visibility === 'locked' && !hasPassword) {
    return {
      error: '잠긴 글은 글 비밀번호로 엽니다. 비밀번호를 정하세요. ' +
             '(주인만 보려면 "비공개"를 고르세요)',
      status: 400
    };
  }
  return null;
}

/** 이 사람에게 이 글을 "없는 글"로 다뤄야 하는지. 없는 글이거나 남의 비공개 글. */
export function hiddenFrom(post, owner) {
  return !post || (post.visibility === 'private' && !owner);
}

/* ---------------------------------------------------- 잠긴 글 열람 토큰 */

/* 글 비밀번호를 맞히면 그 글 하나를 잠깐 볼 수 있는 토큰을 줍니다.
     모양   <글 id>.<만료 시각>.<서명>
     서명   HMAC-SHA256(tokenSecret, "<글 id>.<만료 시각>")
   tokenSecret 은 D1 site_settings 에 있는 무작위 값이고 서버 밖으로 나가지
   않습니다(lib/schema.js 가 처음 한 번 만듭니다). 그래서 토큰을 위조할 수 없고,
   다른 글에 쓰거나 만료 뒤에 쓰면 거절됩니다.

   토큰은 글 상세(X-Post-Token 헤더), 댓글 달기(같은 헤더), 첨부 보기(?t=)에
   씁니다. 첨부는 iframe 주소라 헤더를 붙일 수 없어서 주소에 싣습니다. */
const TOKEN_TTL = 2 * 60 * 60 * 1000;   // 2시간

async function sign(env, text) {
  const secret = await getSetting(env, 'tokenSecret');
  if (!secret) throw new Error('tokenSecret 이 없습니다 (lib/schema.js 확인)');

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return bytesToHex(new Uint8Array(mac));
}

export async function issueAccessToken(env, postId, now = Date.now()) {
  const expiresAt = now + TOKEN_TTL;
  const payload = postId + '.' + expiresAt;
  return { token: payload + '.' + await sign(env, payload), expiresAt };
}

export async function accessTokenValid(env, token, postId, now = Date.now()) {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const [id, expiresAt, mac] = parts;
  if (id !== postId || !(Number(expiresAt) > now)) return false;
  return timingSafeEqual(mac, await sign(env, id + '.' + expiresAt));
}

/** 요청에 실린 열람 토큰. 헤더를 먼저 보고, 없으면 주소의 ?t= 를 봅니다. */
export function accessTokenOf(request) {
  return request.headers.get('X-Post-Token') ||
         new URL(request.url).searchParams.get('t') || '';
}

/** 이 요청이 글을 어디까지 볼 수 있는지.
 *    'full'    내용·댓글·첨부까지
 *    'locked'  잠긴 글. 있다는 것과 작성자·날짜만 보임
 *    'hidden'  없는 글처럼 다룸 (남의 비공개 글) */
export async function accessOf(env, post, { owner, token }) {
  const visibility = post.visibility || 'public';
  if (owner || visibility === 'public') return 'full';
  if (visibility === 'private') return 'hidden';
  return (await accessTokenValid(env, token, post.id)) ? 'full' : 'locked';
}

/* ------------------------------------------- 글/댓글이 같이 쓰는 관문 */

/** 봇 검사: 허니팟 → 사람 확인(주인은 건너뜀).
 *  막히면 { error, status }, 통과하면 null. */
export async function botProblem(env, request, body, owner, failMessage) {
  if (honeypotFilled(body)) return { error: failMessage, status: 400 };

  if (!owner) {
    const problem = await turnstileProblem(env, request, body?.turnstileToken);
    if (problem) return { error: problem, status: 403 };
  }
  return null;
}

/** 누구 이름으로, 어떤 비밀번호로 올릴지 정합니다.
 *
 *    주인 + 비밀번호 비움  →  '주인' 이름, 비밀번호 없음
 *    그 밖 (익명, 또는 비밀번호를 적은 주인)  →  적은 닉네임 + 글 비밀번호 필수
 *
 *  주인이라도 비밀번호를 적었으면 보통 글로 올립니다. 주인 이름표를 강제하지
 *  않으려는 것이고, 권한이 줄지도 않습니다(주인은 세션으로 어떤 글이든 지웁니다).
 *
 *  문제가 있으면 { error }, 아니면 DB 에 그대로 넣을 { nickname, isOwner, pwSalt, pwHash }. */
export async function authorOf(body, owner) {
  const wantsPassword = typeof body?.password === 'string' && body.password !== '';

  if (owner && !wantsPassword) {
    return { nickname: '주인', isOwner: 1, pwSalt: null, pwHash: null };
  }

  const problem = passwordProblem(body?.password);
  if (problem) return { error: problem };

  return {
    nickname: cleanNickname(body?.nickname),
    isOwner: 0,
    ...(await makePassword(body.password))
  };
}

/** 글/댓글을 고치거나 지울 자격. 주인 세션이 있거나 비밀번호가 맞으면 됩니다.
 *  문제 없으면 null, 아니면 { error, status }. */
export async function modifyProblem(env, request, row, body, owner) {
  if (owner) return null;
  return checkPassword(env, request, row, body?.password);
}

/* ------------------------------------------------------ 화면으로 내보낼 모양 */

/** 잠긴 글을 열지 못한 사람에게 보이는 제목 */
export const LOCKED_TITLE = '잠긴 글';

/** 화면으로 내보낼 글 모양.
 *  pwSalt / pwHash / ipHash 는 어떤 경우에도 내보내지 않습니다.
 *  locked 이면 제목을 가리고 본문을 싣지 않습니다. */
export function publicPost(row, { withBody = false, locked = false } = {}) {
  const out = {
    id:           row.id,
    title:        locked ? LOCKED_TITLE : row.title,
    nickname:     row.nickname,
    isOwner:      !!row.isOwner,
    hasPassword:  !!row.pwHash,
    commentCount: row.commentCount || 0,
    visibility:   row.visibility || 'public',
    createdAt:    row.createdAt,
    updatedAt:    row.updatedAt
  };
  if (withBody && !locked) out.body = row.body;
  return out;
}

/** 첨부 파일 목록에 쓸 모양. 본문(html)은 여기에 담지 않습니다.
 *  내용은 /api/board/files/:id/raw 로만 나가고, 그 응답은 격리된 출처입니다. */
export function publicFile(row) {
  return {
    id:        row.id,
    postId:    row.postId,
    name:      row.name,
    size:      row.size,
    createdAt: row.createdAt
  };
}

/** 올라온 파일 이름을 안전한 형태로 다듬습니다.
 *  경로 조각(/ \ ..)을 떼어내는 이유는, 이름이 화면과 내려받기 이름에만 쓰이더라도
 *  '../' 같은 게 섞여 들어오는 걸 애초에 막아 두기 위해서입니다. */
export function cleanFileName(value) {
  let s = cleanText(value);
  s = s.split(/[\\/]/).pop() || '';
  s = s.replace(/^\.+/, '').slice(0, LIMITS.fileName).trim();
  if (!s) s = 'page.html';
  if (!/\.html?$/i.test(s)) s += '.html';
  return s;
}

export function publicComment(row) {
  return {
    id:          row.id,
    postId:      row.postId,
    body:        row.body,
    nickname:    row.nickname,
    isOwner:     !!row.isOwner,
    hasPassword: !!row.pwHash,
    createdAt:   row.createdAt
  };
}
