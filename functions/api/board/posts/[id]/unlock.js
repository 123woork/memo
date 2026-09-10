/* ==========================================================================
   functions/api/board/posts/:id/unlock
   POST   잠긴 글 열기

   글 비밀번호가 맞으면 그 글 하나를 2시간 동안 볼 수 있는 열람 토큰을 줍니다.
     { token, expiresAt }
   화면은 이 토큰을 글 상세·댓글 달기(X-Post-Token 헤더)와 첨부 보기(?t=)에 씁니다.
   토큰의 모양과 서명은 lib/board.js 의 "잠긴 글 열람 토큰" 절에 있습니다.

   틀린 비밀번호는 IP 해시별로 세어 5번째 시도에서 잠급니다 (checkPassword).
   주인은 비밀번호 없이 토큰을 받습니다. 남의 비공개 글은 404 입니다.

   토큰은 "잠긴 글"에만 줍니다. 공개 글에 주면, 공개일 때 받아 둔 토큰으로
   작성자가 나중에 잠근 뒤에도 2시간 동안 볼 수 있게 되기 때문입니다.
   ========================================================================== */

import { json, readJson } from '../../../../../lib/auth.js';
import { hiddenFrom, checkPassword, issueAccessToken } from '../../../../../lib/board.js';

export async function onRequestPost({ params, request, env, data }) {
  const owner = !!data.session;
  const body = await readJson(request);

  const post = await env.DB
    .prepare('SELECT id, pwSalt, pwHash, visibility FROM posts WHERE id = ?')
    .bind(params.id)
    .first();
  if (hiddenFrom(post, owner)) return json({ error: '글을 찾을 수 없습니다.' }, 404);
  if (post.visibility !== 'locked') return json({ error: '잠긴 글이 아닙니다.' }, 400);

  if (!owner) {
    const wrong = await checkPassword(env, request, post, body?.password);
    if (wrong) return json({ error: wrong.error }, wrong.status);
  }

  return json(await issueAccessToken(env, post.id));
}
