# 1단계 안내서 — Supabase 준비하기

> 소요 시간: 약 15~20분 · 준비물: 컴퓨터(휴대폰보다 컴퓨터가 훨씬 편해요), GitHub 계정
>
> Supabase 화면은 가끔 바뀌어서 버튼 이름이나 위치가 조금 다를 수 있어요.
> 비슷한 이름의 버튼을 찾거나, 막히면 화면을 캡처해서 보여 주세요.

Supabase는 TalkFeed의 **서버 겸 창고**예요. 회원 정보, 글, 채팅, 사진이 모두 여기에 저장돼요.
무료 요금제로 가족끼리 쓰기에는 충분해요.

---

## A. Supabase 가입 + 프로젝트 만들기

1. 인터넷 브라우저(크롬 추천)에서 **https://supabase.com** 에 들어갑니다.
2. 오른쪽 위 **Start your project** (또는 **Sign in**) 버튼을 누릅니다.
3. **Continue with GitHub** 를 누르고, GitHub 로그인 후 **Authorize supabase** 를 누릅니다.
4. 처음이면 **조직(Organization) 만들기** 화면이 나와요.
   - Name: `우리가족` (아무거나 괜찮아요)
   - Type: **Personal**
   - Plan: **Free - $0/month**
   - **Create organization** 클릭
5. 이어서 **새 프로젝트(Create a new project)** 화면이 나와요.
   - Project name: `talkfeed`
   - Database Password: **Generate a password** 를 눌러 자동 생성 →
     옆의 복사 버튼을 눌러 메모장 등 안전한 곳에 저장해 두세요.
     (앱에는 쓰지 않지만, 나중에 필요할 수 있어요. **저한테 보내지 마세요.**)
   - Region: **Northeast Asia (Seoul)** — 한국에서 가장 빨라요
   - 그 밖의 옵션(Security options 등)은 **기본값 그대로** 두세요.
   - **Create new project** 클릭
6. 1~2분 정도 "Setting up project" 화면이 나오고, 끝나면 프로젝트 홈 화면이 열려요.

> 💡 무료 프로젝트는 **7일 동안 아무도 안 쓰면 일시정지(Paused)** 돼요.
> 가족이 매일 쓰면 문제없고, 멈추면 Supabase 홈에서 **Restore project** 를 누르면 다시 켜져요.

---

## B. 데이터베이스 설정(SQL) 실행하기

TalkFeed에 필요한 표(회원·그룹·글·댓글·채팅 등)와 **보안 규칙**을 한 번에 만드는 작업이에요.

### B-1. SQL 파일 내용 복사하기
1. GitHub에서 이 저장소(**Jiukae/TalkFeed**)를 엽니다.
2. 왼쪽 위의 브랜치 선택 버튼(`main` 이라고 써 있을 수 있음)을 눌러
   **claude/talkfeed-family-app-qyi292** 를 고릅니다.
3. **supabase** 폴더 → **schema.sql** 파일을 누릅니다.
4. 파일 내용 오른쪽 위에 있는 **복사 아이콘(Copy raw file, 네모 두 개 겹친 모양)** 을 누릅니다.
   → 파일 전체가 복사됐어요.

### B-2. Supabase에서 실행하기
1. Supabase 프로젝트 화면 **왼쪽 메뉴**에서 **SQL Editor** (`>_` 모양 아이콘)를 누릅니다.
   - 메뉴가 아이콘만 보이면, 아이콘 위에 마우스를 올리면 이름이 나와요.
2. 위쪽의 **+ (New query)** 또는 **New SQL snippet** 을 누릅니다.
3. 가운데 큰 입력칸을 한 번 클릭하고 **Ctrl + V** (맥은 **⌘ + V**)로 붙여넣습니다.
4. 오른쪽 아래 초록색 **Run** 버튼을 누릅니다. (단축키 Ctrl + Enter)
   > ⚠️ **Run 누르기 전에 입력칸을 한 번 클릭**해서, 파랗게 칠해진(선택된) 글자가 없게 해 주세요.
   > 일부만 칠해져 있으면 Supabase는 **그 부분만** 실행해서 `syntax error at end of input` 오류가 나요.
5. "이 쿼리는 위험한 작업이 포함되어 있어요(destructive operation)" 같은 경고 창이 뜨면
   → **Run this query** 를 누르세요.
   (이전 규칙을 지우고 새로 만드는 부분 때문에 뜨는 경고라 괜찮아요.)
6. 아래 결과 칸에 **Success. No rows returned** 가 보이면 성공! 🎉

### B-3. 잘 만들어졌는지 눈으로 확인 (선택)
- 왼쪽 메뉴 **Table Editor** → 표 9개가 보여야 해요:
  `chat_reads, comments, family_groups, group_invitations, group_members, messages, post_likes, posts, profiles`
