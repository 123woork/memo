/* ==========================================================================
   functions/api/_middleware.js
   /api/ 로 들어오는 모든 요청보다 먼저 실행됩니다.

   /api/login 만 통과시키고, 나머지는 세션 쿠키가 있어야 지나갑니다.
   쿠키의 토큰을 그대로 비교하지 않고 해시로 조회하므로,
   데이터베이스를 통째로 봐도 남의 세션을 만들 수 없습니다.
   ========================================================================== */

import { json, getCookie, findSession, sameOrigin, SESSION_COOKIE } from '../../lib/auth.js';

export async function onRequest(context) {
  const { request, env, data, next } = context;
  const url = new URL(request.url);

  // 로그인 창구는 열려 있어야 합니다 (자체 잠금 장치가 따로 있습니다)
  if (url.pathname === '/api/login') return next();

  if (!env.DB) {
    return json({
      error: 'D1 데이터베이스가 연결되지 않았습니다. Pages 설정에서 DB라는 이름으로 바인딩하세요.'
    }, 500);
  }

  // 읽기가 아닌 요청은 우리 사이트에서 온 것인지 한 번 더 확인합니다
  if (request.method !== 'GET' && !sameOrigin(request)) {
    return json({ error: '잘못된 요청입니다.' }, 403);
  }

  const session = await findSession(env, getCookie(request, SESSION_COOKIE));
  if (!session) {
    return json({ error: '로그인이 필요합니다.' }, 401);
  }

  data.session = session;
  return next();
}
