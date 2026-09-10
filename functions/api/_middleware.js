/* ==========================================================================
   functions/api/_middleware.js
   /api/ 로 들어오는 모든 요청보다 먼저 실행됩니다.

   통과 규칙
     /api/login   로그인 창구. 자체 잠금 장치가 따로 있습니다.
     /api/board/* 게시판. 누구나 읽고 쓸 수 있는 공개 영역입니다.
     그 외        세션 쿠키가 있어야 지나갑니다. (개인 메모, 비밀번호 바꾸기)

   쿠키의 토큰을 그대로 비교하지 않고 해시로 조회하므로,
   데이터베이스를 통째로 봐도 남의 세션을 만들 수 없습니다.

   게시판이 공개라도 세션 확인은 그대로 합니다. 로그인한 사람은 "주인"으로
   인식되어 남의 글도 지울 수 있고, 잠긴 글·비공개 글을 바로 보며,
   도배 제한을 받지 않습니다.

   새로 생긴 표·열은 여기서 ensureSchema 가 한 번 맞춰 둡니다 (lib/schema.js).
   ========================================================================== */

import { json, getCookie, findSession, sameOrigin, SESSION_COOKIE } from '../../lib/auth.js';
import { ensureSchema } from '../../lib/schema.js';

/** 로그인 없이 지나갈 수 있는 경로인가.
 *  '/api/boardxxx' 같은 경로가 딸려 들어오지 않도록 정확히 끊습니다. */
function isPublicPath(pathname) {
  return pathname === '/api/board' || pathname.startsWith('/api/board/');
}

export async function onRequest(context) {
  const { request, env, data, next } = context;
  const url = new URL(request.url);
  const isLogin = url.pathname === '/api/login';

  if (!env.DB) {
    // 로그인 창구는 자기 오류 문구로 알려 줍니다
    if (isLogin) return next();
    return json({
      error: 'D1 데이터베이스가 연결되지 않았습니다. Pages 설정에서 DB라는 이름으로 바인딩하세요.'
    }, 500);
  }

  try {
    await ensureSchema(env);
  } catch {
    return json({
      error: '데이터베이스를 준비하지 못했습니다. 잠시 후 다시 해보세요. ' +
             '계속되면 schema.sql 을 D1 콘솔에서 실행했는지 확인하세요.'
    }, 500);
  }

  // 로그인 창구는 열려 있어야 합니다 (자체 잠금 장치가 따로 있습니다)
  if (isLogin) return next();

  // 읽기가 아닌 요청은 우리 사이트에서 온 것인지 한 번 더 확인합니다.
  // 공개 게시판에도 그대로 적용됩니다.
  if (request.method !== 'GET' && !sameOrigin(request)) {
    return json({ error: '잘못된 요청입니다.' }, 403);
  }

  // 쿠키가 없으면 findSession 이 DB를 건드리지 않고 바로 null 을 줍니다.
  // 그래서 익명 방문자가 게시판을 읽어도 조회 비용이 늘지 않습니다.
  const session = await findSession(env, getCookie(request, SESSION_COOKIE));
  if (session) data.session = session;

  // 게시판은 로그인 없이도 지나갑니다
  if (isPublicPath(url.pathname)) return next();

  if (!session) {
    return json({ error: '로그인이 필요합니다.' }, 401);
  }

  return next();
}