- 왼쪽 메뉴 **Storage** → `family-photos` 라는 사진 창고가 보이고, **Private**(비공개)로 표시돼요.

> 오류가 나면: 빨간 오류 문구를 캡처해서 보여 주세요. 같은 SQL을 여러 번 실행해도 안전하게 만들어 두었어요.

---

## C. 주소와 "공개 키" 복사해서 알려 주기

앱이 Supabase에 접속하려면 **프로젝트 주소**와 **공개 키** 두 가지가 필요해요.

### C-1. 프로젝트 주소(URL)
1. 프로젝트 화면 맨 위쪽의 **Connect** 버튼을 누르거나,
   왼쪽 아래 **톱니바퀴(Project Settings)** → **Data API** (또는 **API**) 메뉴로 갑니다.
2. **Project URL** 칸의 주소를 복사합니다.
   모양: `https://abcdefghijklmn.supabase.co`

### C-2. 공개 키 (publishable 또는 anon)
1. 왼쪽 아래 **톱니바퀴(Project Settings)** → **API Keys** 를 누릅니다.
2. **Publishable key** 칸의 키를 복사합니다. 모양: `sb_publishable_...`
   - 이 칸이 없으면 **Legacy API Keys** 탭에서 **anon / public** 키(`eyJ...` 로 시작하는 긴 글자)를 복사하세요.

### C-3. 저에게 보내 주기
이 대화창에 아래처럼 붙여넣어 주세요. 제가 `js/config.js` 에 넣어 드릴게요.

```
URL: https://abcdefghijklmn.supabase.co
공개 키: sb_publishable_xxxxxxxx
```

> ✅ **보내도 되는 것**: Project URL, Publishable key(`sb_publishable_`), anon key
> 이 키는 원래 앱 안에 들어가서 누구나 볼 수 있는 키예요. 대신 아까 실행한 **보안 규칙(RLS)** 이
> "가족이 아니면 아무것도 못 보게" 막아 줘요.
>
> ⛔ **절대 보내거나 어디에도 붙여넣지 말 것**:
> **Secret key(`sb_secret_`)**, **service_role** 키, Database Password
> 이 키들은 보안 규칙을 무시하는 "만능 열쇠"예요. 혹시 실수로 넣어도 앱이 감지해서 멈추도록 만들어 두었어요.

---

## D. (추천) 휴대폰으로 확인할 수 있는 미리보기 사이트 연결하기

원래 배포는 6단계지만, **지금 미리 연결해 두면 단계가 끝날 때마다 휴대폰으로 바로 확인**할 수 있어요.
한 번만 해 두면, 제가 코드를 올릴 때마다 사이트가 자동으로 새로 만들어져요.

1. **https://app.netlify.com/signup** 에 들어가서 **Sign up with GitHub** → GitHub 로그인 → 권한 허용.
   (처음 가입하면 몇 가지 질문이 나오는데, 개인용(Personal)으로 고르고 넘어가면 돼요.)
2. 대시보드에서 **Add new project** (또는 **Add new site**) → **Import an existing project** 를 누릅니다.
3. **Deploy with GitHub** (GitHub 버튼)를 누르고, 권한 창이 뜨면 **Jiukae/TalkFeed** 저장소를 허용합니다.
4. 저장소 목록에서 **TalkFeed** 를 고릅니다.
5. 설정 화면에서:
   - **Branch to deploy**: `claude/talkfeed-family-app-qyi292` 로 바꿔 주세요. ← 중요!
   - Build command: **비워 두기**
   - Publish directory: **비워 두기** (저장소의 설정 파일 `netlify.toml` 이 알아서 정해 줘요)
   - Project name(사이트 이름): 영어 소문자·숫자·`-`로 원하는 이름을 정할 수 있어요. (우리 앱은 `talkfeed` 로 정했어요)
6. **Deploy** 버튼을 누릅니다. 1분 정도 지나면 `https://프로젝트이름.netlify.app` 주소가 생겨요.
7. 그 주소를 휴대폰으로 열어 보세요.
   - 제가 키를 넣기 **전**: "설정 파일" 항목에 빨간 ! 가 보이면 정상이에요.
   - 제가 키를 넣은 **후**: 세 항목 모두 초록색 ✓ 이면 **1단계 완료**!

Netlify 주소도 저에게 알려 주시면, 앞으로 안내할 때 그 주소를 기준으로 설명할게요.

---

## 정리: 1단계에서 직접 하실 일 체크리스트

- [ ] A. Supabase 가입 + `talkfeed` 프로젝트 만들기 (지역: Seoul)
- [ ] B. `schema.sql` 을 SQL Editor에서 실행 → "Success" 확인
- [ ] C. Project URL + 공개 키(publishable/anon)를 대화창에 보내기
- [ ] D. (추천) Netlify에 저장소 연결 → 미리보기 주소 받기
