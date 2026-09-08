/* ==========================================================================
   functions/api/board/posts/:id/comments
   POST   댓글 달기

   댓글 읽기는 글 상세(GET /api/board/posts/:id)에 같이 실려 옵니다.
   댓글 삭제는 /api/board/comments/:id 에 있습니다.
   ========================================================================== */

import { json } from '../../../../../lib/auth.js';
import {
  LIMITS, cleanText, cleanNickname, ipHashOf, honeypotFilled,
  turnstileProblem, rateProblem, makePassword, passwordProblem,
  newId, publicComment
} from '../../../../../lib/board.js';

export async function onRequestPost({ params, request, env, data }) {
  const owner = !!data.session;
  const body = await request.json().catch(() => null);

  // 1) 허니팟
  if (honeypotFilled(body)) {
    return json({ error: '댓글을 저장하지 못했습니다.' }, 400);
  }

  // 2) 사람 확인 (주인은 건너뜀)
  if (!owner) {
    const problem = await turnstileProblem(env, request, body?.turnstileToken);
    if (problem) return json({ error: problem }, 403);
  }

  // 3) 달 글이 실제로 있는지
  const post = await env.DB
    .prepare('SELECT id, commentCount FROM posts WHERE id = ?')
    .bind(params.id)
    .first();
  if (!post) return json({ error: '글을 찾을 수 없습니다.' }, 404);

  // 4) 내용 검사
  const text     = cleanText(body?.body, { multiline: true });
  const nickname = owner ? '주인' : cleanNickname(body?.nickname);

  if (!text) return json({ error: '댓글 내용을 적어 주세요.' }, 400);
  if (text.length > LIMITS.comment) {
    return json({ error: '댓글은 ' + LIMITS.comment + '자까지 쓸 수 있습니다.' }, 400);
  }

  // 5) 익명 댓글은 지울 때 쓸 비밀번호가 있어야 합니다
  let pwSalt = null;
  let pwHash = null;
  if (!owner) {
    const problem = passwordProblem(body?.password);
    if (problem) return json({ error: problem }, 400);
    const made = await makePassword(body.password);
    pwSalt = made.pwSalt;
    pwHash = made.pwHash;
  }

  // 6) 도배 제한 (주인은 건너뜀)
  const now = Date.now();
  const ipHash = await ipHashOf(env, request);
  if (!owner) {
    const problem = await rateProblem(env, ipHash, 'comment', now);
    if (problem) return json({ error: problem.error }, problem.status);
  }

  const comment = {
    id: newId(), postId: params.id, body: text, nickname,
    pwSalt, pwHash,
    isOwner: owner ? 1 : 0,
    ipHash, createdAt: now
  };

  // 댓글을 넣고 글의 댓글 수를 같이 올립니다. 한 묶음으로 처리합니다.
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO comments' +
      ' (id, postId, body, nickname, pwSalt, pwHash, isOwner, ipHash, createdAt)' +
      ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      comment.id, comment.postId, comment.body, comment.nickname,
      comment.pwSalt, comment.pwHash, comment.isOwner, comment.ipHash, comment.createdAt
    ),
    env.DB.prepare(
      'UPDATE posts SET commentCount = commentCount + 1 WHERE id = ?'
    ).bind(params.id)
  ]);

  return json(publicComment(comment), 201);
}
