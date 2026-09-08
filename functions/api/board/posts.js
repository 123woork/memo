/* ==========================================================================
   functions/api/board/posts.js
   GET  /api/board/posts?page=1   글 목록 (최신순, 쪽 나눔)
   POST /api/board/posts          새 글

   여기는 공개 영역입니다. _middleware.js 가 세션을 요구하지 않습니다.
   대신 글쓰기에는 아래 관문을 차례로 통과해야 합니다.
     허니팟 → Turnstile → 도배 제한 → 길이 검사
   주인(로그인 상태)은 Turnstile 과 도배 제한을 건너뜁니다.
   ========================================================================== */

import { json } from '../../../lib/auth.js';
import {
  LIMITS, cleanText, cleanNickname, ipHashOf, honeypotFilled,
  turnstileProblem, rateProblem, makePassword, passwordProblem,
  newId, publicPost
} from '../../../lib/board.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
  const offset = (page - 1) * LIMITS.pageSize;

  const counted = await env.DB
    .prepare('SELECT COUNT(*) AS n FROM posts')
    .first();
  const total = counted ? counted.n : 0;

  const { results } = await env.DB
    .prepare(
      'SELECT id, title, nickname, isOwner, pwHash, commentCount, createdAt, updatedAt' +
      '  FROM posts ORDER BY createdAt DESC LIMIT ? OFFSET ?'
    )
    .bind(LIMITS.pageSize, offset)
    .all();

  return json({
    posts: (results || []).map(row => publicPost(row)),
    page,
    pageSize: LIMITS.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / LIMITS.pageSize))
  });
}

export async function onRequestPost({ request, env, data }) {
  const owner = !!data.session;
  const body = await request.json().catch(() => null);

  // 1) 허니팟 — 사람 눈에 안 보이는 칸이 채워져 있으면 봇입니다
  if (honeypotFilled(body)) {
    return json({ error: '글을 저장하지 못했습니다.' }, 400);
  }

  // 2) 사람 확인 (주인은 건너뜀)
  if (!owner) {
    const problem = await turnstileProblem(env, request, body?.turnstileToken);
    if (problem) return json({ error: problem }, 403);
  }

  /* 주인이라도 비밀번호를 적었으면 보통 글로 올립니다.
     주인 이름표를 강제하지 않으려는 것이고, 권한이 줄지도 않습니다.
     주인은 자기 세션으로 어떤 글이든 지울 수 있기 때문입니다.
     비워 두면 '주인' 이름으로, 비밀번호 없이 올라갑니다. */
  const wantsPassword = typeof body?.password === 'string' && body.password !== '';
  const asOwner = owner && !wantsPassword;

  // 3) 내용 검사
  const title    = cleanText(body?.title).slice(0, LIMITS.title);
  const text     = cleanText(body?.body, { multiline: true });
  const nickname = asOwner ? '주인' : cleanNickname(body?.nickname);

  if (!title) return json({ error: '제목을 적어 주세요.' }, 400);
  if (!text)  return json({ error: '내용을 적어 주세요.' }, 400);
  if (text.length > LIMITS.body) {
    return json({ error: '내용은 ' + LIMITS.body + '자까지 쓸 수 있습니다.' }, 400);
  }

  // 4) 주인 이름으로 올리는 게 아니면 지울 때 쓸 비밀번호가 있어야 합니다
  let pwSalt = null;
  let pwHash = null;
  if (!asOwner) {
    const problem = passwordProblem(body?.password);
    if (problem) return json({ error: problem }, 400);
    const made = await makePassword(body.password);
    pwSalt = made.pwSalt;
    pwHash = made.pwHash;
  }

  // 5) 도배 제한 (주인은 건너뜀). 마지막에 두어 헛되이 카운터를 쓰지 않습니다.
  const now = Date.now();
  const ipHash = await ipHashOf(env, request);
  if (!owner) {
    const problem = await rateProblem(env, ipHash, 'post', now);
    if (problem) return json({ error: problem.error }, problem.status);
  }

  const post = {
    id: newId(), title, body: text, nickname,
    pwSalt, pwHash,
    isOwner: asOwner ? 1 : 0,
    ipHash, commentCount: 0,
    createdAt: now, updatedAt: now
  };

  await env.DB.prepare(
    'INSERT INTO posts' +
    ' (id, title, body, nickname, pwSalt, pwHash, isOwner, ipHash,' +
    '  commentCount, createdAt, updatedAt)' +
    ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    post.id, post.title, post.body, post.nickname, post.pwSalt, post.pwHash,
    post.isOwner, post.ipHash, post.commentCount, post.createdAt, post.updatedAt
  ).run();

  return json(publicPost(post, { withBody: true }), 201);
}
