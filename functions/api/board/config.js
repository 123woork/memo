/* ==========================================================================
   functions/api/board/config.js
   GET /api/board/config

   화면이 시작할 때 한 번 부릅니다.
     - Turnstile 사이트 키 (공개 값입니다. 비밀 키는 서버에만 있습니다)
     - 지금 보는 사람이 주인인지
     - 입력 길이 상한 (화면과 서버가 같은 숫자를 쓰도록)
   ========================================================================== */

import { json } from '../../../lib/auth.js';
import { LIMITS } from '../../../lib/board.js';

export async function onRequestGet({ env, data }) {
  return json({
    // 사이트 키는 브라우저에 노출되는 것이 정상입니다.
    // 키가 없으면 null 이고, 화면은 사람 확인 위젯을 그리지 않습니다.
    turnstileSiteKey: env.TURNSTILE_SITEKEY || null,
    owner: !!data.session,
    limits: {
      title:    LIMITS.title,
      body:     LIMITS.body,
      nickname: LIMITS.nickname,
      comment:  LIMITS.comment,
      pwMin:    LIMITS.pwMin,
      pwMax:    LIMITS.pwMax,
      pageSize: LIMITS.pageSize,
      // HTML 첨부. 화면이 큰 파일을 미리 걸러 낼 때 이 숫자를 씁니다.
      fileBytes:    LIMITS.fileBytes,
      filesPerPost: LIMITS.filesPerPost
    }
  });
}
