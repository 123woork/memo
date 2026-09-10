/* ==========================================================================
   functions/api/board/comments/:id
   DELETE   댓글 삭제

   글과 같은 규칙입니다. 댓글 쓸 때 정한 비밀번호를 맞히거나(틀린 횟수를 세어
   잠급니다), 사이트 주인으로 로그인해 있으면 지울 수 있습니다.
   비공개 글에 달린 댓글은 주인 말고는 "없는 댓글"입니다.
   ========================================================================== */

import { json, readJson } from '../../../../lib/auth.js';
import { modifyProblem } from '../../../../lib/board.js';

const NOT_FOUND = '댓글을 찾을 수 없습니다.';

export async function onRequestDelete({ params, request, env, data }) {
  const owner = !!data.session;
  const body = await readJson(request);

  const comment = await env.DB
    .prepare(
      'SELECT c.id, c.postId, c.pwSalt, c.pwHash, p.visibility' +
      '  FROM comments c LEFT JOIN posts p ON p.id = c.postId' +
      ' WHERE c.id = ?'
    )
    .bind(params.id)
    .first();

  if (!comment) return json({ error: NOT_FOUND }, 404);
  if (comment.visibility === 'private' && !owner) return json({ error: NOT_FOUND }, 404);

  const denied = await modifyProblem(env, request, comment, body, owner);
  if (denied) return json({ error: denied.error }, denied.status);

  // 댓글을 지우고 글의 댓글 수를 같이 내립니다.
  // 0 밑으로 내려가지 않게 막아 둡니다.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(params.id),
    env.DB.prepare(
      'UPDATE posts SET commentCount = MAX(commentCount - 1, 0) WHERE id = ?'
    ).bind(comment.postId)
  ]);

  return json({ ok: true });
}
