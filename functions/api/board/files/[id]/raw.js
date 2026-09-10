/* ==========================================================================
   functions/api/board/files/:id/raw
   GET   올라온 HTML을 그대로 내려줍니다.

   누가 볼 수 있나 — 첨부가 달린 글을 볼 수 있는 사람만
     공개 글   누구나
     잠긴 글   주인, 또는 그 글의 열람 토큰을 주소에 단 사람 (?t=...)
     비공개 글 주인만
   볼 수 없으면 "없는 파일"(404)로 답합니다. 첨부 주소만 알아서는 저작권물
   같은 잠긴 내용을 볼 수 없게 하려는 것입니다.

   ★ 아래 CSP 헤더가 이 기능의 격리 장치 전부입니다. 손대지 마세요. ★

   왜 위험한가
     tisave.com 에서 실행되는 스크립트는 같은 출처이므로 fetch('/api/memos')
     를 부를 수 있고, 브라우저가 세션 쿠키를 알아서 붙여 줍니다. 쿠키가
     HttpOnly 라 훔치지는 못해도, 주인이 그 페이지를 여는 순간 개인 메모를
     읽어 밖으로 보낼 수 있습니다.

   어떻게 막는가
     응답에 CSP 의 sandbox 지시자를 답니다. 그러면 이 문서는 tisave.com 이
     아니라 고유한(불투명) 출처를 갖습니다. 안에서 자바스크립트는 정상적으로
     돌지만 tisave.com 의 쿠키, 저장소, 로그인된 API 에는 닿을 수 없습니다.
     allow-same-origin 을 절대 넣으면 안 됩니다. 넣는 순간 격리가 풀립니다.
     allow-top-navigation 도 넣지 않습니다. 넣으면 틀 안의 페이지가 탭 전체를
     다른 주소로 끌고 갈 수 있습니다.

   _headers 의 전역 CSP 는 Pages Functions 응답에는 붙지 않습니다. 그래서
   이 응답의 CSP 가 다른 정책과 섞이지 않고 그대로 적용됩니다.
   ========================================================================== */

import { accessOf, accessTokenOf } from '../../../../../lib/board.js';

const SANDBOX = [
  // 이 문서를 고유 출처로 격리합니다. allow-same-origin 은 넣지 않습니다.
  'sandbox allow-scripts allow-forms allow-popups allow-modals',
  // 우리 사이트에서만 틀 안에 넣을 수 있습니다
  "frame-ancestors 'self'"
].join('; ');

function notFound() {
  return new Response('없는 파일입니다.', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export async function onRequestGet({ params, request, env, data }) {
  const row = await env.DB
    .prepare(
      'SELECT f.html, p.id AS postId, p.visibility' +
      '  FROM files f JOIN posts p ON p.id = f.postId' +
      ' WHERE f.id = ?'
    )
    .bind(params.id)
    .first();
  if (!row) return notFound();

  const access = await accessOf(
    env,
    { id: row.postId, visibility: row.visibility },
    { owner: !!data.session, token: accessTokenOf(request) }
  );
  if (access !== 'full') return notFound();

  return new Response(row.html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': SANDBOX,
      // 브라우저가 내용을 보고 타입을 멋대로 바꾸지 못하게 합니다
      'X-Content-Type-Options': 'nosniff',
      // 이 페이지에서 밖으로 나가는 요청에 우리 주소(와 열람 토큰)를 알려주지 않습니다
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store'
    }
  });
}
