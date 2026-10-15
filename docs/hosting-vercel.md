# 사이트 올리는 곳 옮기기 — Netlify → Vercel (무료)

> 소요 시간: 약 15분 + DNS 기다림(보통 10분~1시간) · 비용: 무료 (Vercel Hobby)
>
> 화면 이름은 가끔 바뀌어요. 비슷한 메뉴를 찾거나, 막히면 화면을 캡처해 보여 주세요.

## 왜 옮기나요?
- Netlify 무료 요금제는 **한 달에 쓸 수 있는 크레딧**이 정해져 있고, 새 버전을 올릴 때마다 크레딧이 들어요.
  이번 달 몫을 다 써서 **새 버전이 올라가지 않는 상태**예요. (사이트 자체는 예전 버전으로 계속 열려요)
- **Vercel** 무료 요금제(Hobby)는 새 버전을 올리는 횟수에 크레딧이 들지 않아요. (하루 100번까지)
- 가족 앱처럼 **돈을 벌지 않는 개인 용도**는 무료로 써도 돼요.

## 바뀌지 않는 것
- 주소 **dorantalk.com** 그대로, 가족들 휴대폰의 **홈 화면 앱도 그대로** 써요.
- **Supabase**(글 · 채팅 · 사진 · 로그인), **메일**(Resend · ImprovMX)은 아무것도 안 바꿔요.
- 보안 설정(CSP 등)은 `vercel.json` 에 똑같이 옮겨 두었어요.

| 순서 | 할 일 | 걸리는 시간 |
|---|---|---|
| A | Vercel 가입 (GitHub로) | 3분 |
| B | 도란톡 가져와서 올리기 | 3분 |
| C | Vercel에 dorantalk.com 연결 | 2분 |
| D | 가비아 DNS 2줄 바꾸기 | 5분 + 기다림 |
| E | 확인 | 2분 |
| F | (선택) Netlify 정리 | 1분 |

---

