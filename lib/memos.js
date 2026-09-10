/* ==========================================================================
   lib/memos.js — 개인 메모 서버 공용 함수
   --------------------------------------------------------------------------
   memos.js(목록/생성)와 memos/[id].js(수정/삭제)가 같이 씁니다.
   게시판과는 분리돼 있습니다. 게시판 코드는 이 파일을 쓰지 않습니다.
   ========================================================================== */

import { readJson } from './auth.js';

/** 메모 한 건의 글자 수 상한 */
export const MAX_LENGTH = 20000;

/** 요청 본문에서 메모 글을 꺼내 검사합니다.
 *  문제가 있으면 { error }, 아니면 앞뒤 공백을 걷은 { text }. */
export async function readMemoText(request) {
  const body = await readJson(request);
  const text = typeof body?.text === 'string' ? body.text.trim() : '';

  if (!text) return { error: '내용이 비어 있습니다.' };
  if (text.length > MAX_LENGTH) {
    return { error: `메모는 ${MAX_LENGTH}자까지 저장할 수 있습니다.` };
  }
  return { text };
}
