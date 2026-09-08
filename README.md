# 메모 — 배포 가이드

정적 파일 4개짜리 메모장입니다. 빌드 도구도, 설치할 것도 없습니다.

```
index.html    화면 구조
style.css     디자인
storage.js    저장 담당 (나중에 여기만 바꿉니다)
app.js        동작 담당
```

---

## 0. 먼저 열어보기

`index.html`을 더블클릭하면 바로 열립니다. 메모를 몇 개 써보고 새로고침해서 남아 있는지 확인하세요.

지금은 **브라우저에 저장**되기 때문에 이 컴퓨터에서만 보이고, 폰에서는 안 보입니다. 기기 간 동기화는 3단계에서 붙입니다.

---

## 1. GitHub에 올리기

github.com에서 새 저장소를 만듭니다. 이름은 `memo` 정도, **Public/Private 아무거나** 상관없습니다. README나 .gitignore는 추가하지 마세요(비어 있는 상태로).

그다음 이 폴더에서:

```bash
git init
git add .
git commit -m "메모장 첫 버전"
git branch -M main
git remote add origin https://github.com/내계정/memo.git
git push -u origin main
```

`내계정` 부분만 본인 것으로 바꾸면 됩니다. 앞으로는 파일 수정 후 `git add . && git commit -m "설명" && git push` 세 줄이면 배포까지 자동으로 됩니다.

---

## 2. Cloudflare에 연결하기

### 2-1. 도메인을 Cloudflare에 등록

1. Cloudflare 가입 후 **웹사이트 추가** → 가비아에서 산 도메인 입력 → **Free 플랜** 선택
2. Cloudflare가 네임서버 주소 두 개를 알려줍니다 (`xxx.ns.cloudflare.com` 형태). 이 화면을 켜두세요.

### 2-2. 가비아에서 네임서버 변경

My가비아 → **서비스 관리** → 도메인 → 해당 도메인 → **네임서버 설정**에서, 기존 가비아 네임서버를 위 두 주소로 교체합니다.

반영까지 보통 10분~수 시간 걸립니다. Cloudflare 대시보드에서 도메인 상태가 `Active`로 바뀌면 끝난 겁니다. 여기서 조급해하지 말고 그냥 기다리세요.

> 네임서버를 옮기면 이후 DNS 관리는 전부 Cloudflare에서 합니다. 가비아는 도메인 소유권만 계속 유지합니다. 되돌리고 싶으면 언제든 가비아 네임서버로 되돌릴 수 있습니다.

### 2-3. Pages로 배포

1. Cloudflare 대시보드 → **Workers & Pages** → **만들기** → **Pages** → **Git에 연결**
2. GitHub 계정을 연결하고 `memo` 저장소 선택
3. 빌드 설정: **프레임워크 없음**, 빌드 명령어 **비워두기**, 출력 디렉터리도 **비워두기**(루트에 파일이 있으므로)
4. 배포 → `프로젝트명.pages.dev` 주소가 나옵니다. 여기서 먼저 잘 뜨는지 확인하세요.

### 2-4. 내 도메인 붙이기

Pages 프로젝트 → **사용자 지정 도메인** → 도메인 추가 → `memo.내도메인.com` 또는 `내도메인.com` 입력.

DNS 레코드는 Cloudflare가 알아서 만들고, HTTPS 인증서도 자동으로 발급됩니다. 몇 분이면 됩니다.

**여기까지가 1단계입니다.** 내 도메인으로 내 메모장이 뜨면 성공입니다.

---

## 3. 다음 단계 — 기기 간 동기화

폰에서 쓴 메모를 노트북에서 보려면 저장 위치를 브라우저 밖으로 빼야 합니다.

`storage.js`가 그걸 위해 따로 분리돼 있습니다. `list / create / update / remove` 네 함수를 서버 호출로 바꾸기만 하면 되고, **`app.js`는 한 줄도 안 건드립니다.** 모든 함수를 이미 `async`로 만들어 둔 이유가 이것입니다.

바꾼 뒤의 모습은 대략 이렇습니다:

```js
const MemoStore = {
  async list() {
    const res = await fetch('/api/memos');
    return res.json();
  },
  async create(text) {
    const res = await fetch('/api/memos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    return res.json();
  },
  // update, remove도 같은 식
};
```

`/api/memos`는 Cloudflare Workers로 만들고, 데이터는 D1(무료 SQL 데이터베이스)에 넣습니다. 테이블은 이 정도면 충분합니다:

```sql
CREATE TABLE memos (
  id        TEXT PRIMARY KEY,
  text      TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
```

그리고 **주소가 공개돼 있으니 이때 반드시 비밀번호를 붙이세요.** 안 그러면 누구나 내 메모를 읽고 씁니다.

---

## 손보고 싶을 만한 것들

| 하고 싶은 것 | 고칠 곳 |
| --- | --- |
| 색 바꾸기 | `style.css` 맨 위 `:root` 안의 값들 |
| 글꼴 바꾸기 | `index.html`의 Google Fonts 링크 + `:root`의 `--ui`, `--text` |
| 본문 폭 넓히기 | `:root`의 `--col` |
| 탭 이름 바꾸기 | `index.html`의 `<title>` |