## A. Vercel 가입
1. **https://vercel.com/signup** 에 들어가요.
2. **Hobby** (I'm working on personal projects) 를 고르고, 이름 칸에 아무 이름(예: `jiukae`) → **Continue**
3. **Continue with GitHub** → GitHub 로그인 → **Authorize Vercel** (허용)

## B. 도란톡 가져와서 올리기
1. Vercel 첫 화면 오른쪽 위 **Add New…** → **Project**
2. **Import Git Repository** 목록에서 **DoranTalk** 옆 **Import**
   - 목록에 없으면: 아래쪽 **Adjust GitHub App Permissions**(또는 Configure GitHub App) →
     **Only select repositories** → **Jiukae/DoranTalk** 선택 → **Save** → 다시 Vercel 화면으로
3. 설정 화면에서
   - **Project Name**: `dorantalk`
   - **Framework Preset**: **Other**
   - **Root Directory**: 그대로 (`./`)
   - **Build and Output Settings**, **Environment Variables**: **아무것도 바꾸지 않아요** (비밀 키도 넣지 않아요)
4. **Deploy** → 30초쯤 뒤 축하 화면(🎉 Congratulations)이 나오면 성공
5. **Continue to Dashboard** → 화면의 **Domains** 아래 주소(예: `dorantalk.vercel.app`)를 눌러
   도란톡 로그인 화면이 나오는지 확인
   - 그 주소 뒤에 `#/check` 를 붙여 열면 맨 아래 **앱 버전: 도란톡 · … · 알림3** 이 보여야 해요.

## C. Vercel에 dorantalk.com 연결
1. Vercel 프로젝트 → 위쪽 **Settings** → 왼쪽 **Domains**
2. **Add Domain** → `dorantalk.com` 입력 → **Add**
   - "www.dorantalk.com 도 추가할까요?(Redirect)" 같은 선택이 나오면 **추천(Recommended)** 그대로 → **Add**
3. 도메인 옆에 빨간 **Invalid Configuration** 과 함께 **넣어야 할 DNS 값**이 나와요. 이 화면은 열어 두세요.
   - 보통 이렇게 나와요 (화면에 나온 값이 다르면 **화면 값을 따르세요**):

   | 타입 | 호스트(Name) | 값(Value) |
   |---|---|---|
   | A | `@` | `76.76.21.21` |
   | CNAME | `www` | `cname.vercel-dns.com` |

## D. 가비아 DNS 바꾸기 (2줄만!)
1. **My가비아 → 서비스 관리 → 도메인** → dorantalk.com **관리** → **DNS 정보** → **DNS 관리툴** → **설정**
2. 지금 있는 줄 중에서 **딱 두 줄만** 고쳐요:

   | 타입 | 호스트 | 지금 값 (Netlify) | 바꿀 값 (Vercel, C-3 화면) |
   |---|---|---|---|
   | **A** | `@` | `75.2.60.5` | `76.76.21.21` (화면 값) |
   | **CNAME** | `www` | `…netlify.app.` | `cname.vercel-dns.com.` (화면 값) |

   - 각 줄 오른쪽 **수정** → 값만 바꾸기 → **확인**
   - CNAME 값 끝의 점(`.`)은 가비아 화면이 요구할 때만 붙이세요. (7단계 때와 같아요)
3. ⚠️ **나머지 줄은 절대 지우거나 바꾸지 마세요.**
   (MX `mx1/mx2.improvmx.com`, TXT `v=spf1 …`, `send`, `resend._domainkey`, `_dmarc` — 메일용이에요)
4. **저장**
5. 기다리기: 보통 **10분~1시간** (길면 하루). Vercel Domains 화면에서 dorantalk.com 옆이
   초록색 **Valid Configuration** 으로 바뀌면 끝 (보안 주소 https 인증서도 Vercel이 자동으로 만들어요)

## E. 확인
1. 컴퓨터에서 **https://dorantalk.com/#/check** → **F5(새로고침)**
   - 맨 아래 **앱 버전**이 **"… · 알림3"** 이면 Vercel에서 열리고 있는 거예요.
   - 모든 항목 초록색 (맨 아래 "휴대폰 알림 서버 (선택)"은 9단계 전이라 **?** 여도 괜찮아요)
2. 휴대폰: 도란톡을 **완전히 닫았다가** 다시 열기 → 내 정보 맨 아래 앱 버전 확인
3. 로그인 · 글쓰기 · 채팅 · 사진이 평소처럼 되는지 한 번씩
4. **https://dorantalk.com/#/push-setup** 이 열리면 → 이제 **9단계(알림)** 를 이어서 할 수 있어요.

> 바뀌는 동안(DNS가 퍼지는 동안)에는 어떤 휴대폰은 예전 사이트, 어떤 휴대폰은 새 사이트를 볼 수 있어요.
> 둘 다 같은 Supabase를 쓰니까 글 · 채팅은 그대로 이어져요. 하루 안에 모두 새 사이트로 바뀌어요.

## F. (선택) Netlify 정리
dorantalk.com 이 Vercel에서 잘 열리면, Netlify가 더 이상 크레딧을 쓰지 않게 멈춰 둬요.
1. **app.netlify.com** → 도란톡 사이트 → **Site configuration** → **Build & deploy** → **Continuous deployment**
2. **Stop builds** (또는 Build settings → Configure → **Stop builds**) → 확인
3. 사이트를 지우지는 않아도 돼요. (예전 주소 talkfeed.netlify.app 은 예전 버전 그대로 남아요)

---

## 앞으로는
- 제가 고친 것을 GitHub에 올리면 **Vercel이 1분 안에 자동으로** dorantalk.com 에 반영해요.
- 앱이 새 버전을 알아서 받아요(앱으로 돌아올 때 확인 → 다음 화면 이동 때 적용).

## 체크리스트
- [ ] A. Vercel 가입 (Hobby, GitHub로)
- [ ] B. DoranTalk Import → Framework: Other → Deploy → `….vercel.app/#/check` 에서 앱 버전 "알림3"
- [ ] C. Settings → Domains → dorantalk.com 추가 → DNS 값 확인
- [ ] D. 가비아: A `@` 와 CNAME `www` 두 줄만 Vercel 값으로 → Valid Configuration
- [ ] E. dorantalk.com/#/check 앱 버전 "알림3", #/push-setup 열림
- [ ] F. (선택) Netlify Stop builds
