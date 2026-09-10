/* ==========================================================================
   functions/api/board/comments/:id
   DELETE   댓글 삭제

   글과 같은 규칙입니다. 댓글 쓸 때 정한 비밀번호를 맞히거나,
   사이트 주인으로 로그인해 있으면 지울 수 있습니다.
   ========================================================================== */

import { json, readJson } from '../../../../lib/auth.js';
import { mayModify } from '../../../../lib/board.js';

export async function onRequestDelete({ params, request, env, data }) {
  const body = await readJson(request);

  const comment = await env.DB
    .prepare('SELECT id, postId, pwSalt, pwHash FROM comments WHERE id = ?')
    .bind(params.id)
    .first();

  if (!comment) return json({ error: '댓글을 찾을 수 없습니다.' }, 404);

  if (!(await mayModify(comment, body, data.session))) {
    return json({ error: '비밀번호가 맞지 않습니다.' }, 403);
  }

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
