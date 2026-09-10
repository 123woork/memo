/* ==========================================================================
   functions/api/memos/[id].js
   PUT    /api/memos/:id   메모 수정
   DELETE /api/memos/:id   메모 삭제
   ========================================================================== */

import { json } from '../../../lib/auth.js';
import { readMemoText } from '../../../lib/memos.js';

const NOT_FOUND = '메모를 찾을 수 없습니다.';

export async function onRequestPut({ params, request, env }) {
  const { text, error } = await readMemoText(request);
  if (error) return json({ error }, 400);

  const result = await env.DB
    .prepare('UPDATE memos SET text = ?, updatedAt = ? WHERE id = ?')
    .bind(text, Date.now(), params.id)
    .run();

  if (!result.meta.changes) return json({ error: NOT_FOUND }, 404);

  const memo = await env.DB
    .prepare('SELECT id, text, createdAt, updatedAt FROM memos WHERE id = ?')
    .bind(params.id)
    .first();

  return json(memo);
}

export async function onRequestDelete({ params, env }) {
  const result = await env.DB
    .prepare('DELETE FROM memos WHERE id = ?')
    .bind(params.id)
    .run();

  if (!result.meta.changes) return json({ error: NOT_FOUND }, 404);
  return json({ ok: true });
}
