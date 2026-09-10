/* ==========================================================================
   functions/api/board/posts/:id/comments
   POST   댓글 달기

   댓글 읽기는 글 상세(GET /api/board/posts/:id)에 같이 실려 옵니다.
   댓글 삭제는 /api/board/comments/:id 에 있습니다.
   관문은 새 글(posts.js)과 같습니다.
   ========================================================================== */

import { json, readJson, newId, insertStatement } from '../../../../../lib/auth.js';
import {
  LIMITS, cleanText, ipHashOf, botProblem, authorOf, rateProblem, publicComment
} from '../../../../../lib/board.js';

export async function onRequestPost({ params, request, env, data }) {
  const owner = !!data.session;
  const body = await readJson(request);

  // 1) 봇 검사
  const bot = await botProblem(env, request, body, owner, '댓글을 저장하지 못했습니다.');
  if (bot) return json({ error: bot.error }, bot.status);

  // 2) 달 글이 실제로 있는지
  const post = await env.DB
    .prepare('SELECT id FROM posts WHERE id = ?')
    .bind(params.id)
    .first();
  if (!post) return json({ error: '글을 찾을 수 없습니다.' }, 404);

  // 3) 내용 검사
  const text = cleanText(body?.body, { multiline: true });

  if (!text) return json({ error: '댓글 내용을 적어 주세요.' }, 400);
  if (text.length > LIMITS.comment) {
    return json({ error: '댓글은 ' + LIMITS.comment + '자까지 쓸 수 있습니다.' }, 400);
  }

  // 4) 누구 이름으로 달지 (글과 같은 규칙)
  const author = await authorOf(body, owner);
  if (author.error) return json({ error: author.error }, 400);

  // 5) 도배 제한 (주인은 건너뜀)
  const now = Date.now();
  const ipHash = await ipHashOf(env, request);
  if (!owner) {
    const limited = await rateProblem(env, ipHash, 'comment', now);
    if (limited) return json({ error: limited.error }, limited.status);
  }

  const comment = {
    id: newId(), postId: params.id, body: text,
    ...author,                         // nickname, isOwner, pwSalt, pwHash
    ipHash, createdAt: now
  };

  // 댓글을 넣고 글의 댓글 수를 같이 올립니다. 한 묶음으로 처리합니다.
  await env.DB.batch([
    insertStatement(env.DB, 'comments', comment),
    env.DB.prepare('UPDATE posts SET commentCount = commentCount + 1 WHERE id = ?')
      .bind(params.id)
  ]);

  return json(publicComment(comment), 201);
}
