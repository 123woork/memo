# 메모 + 게시판

한 사이트 안에 두 개의 공간이 있습니다. 빌드 도구도, 설치할 것도 없습니다.
정적 파일과 Cloudflare Pages Functions만으로 돌아갑니다.

| 공간 | 주소 | 누가 볼 수 있나 |
| --- | --- | --- |
| **개인 메모장** | `/` | 사이트 비밀번호를 아는 사람만 |
| **공개 게시판** | `/board` | 누구나 읽고 씁니다 |

둘은 코드도 테이블도 분리돼 있습니다. 게시판 코드는 `memos` 테이블을 건드리지 않습니다.

**설정과 배포 방법은 [`SETUP.md`](SETUP.md) 에 단계별로 있습니다.** 이 문서는 개요입니다.

---

## 기능

**개인 메모장** — 비밀번호로 잠그고, PC와 폰이 같은 메모를 봅니다.
쓰기 / 고치기 / 지우기 / 검색. 세션이 끊기면 잠금 화면이 다시 뜨지만
**쓰던 글은 보존**되고, 다시 로그인하면 이어서 저장됩니다.

**공개 게시판** — 로그인 없이 글과 댓글을 씁니다. 닉네임(비우면 `익명`)과
**글별 비밀번호**를 정하고, 그 비밀번호로 본인 글을 고치고 지웁니다.
사이트 비밀번호로 로그인한 "주인"은 비밀번호 없이 아무 글이나 지울 수 있습니다.

**HTML 첨부** — 주인이 글에 `.html` 파일을 붙이면 누구나 사이트 안에서 실행해 볼 수
있습니다. 글을 쓰면서 바로 붙이거나, 이미 올린 글에 나중에 붙일 수 있습니다.
한 파일 500KB, 글마다 10개까지. 첨부는 격리된 틀에서 돌아서 메모나 로그인 정보에 닿지 못합니다.

---

## 비밀번호가 두 종류입니다

| | 무엇을 지키나 | 어디서 계산하나 | 반복 횟수 |
| --- | --- | --- | --- |
| **사이트 비밀번호** | 개인 메모 전체 | 브라우저 | PBKDF2 60만 회 |
| **글 비밀번호** | 게시판 글/댓글 하나 | 서버 | PBKDF2 1만 회 |

**같은 비밀번호를 두 곳에 쓰지 마세요.** 용도가 다릅니다.

계산을 브라우저에서 하는 이유는 Cloudflare Workers의 요청당 CPU 시간이 짧기
때문입니다. 부수 효과로 **비밀번호가 네트워크를 타지 않습니다.** 서버도, 데이터베이스도,
로그도 비밀번호를 모릅니다.

---

## 파일 구조

```
index.html  style.css  app.js  auth.js  storage.js      메모장 화면
board.html  board.css  board.js  board-store.js         게시판 화면
schema.sql  schema-board.sql                            D1 테이블 정의
_headers                                                보안 헤더 (CSP 등)

lib/
  auth.js          [서버 공용] 세션, 쿠키, 해시, 상수시간 비교, 요청 읽기, id, INSERT 도우미
  memos.js         [서버] 메모 글 검사
  board.js         [서버] 입력 정리, 글 비밀번호, 봇 차단, 도배 제한, 글·댓글 공통 관문

tools/
  hash.html        사이트 비밀번호 → 환경변수 값 생성기 (로컬에서 엽니다)

functions/api/
  _middleware.js   /api/* 앞단. 공개 경로 판정 + 세션 확인
  [[path]].js      처리 못 한 /api 주소를 JSON 404로
  login.js         GET(salt) POST(로그인) DELETE(로그아웃)
  memos.js         GET(목록) POST(생성)
  memos/[id].js    PUT(수정) DELETE(삭제)
  board/
    config.js                사이트 키, 주인 여부, 길이 상한
    posts.js                 GET 목록(쪽 나눔) POST 새 글
    posts/[id].js            GET 상세+댓글+첨부 PUT 수정 DELETE 삭제
    posts/[id]/comments.js   POST 댓글
    posts/[id]/files.js      POST HTML 첨부 (주인만)
    comments/[id].js         DELETE 댓글
    files/[id].js            DELETE 첨부 (주인만)
    files/[id]/raw.js        GET 첨부 내용 (누구나)
```

`auth.js` 가 두 개입니다 — `/auth.js`(브라우저)와 `/lib/auth.js`(서버).
**내용이 서로 다릅니다.** 파일을 옮길 때 하나가 다른 하나를 덮어쓰지 않게 주의하세요.

대괄호(`[id]`, `[[path]]`)는 Pages Functions의 라우트 문법입니다. **파일명을 바꾸면 안 됩니다.**

---

## 고칠 때 알아야 할 것

- **서버 호출은 두 파일에만 모여 있습니다.** 메모는 `storage.js`, 게시판은
  `board-store.js`. 저장 위치를 바꾸려면 이 두 개만 고치면 됩니다.
- **남이 쓴 값은 `textContent` 로만 넣습니다. `innerHTML` 금지.**
- **CSP가 `script-src 'self'`** 라 인라인 `<script>` 와 인라인 `style` 속성이 차단됩니다.
  새 페이지를 만들면 JS와 CSS를 외부 파일로 빼세요.
- **`lib/auth.js` 와 `tools/hash.js` 의 계산은 정확히 일치해야 합니다.**
  한쪽만 바꾸면 로그인이 영구히 실패합니다.
- **`functions/api/board/files/[id]/raw.js` 의 응답 헤더를 손대지 마세요.**
  올라온 HTML을 격리된 출처로 만들어 개인 메모에 닿지 못하게 하는 유일한 장치입니다.
  특히 `allow-same-origin` 을 넣으면 격리가 통째로 풀립니다.
- `_headers` 의 CSP를 **경로별로 쪼개면 안 됩니다.** Pages가 두 벌을 내려보내면
  브라우저가 교집합만 적용해서 사람 확인 위젯이 막힙니다.

### 손보고 싶을 만한 것들

| 하고 싶은 것 | 고칠 곳 |
| --- | --- |
| 색 바꾸기 | `style.css` / `board.css` 맨 위 `:root` 안의 값들 |
| 글꼴 바꾸기 | `index.html` 의 Google Fonts 링크 + `:root` 의 `--ui`, `--text` |
| 본문 폭 넓히기 | `:root` 의 `--col` |
| 탭 이름 바꾸기 | 각 HTML의 `<title>` |
| 글자 수 상한, 도배 제한 | `lib/board.js` 의 `LIMITS`, `RATE` |
