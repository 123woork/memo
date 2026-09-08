/* ==========================================================================
   functions/api/memos.js
   GET  /api/memos   메모 목록 (최신순)
   POST /api/memos   새 메모 저장

   여기까지 오면 _middleware.js에서 세션 확인을 이미 마친 상태입니다.
   ========================================================================== */

import { json } from '../../lib/auth.js';

const MAX_LENGTH = 20000;   // 메모 한 건의 글자 수 상한
const PAGE_SIZE  = 500;     // 한 번에 내려주는 최대 건수

function newId() {
  return Date.now().toString(36) + '-' + crypto.randomUUID().slice(0, 8);
}

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
  const body = await request.json().catch(() => null);
  const text = typeof body?.text === 'string' ? body.text.trim() : '';

  if (!text) return json({ error: '내용이 비어 있습니다.' }, 400);
  if (text.length > MAX_LENGTH) {
    return json({ error: `메모는 ${MAX_LENGTH}자까지 저장할 수 있습니다.` }, 400);
  }

  const now = Date.now();
  const memo = { id: newId(), text, createdAt: now, updatedAt: now };

  await env.DB
    .prepare('INSERT INTO memos (id, text, createdAt, updatedAt) VALUES (?, ?, ?, ?)')
    .bind(memo.id, memo.text, memo.createdAt, memo.updatedAt)
    .run();

  return json(memo, 201);
}
