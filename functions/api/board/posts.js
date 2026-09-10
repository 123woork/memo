/* ==========================================================================
   functions/api/board/posts.js
   GET  /api/board/posts?page=1   글 목록 (최신순, 쪽 나눔)
   POST /api/board/posts          새 글

   여기는 공개 영역입니다. _middleware.js 가 세션을 요구하지 않습니다.
   대신 글쓰기에는 아래 관문을 차례로 통과해야 합니다.
     봇 검사(허니팟, 사람 확인) → 길이 검사 → 작성자/비밀번호 → 도배 제한
   주인(로그인 상태)은 사람 확인과 도배 제한을 건너뜁니다.
   ========================================================================== */

import { json, readJson, newId, insertStatement } from '../../../lib/auth.js';
import {
  LIMITS, cleanText, ipHashOf, botProblem, authorOf, rateProblem, publicPost
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
  const body = await readJson(request);

  // 1) 봇 검사
  const bot = await botProblem(env, request, body, owner, '글을 저장하지 못했습니다.');
  if (bot) return json({ error: bot.error }, bot.status);

  // 2) 내용 검사
  const title = cleanText(body?.title).slice(0, LIMITS.title);
  const text  = cleanText(body?.body, { multiline: true });

  if (!title) return json({ error: '제목을 적어 주세요.' }, 400);
  if (!text)  return json({ error: '내용을 적어 주세요.' }, 400);
  if (text.length > LIMITS.body) {
    return json({ error: '내용은 ' + LIMITS.body + '자까지 쓸 수 있습니다.' }, 400);
  }

  // 3) 누구 이름으로 올릴지. 주인 이름이 아니면 지울 때 쓸 비밀번호가 있어야 합니다.
  const author = await authorOf(body, owner);
  if (author.error) return json({ error: author.error }, 400);

  // 4) 도배 제한 (주인은 건너뜀). 마지막에 두어 헛되이 카운터를 쓰지 않습니다.
  const now = Date.now();
  const ipHash = await ipHashOf(env, request);
  if (!owner) {
    const limited = await rateProblem(env, ipHash, 'post', now);
    if (limited) return json({ error: limited.error }, limited.status);
  }

  const post = {
    id: newId(), title, body: text,
    ...author,                         // nickname, isOwner, pwSalt, pwHash
    ipHash, commentCount: 0,
    createdAt: now, updatedAt: now
  };

  await insertStatement(env.DB, 'posts', post).run();

  return json(publicPost(post, { withBody: true }), 201);
}
