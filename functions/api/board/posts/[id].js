/* ==========================================================================
   functions/api/board/posts/[id].js
   GET    /api/board/posts/:id   글 하나 + 댓글 전부 + 첨부 목록
   PUT    /api/board/posts/:id   글 수정 (공개 범위도 바꿀 수 있음)
   DELETE /api/board/posts/:id   글 삭제 (딸린 댓글·첨부도 같이)

   보기
     공개 글   누구나
     잠긴 글   주인, 또는 열람 토큰(X-Post-Token)이 있는 사람. 아니면 제목을
               가리고 내용·댓글·첨부 없이 { locked: true } 만 돌려줍니다.
               토큰은 POST /api/board/posts/:id/unlock 에서 받습니다.
     비공개 글 주인만. 다른 사람에게는 404 (있다는 것도 알려 주지 않습니다)

   수정과 삭제는 둘 중 하나면 됩니다.
     - 글 쓸 때 정한 비밀번호를 맞히거나 (틀린 횟수를 세어 잠급니다)
     - 사이트 주인으로 로그인해 있거나

   대괄호 파일명은 Pages Functions 의 동적 라우트 문법입니다. 바꾸지 마세요.
   ========================================================================== */

import { json, readJson } from '../../../../lib/auth.js';
import {
  LIMITS, cleanText, cleanVisibility, visibilityProblem, hiddenFrom,
  accessOf, accessTokenOf, modifyProblem, publicPost, publicComment, publicFile
} from '../../../../lib/board.js';

const NOT_FOUND = '글을 찾을 수 없습니다.';

async function loadPost(env, id) {
  return env.DB
    .prepare(
      'SELECT id, title, body, nickname, pwSalt, pwHash, isOwner,' +
      '       commentCount, visibility, createdAt, updatedAt' +
      '  FROM posts WHERE id = ?'
    )
    .bind(id)
    .first();
}

export async function onRequestGet({ params, request, env, data }) {
  const post = await loadPost(env, params.id);
  const access = post
    ? await accessOf(env, post, { owner: !!data.session, token: accessTokenOf(request) })
    : 'hidden';

  if (access === 'hidden') return json({ error: NOT_FOUND }, 404);

  // 잠긴 글: 있다는 것과 작성자·날짜만 알려 주고, 제목·내용·댓글·첨부는 싣지 않습니다
  if (access === 'locked') {
    return json({ post: publicPost(post, { locked: true }), locked: true, comments: [], files: [] });
  }

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
    locked: false,
    comments: (results || []).map(publicComment),
    files: (files.results || []).map(publicFile)
  });
}

export async function onRequestPut({ params, request, env, data }) {
  const owner = !!data.session;
  const body = await readJson(request);

  const post = await loadPost(env, params.id);
  if (hiddenFrom(post, owner)) return json({ error: NOT_FOUND }, 404);

  const denied = await modifyProblem(env, request, post, body, owner);
  if (denied) return json({ error: denied.error }, denied.status);

  const title = cleanText(body?.title).slice(0, LIMITS.title);
  const text  = cleanText(body?.body, { multiline: true });

  if (!title) return json({ error: '제목을 적어 주세요.' }, 400);
  if (!text)  return json({ error: '내용을 적어 주세요.' }, 400);
  if (text.length > LIMITS.body) {
    return json({ error: '내용은 ' + LIMITS.body + '자까지 쓸 수 있습니다.' }, 400);
  }

  // 공개 범위. 보내지 않았으면 그대로 둡니다.
  const visibility = body?.visibility === undefined
    ? post.visibility
    : cleanVisibility(body.visibility);
  const refused = visibilityProblem(visibility, { owner, hasPassword: !!post.pwHash });
  if (refused) return json({ error: refused.error }, refused.status);

  const now = Date.now();
  await env.DB
    .prepare('UPDATE posts SET title = ?, body = ?, visibility = ?, updatedAt = ? WHERE id = ?')
    .bind(title, text, visibility, now, params.id)
    .run();

  return json(publicPost(
    { ...post, title, body: text, visibility, updatedAt: now },
    { withBody: true }
  ));
}

export async function onRequestDelete({ params, request, env, data }) {
  const owner = !!data.session;
  const body = await readJson(request);

  const post = await loadPost(env, params.id);
  if (hiddenFrom(post, owner)) return json({ error: NOT_FOUND }, 404);

  const denied = await modifyProblem(env, request, post, body, owner);
  if (denied) return json({ error: denied.error }, denied.status);

  // 댓글과 첨부를 먼저 지우고 글을 지웁니다.
  // 한 묶음으로 처리해 반쪽만 지워지는 일을 막습니다.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM comments WHERE postId = ?').bind(params.id),
    env.DB.prepare('DELETE FROM files WHERE postId = ?').bind(params.id),
    env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(params.id)
  ]);

  return json({ ok: true });
}
