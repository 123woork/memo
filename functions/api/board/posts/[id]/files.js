/* ==========================================================================
   functions/api/board/posts/:id/files
   POST   글에 HTML 파일을 붙입니다. **주인만** 할 수 있습니다.

   왜 주인만인가
     여기에 올라온 HTML 은 tisave.com 주소로 유통됩니다. 아무나 올릴 수 있게
     하면 남의 피싱 페이지가 내 도메인 이름을 달고 돌아다니게 됩니다.
     (실행 자체는 격리돼 있어 메모가 새지는 않습니다. raw.js 참고)

   파일 목록은 글 상세(GET /api/board/posts/:id)에 같이 실려 옵니다.
   ========================================================================== */

import { json, readJson, newId, insertStatement } from '../../../../../lib/auth.js';
import { LIMITS, cleanFileName, publicFile } from '../../../../../lib/board.js';

export async function onRequestPost({ params, request, env, data }) {
  if (!data.session) {
    return json({ error: 'HTML 첨부는 주인만 할 수 있습니다. 먼저 로그인하세요.' }, 403);
  }

  const body = await readJson(request);
  const html = typeof body?.html === 'string' ? body.html : '';

  if (!html.trim()) {
    return json({ error: '파일이 비어 있습니다.' }, 400);
  }

  // 글자 수가 아니라 실제 바이트로 잽니다. 한글은 한 글자가 3바이트입니다.
  const size = new TextEncoder().encode(html).length;
  if (size > LIMITS.fileBytes) {
    const kb = Math.round(LIMITS.fileBytes / 1000);
    return json({ error: '파일이 너무 큽니다. ' + kb + 'KB까지 올릴 수 있습니다.' }, 400);
  }

  const post = await env.DB
    .prepare('SELECT id FROM posts WHERE id = ?')
    .bind(params.id)
    .first();
  if (!post) return json({ error: '글을 찾을 수 없습니다.' }, 404);

  const counted = await env.DB
    .prepare('SELECT COUNT(*) AS n FROM files WHERE postId = ?')
    .bind(params.id)
    .first();
  if (counted && counted.n >= LIMITS.filesPerPost) {
    return json({ error: '글 하나에 ' + LIMITS.filesPerPost + '개까지 붙일 수 있습니다.' }, 400);
  }

  const file = {
    id: newId(),
    postId: params.id,
    name: cleanFileName(body?.name),
    size,
    createdAt: Date.now()
  };

  // html 본문은 저장만 하고 응답에는 싣지 않습니다 (publicFile 참고)
  await insertStatement(env.DB, 'files', { ...file, html }).run();

  return json(publicFile(file), 201);
}
