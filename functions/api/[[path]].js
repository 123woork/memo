/* ==========================================================================
   functions/api/[[path]].js
   /api/ 아래에서 어떤 함수도 처리하지 못한 요청을 받아 JSON 404를 돌려줍니다.

   왜 필요한가
     Pages 는 함수가 처리하지 않은 요청을 정적 파일 쪽으로 흘려보냅니다.
     그래서 GET /api/board/posts/xxx/files 같은 주소가 200 과 함께 index.html
     을 받아 갔습니다. 데이터가 새지는 않지만(개인 경로는 _middleware.js 가
     401 로 막습니다), 화면 코드가 오류 대신 null 을 받게 되어 나중에 원인을
     찾기 어려워집니다.

   대괄호 두 겹은 Pages Functions 의 "나머지 전부" 라우트 문법입니다.
   구체적인 경로(memos.js, board/posts.js …)가 항상 먼저 잡히고,
   아무것도 안 잡혔을 때만 여기로 옵니다.
   ========================================================================== */

import { json } from '../../lib/auth.js';

export async function onRequest({ request }) {
  const url = new URL(request.url);
  return json({
    error: '없는 주소입니다: ' + request.method + ' ' + url.pathname
  }, 404);
}
