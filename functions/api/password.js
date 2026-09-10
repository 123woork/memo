/* ==========================================================================
   functions/api/password.js
   POST /api/password   사이트 비밀번호 바꾸기

   로그인한 상태에서만 옵니다 (_middleware.js 가 세션과 Origin 을 확인합니다).

   비밀번호 원문은 여기에도 오지 않습니다. 브라우저(auth.js)가 보내는 것:
     currentKey  지금 비밀번호로 계산한 값 (로그인 때와 같은 계산)
     salt        브라우저가 새로 뽑은 무작위 salt (hex 32자)
     key         새 비밀번호를 새 salt 로 계산한 값 (hex 64자)
     iterations  계산에 쓴 반복 횟수

   서버는 currentKey 로 본인임을 확인하고(틀리면 로그인과 같은 시도 제한),
   SHA-256(key) 를 새 검증값으로 D1 site_settings 'auth' 에 저장합니다.
   이후로는 환경 변수(MEMO_SALT/MEMO_VERIFIER)보다 이 값이 우선합니다.

   바꾸고 나면 지금 이 기기를 뺀 모든 세션을 끊습니다. 비밀번호를 바꾸는
   이유가 "누가 알았을까 봐"일 때 그 사람을 바로 내보내기 위해서입니다.
   ========================================================================== */

import {
  json, readJson, clientIp, sha256Hex, timingSafeEqual, siteAuth, settingStatement,
  reserveAttempt, clearFailures, MIN_ITERATIONS
} from '../../lib/auth.js';

const MAX_ITERATIONS = 10000000;   // 브라우저가 감당할 만한 상한. 이상한 값을 막는 용도
const HEX_32 = /^[0-9a-f]{32}$/;
const HEX_64 = /^[0-9a-f]{64}$/;

export async function onRequestPost({ request, env, data }) {
  const auth = await siteAuth(env);
  if (!auth) {
    return json({ error: 'MEMO_SALT와 MEMO_VERIFIER 환경 변수가 설정되지 않았습니다.' }, 500);
  }

  const body = await readJson(request);
  const currentKey = typeof body?.currentKey === 'string' ? body.currentKey : '';
  const salt       = typeof body?.salt === 'string' ? body.salt : '';
  const key        = typeof body?.key === 'string' ? body.key : '';
  const iterations = body?.iterations;

  if (!HEX_32.test(salt) || !HEX_64.test(key) || !Number.isInteger(iterations) ||
      iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    return json({ error: '잘못된 요청입니다.' }, 400);
  }

  // 지금 비밀번호 확인. 로그인과 같은 시도 제한을 겁니다(같은 IP 칸을 씁니다).
  // 안 걸면 세션을 가진 사람이 여기서 로그인 잠금을 우회해 비밀번호를 맞혀 볼 수 있습니다.
  const ip = clientIp(request);

  const locked = await reserveAttempt(env, ip, Date.now());
  if (locked) return json({ error: locked.error }, locked.status);

  if (!timingSafeEqual(await sha256Hex(currentKey), auth.verifier)) {
    return json({ error: '지금 비밀번호가 맞지 않습니다.' }, 403);
  }
  await clearFailures(env, ip);

  // 새 검증값 저장과 다른 세션 끊기를 한 묶음으로 처리합니다
  const verifier = await sha256Hex(key);
  await env.DB.batch([
    settingStatement(env, 'auth', JSON.stringify({ salt, verifier, iterations })),
    env.DB.prepare('DELETE FROM sessions WHERE tokenHash != ?').bind(data.session.tokenHash)
  ]);

  return json({ ok: true });
}
