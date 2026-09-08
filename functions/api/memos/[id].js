/* ==========================================================================
   functions/api/memos/[id].js
   PUT    /api/memos/:id   메모 수정
   DELETE /api/memos/:id   메모 삭제
   ========================================================================== */

import { json } from '../../../lib/auth.js';

const MAX_LENGTH = 20000;

export async function onRequestPut({ params, request, env }) {
  const body = await request.json().catch(() => null);
  const text = typeof body?.text === 'string' ? body.text.trim() : '';

  if (!text) return json({ error: '내용이 비어 있습니다.' }, 400);
  if (text.length > MAX_LENGTH) {
    return json({ error: `메모는 ${MAX_LENGTH}자까지 저장할 수 있습니다.` }, 400);
  }

  const result = await env.DB
    .prepare('UPDATE memos SET text = ?, updatedAt = ? WHERE id = ?')
    .bind(text, Date.now(), params.id)
    .run();

  if (!result.meta.changes) return json({ error: '메모를 찾을 수 없습니다.' }, 404);

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

  if (!result.meta.changes) return json({ error: '메모를 찾을 수 없습니다.' }, 404);
  return json({ ok: true });
}
