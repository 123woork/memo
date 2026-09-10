/* ==========================================================================
   functions/api/board/posts/[id].js
   GET    /api/board/posts/:id   글 하나 + 댓글 전부
   PUT    /api/board/posts/:id   글 수정
   DELETE /api/board/posts/:id   글 삭제 (딸린 댓글도 같이)

   수정과 삭제는 둘 중 하나면 됩니다.
     - 글 쓸 때 정한 비밀번호를 맞히거나
     - 사이트 주인으로 로그인해 있거나

   대괄호 파일명은 Pages Functions 의 동적 라우트 문법입니다. 바꾸지 마세요.
   ========================================================================== */

import { json, readJson } from '../../../../lib/auth.js';
import {
  LIMITS, cleanText, mayModify, publicPost, publicComment, publicFile
} from '../../../../lib/board.js';

const NOT_FOUND = '글을 찾을 수 없습니다.';
const WRONG_PASSWORD = '비밀번호가 맞지 않습니다.';

async function loadPost(env, id) {
  return env.DB
    .prepare(
      'SELECT id, title, body, nickname, pwSalt, pwHash, isOwner,' +
      '       commentCount, createdAt, updatedAt' +
      '  FROM posts WHERE id = ?'
    )
    .bind(id)
    .first();
}

export async function onRequestGet({ params, env }) {
  const post = await loadPost(env, params.id);
  if (!post) return json({ error: NOT_FOUND }, 404);

  const { results } = await env.DB
    .prepare(
      'SELECT id, postId, body, nickname, pwHash, isOwner, createdAt' +
      '  FROM comments WHERE postId = ? ORDER BY createdAt ASC LIMIT ?'
    )
    .bind(params.id, LIMITS.maxComments)
    .all();

  // 첨부 목록. html 본문은 여기서 내보내지 않습니다.
  // 내용은 /api/board/files/:id/raw 로만 나가고, 그 응답은 격리된 출처입니다.
  const files = await env.DB
    .prepare(
      'SELECT id, postId, name, size, createdAt' +
      '  FROM files WHERE postId = ? ORDER BY createdAt ASC'
    )
    .bind(params.id)
    .all();

  return json({
    post: publicPost(post, { withBody: true }),
    comments: (results || []).map(publicComment),
    files: (files.results || []).map(publicFile)
  });
}

export async function onRequestPut({ params, request, env, data }) {
  const body = await readJson(request);

  const post = await loadPost(env, params.id);
  if (!post) return json({ error: NOT_FOUND }, 404);

  if (!(await mayModify(post, body, data.session))) {
    return json({ error: WRONG_PASSWORD }, 403);
  }

  const title = cleanText(body?.title).slice(0, LIMITS.title);
  const text  = cleanText(body?.body, { multiline: true });

  if (!title) return json({ error: '제목을 적어 주세요.' }, 400);
  if (!text)  return json({ error: '내용을 적어 주세요.' }, 400);
  if (text.length > LIMITS.body) {
    return json({ error: '내용은 ' + LIMITS.body + '자까지 쓸 수 있습니다.' }, 400);
  }

  const now = Date.now();
  await env.DB
    .prepare('UPDATE posts SET title = ?, body = ?, updatedAt = ? WHERE id = ?')
    .bind(title, text, now, params.id)
    .run();

  return json(publicPost(
    { ...post, title, body: text, updatedAt: now },
    { withBody: true }
  ));
}

export async function onRequestDelete({ params, request, env, data }) {
  const body = await readJson(request);

  const post = await loadPost(env, params.id);
  if (!post) return json({ error: NOT_FOUND }, 404);

  if (!(await mayModify(post, body, data.session))) {
    return json({ error: WRONG_PASSWORD }, 403);
  }

  // 댓글과 첨부를 먼저 지우고 글을 지웁니다.
  // 한 묶음으로 처리해 반쪽만 지워지는 일을 막습니다.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM comments WHERE postId = ?').bind(params.id),
    env.DB.prepare('DELETE FROM files WHERE postId = ?').bind(params.id),
    env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(params.id)
  ]);

  return json({ ok: true });
}
