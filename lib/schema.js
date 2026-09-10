/* ==========================================================================
   lib/schema.js — 새로 생긴 표와 열을 서버가 스스로 맞춥니다
   --------------------------------------------------------------------------
   schema.sql / schema-board.sql 을 처음 한 번 D1 콘솔에서 실행한 뒤로,
   기능이 늘며 생긴 표·열은 여기서 알아서 붙입니다. 배포하고 나서 콘솔에
   SQL 을 다시 넣지 않아도 되게 하려는 것입니다.

   _middleware.js 가 요청마다 ensureSchema 를 부르지만, 실제 확인은
   isolate(서버 인스턴스) 하나에서 처음 한 번만 합니다. 이후로는 바로 지나갑니다.

   여기서 하는 일 (여러 번 해도 안전합니다)
     1. site_settings 표 만들기          사이트 비밀번호(바꾼 경우), 토큰 서명 비밀
     2. 토큰 서명 비밀(tokenSecret) 만들기  처음 한 번. 서버 밖으로 나가지 않습니다
     3. posts.visibility 열 붙이기        게시판 표가 있고 그 열이 없을 때만
   ========================================================================== */

import { randomToken } from './auth.js';

let ready = null;

/** isolate 마다 한 번만 upgradeSchema 를 돌립니다. 실패하면 다음 요청에서 다시 해봅니다. */
export function ensureSchema(env) {
  if (!ready) {
    ready = upgradeSchema(env.DB).catch(err => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

export async function upgradeSchema(db) {
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS site_settings (' +
    '  key       TEXT    PRIMARY KEY,' +
    '  value     TEXT    NOT NULL,' +
    '  updatedAt INTEGER NOT NULL DEFAULT 0' +
    ')'
  ).run();

  // 이미 있으면 그대로 둡니다 (OR IGNORE). 바뀌면 발급한 열람 토큰이 전부 무효가 됩니다.
  await db
    .prepare('INSERT OR IGNORE INTO site_settings (key, value, updatedAt) VALUES (?, ?, ?)')
    .bind('tokenSecret', randomToken(), Date.now())
    .run();

  // 게시판 표가 아직 없으면(게시판을 안 켰으면) 건드리지 않습니다
  const { results } = await db.prepare('PRAGMA table_info(posts)').all();
  const columns = (results || []).map(c => c.name);
  if (columns.length && !columns.includes('visibility')) {
    try {
      await db.prepare(
        "ALTER TABLE posts ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'"
      ).run();
    } catch (err) {
      // 다른 인스턴스가 한발 먼저 붙였으면 괜찮습니다
      if (!/duplicate column/i.test(String(err && err.message))) throw err;
    }
  }
}
