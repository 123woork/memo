-- D1 콘솔에 이 내용을 그대로 붙여넣고 실행하세요.
-- 여러 번 실행해도 안전합니다 (IF NOT EXISTS).

-- 메모 본문
CREATE TABLE IF NOT EXISTS memos (
  id        TEXT    PRIMARY KEY,
  text      TEXT    NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memos_created ON memos (createdAt DESC);

-- 로그인 세션.
-- 쿠키에 담긴 토큰 원본이 아니라 그 해시만 저장합니다.
-- 이 표가 통째로 유출돼도 남의 세션을 가로챌 수 없습니다.
CREATE TABLE IF NOT EXISTS sessions (
  tokenHash TEXT    PRIMARY KEY,
  createdAt INTEGER NOT NULL,
  expiresAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expiresAt);

-- 비밀번호 무차별 대입 차단용.
-- 키별로 실패 횟수를 세고, 일정 횟수를 넘으면 점점 길게 잠급니다.
--   로그인·사이트 비밀번호 바꾸기  ip = IP 원문
--   게시판 글·댓글 비밀번호        ip = 'board:' + IP 해시
CREATE TABLE IF NOT EXISTS login_attempts (
  ip          TEXT    PRIMARY KEY,
  fails       INTEGER NOT NULL DEFAULT 0,
  lockedUntil INTEGER NOT NULL DEFAULT 0,
  updatedAt   INTEGER NOT NULL
);

-- 사이트 설정 (key 하나에 값 하나).
--   auth         사이트에서 비밀번호를 바꾸면 새 salt/검증값/반복 횟수(JSON)가 들어가고,
--                환경 변수 MEMO_SALT/MEMO_VERIFIER 보다 우선합니다.
--                비밀번호를 잊었으면  DELETE FROM site_settings WHERE key = 'auth';
--                를 실행하세요. 환경 변수 쪽 비밀번호로 돌아갑니다.
--   tokenSecret  잠긴 글 열람 토큰 서명용 무작위 값. 서버 밖으로 나가지 않습니다.
-- 이 표는 서버가 필요할 때 스스로 만듭니다(lib/schema.js). 여기 적힌 건 기록용이며
-- 직접 실행해도 안전합니다.
CREATE TABLE IF NOT EXISTS site_settings (
  key       TEXT    PRIMARY KEY,
  value     TEXT    NOT NULL,
  updatedAt INTEGER NOT NULL DEFAULT 0
);
