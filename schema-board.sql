-- ==========================================================================
-- schema-board.sql — 게시판 테이블
-- D1 콘솔에서 아래 문장을 "한 번에 하나씩" 실행하세요 (여러 개를 한꺼번에
-- 넣으면 실패할 수 있습니다). 여러 번 실행해도 안전합니다 (IF NOT EXISTS).
--
-- 기존 memos / sessions / login_attempts 는 건드리지 않습니다.
-- ==========================================================================

-- 게시글
CREATE TABLE IF NOT EXISTS posts (
  id           TEXT    PRIMARY KEY,
  title        TEXT    NOT NULL,
  body         TEXT    NOT NULL,
  nickname     TEXT    NOT NULL,
  -- 익명 글의 수정/삭제용 비밀번호. 원문은 저장하지 않고 salt + 파생값만 둡니다.
  -- 주인이 로그인 상태로 쓴 글은 비밀번호가 없으므로 둘 다 NULL 입니다.
  pwSalt       TEXT,
  pwHash       TEXT,
  isOwner      INTEGER NOT NULL DEFAULT 0,
  -- IP 원본은 저장하지 않습니다. 도배 차단에 쓸 해시만 둡니다.
  ipHash       TEXT    NOT NULL,
  commentCount INTEGER NOT NULL DEFAULT 0,
  createdAt    INTEGER NOT NULL,
  updatedAt    INTEGER NOT NULL,
  -- 공개 범위: public(공개) / locked(글 비밀번호로 열기) / private(주인만)
  -- 이 열이 생기기 전에 만든 표에는 서버가 스스로 붙입니다(lib/schema.js).
  -- 직접 붙이려면: ALTER TABLE posts ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'
  visibility   TEXT    NOT NULL DEFAULT 'public'
);

CREATE INDEX IF NOT EXISTS idx_posts_created ON posts (createdAt DESC);

-- 댓글
CREATE TABLE IF NOT EXISTS comments (
  id        TEXT    PRIMARY KEY,
  postId    TEXT    NOT NULL,
  body      TEXT    NOT NULL,
  nickname  TEXT    NOT NULL,
  pwSalt    TEXT,
  pwHash    TEXT,
  isOwner   INTEGER NOT NULL DEFAULT 0,
  ipHash    TEXT    NOT NULL,
  createdAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comments_post ON comments (postId, createdAt);

-- 봇/도배 차단. IP 해시별 최근 작성 기록.
-- login_attempts 와 같은 발상이지만 게시판 전용으로 따로 둡니다.
CREATE TABLE IF NOT EXISTS board_limits (
  ipHash        TEXT    PRIMARY KEY,
  lastPostAt    INTEGER NOT NULL DEFAULT 0,
  lastCommentAt INTEGER NOT NULL DEFAULT 0,
  dayStart      INTEGER NOT NULL DEFAULT 0,
  dayPosts      INTEGER NOT NULL DEFAULT 0,
  dayComments   INTEGER NOT NULL DEFAULT 0,
  strikes       INTEGER NOT NULL DEFAULT 0,
  blockedUntil  INTEGER NOT NULL DEFAULT 0,
  updatedAt     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_board_limits_blocked ON board_limits (blockedUntil);

-- 글에 붙는 HTML 첨부. 주인만 올릴 수 있고, 보는 건 누구나 가능합니다.
-- 내용은 격리된 출처(opaque origin)로만 내려갑니다.
--   functions/api/board/files/[id]/raw.js 의 CSP sandbox 참고
CREATE TABLE IF NOT EXISTS files (
  id        TEXT    PRIMARY KEY,
  postId    TEXT    NOT NULL,
  name      TEXT    NOT NULL,
  html      TEXT    NOT NULL,
  size      INTEGER NOT NULL,
  createdAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_files_post ON files (postId, createdAt);
