/* ==========================================================================
   functions/api/memos.js
   GET  /api/memos   메모 목록 (최신순)
   POST /api/memos   새 메모 저장

   여기까지 오면 _middleware.js에서 세션 확인을 이미 마친 상태입니다.
   ========================================================================== */

import { json, newId, insertStatement } from '../../lib/auth.js';
import { readMemoText } from '../../lib/memos.js';

const PAGE_SIZE = 500;     // 한 번에 내려주는 최대 건수

export async function onRequestGet({ env }) {
  const { results } = await env.DB
    .prepare(
      `SELECT id, text, createdAt, updatedAt
         FROM memos
        ORDER BY createdAt DESC
        LIMIT ?`
    )
    .bind(PAGE_SIZE)
    .all();

  return json(results ?? []);
}

export async function onRequestPost({ request, env }) {
  const { text, error } = await readMemoText(request);
  if (error) return json({ error }, 400);

  const now = Date.now();
  const memo = { id: newId(), text, createdAt: now, updatedAt: now };

  await insertStatement(env.DB, 'memos', memo).run();

  return json(memo, 201);
}
