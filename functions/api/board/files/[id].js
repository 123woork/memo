/* ==========================================================================
   functions/api/board/files/:id
   DELETE   첨부 HTML 삭제. 올릴 때와 같이 **주인만** 할 수 있습니다.

   내용 보기는 같은 경로 밑 /raw 에 있습니다 (누구나 가능).
   ========================================================================== */

import { json } from '../../../../lib/auth.js';

export async function onRequestDelete({ params, env, data }) {
  if (!data.session) {
    return json({ error: '첨부 삭제는 주인만 할 수 있습니다.' }, 403);
  }

  const result = await env.DB
    .prepare('DELETE FROM files WHERE id = ?')
    .bind(params.id)
    .run();

  if (!result.meta.changes) return json({ error: '파일을 찾을 수 없습니다.' }, 404);

  return json({ ok: true });
}
