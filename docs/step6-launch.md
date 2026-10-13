# 6단계 안내서 — 앱으로 설치 · 비밀번호 메일 · 가족 초대

> 소요 시간: 20~30분 · 이번 단계도 **SQL 실행은 없어요**

6단계에서 만든 것

- **PWA (홈 화면 앱)**: TalkFeed 아이콘(주황색 집 + 하트)으로 홈 화면에 추가하면 주소창 없이 앱처럼 열려요
  - 인터넷이 약하거나 끊겨도 앱 화면은 열려요 (글·채팅은 인터넷이 돼야 보여요)
  - 홈 화면에 **"📱 휴대폰 홈 화면에 추가하기"** 안내가 떠요 (안드로이드 크롬은 버튼 한 번에 설치)
- **카카오톡으로 받은 링크**: 카카오톡 안에서 열리면 "크롬/사파리로 열기" 버튼이 떠요
- **📖 사용 방법** 화면: 로그인 화면 아래, 내 정보 화면 아래에서 열 수 있어요 (부모님용 큰 글씨 설명)
- **📤 가족에게 TalkFeed 링크 보내기**: 그룹 → 가족 탭 → 버튼을 누르면 카카오톡 등으로 초대 문구 + 링크 보내기
- **보안 강화**: 우리 사이트와 우리 Supabase 주소 외에는 아무것도 불러오지 못하게 막는 보안 머리말(CSP) 추가

---

## A. 내 휴대폰에 먼저 설치해 보기 (5분)

1. 휴대폰에서 **https://talkfeed.netlify.app/#/check** → 맨 아래 **"앱 버전: 6단계"** 확인 (예전 버전이면 창을 닫고 다시 열기)
2. 앱에서 **내 정보 → 📖 사용 방법** 을 열고, 맨 위 **"홈 화면에 앱으로 추가하기"** 를 따라 해 보세요
   - **아이폰**: 사파리 → 공유 버튼(⬆️) → "홈 화면에 추가" → "추가"
   - **갤럭시**: 크롬 → 오른쪽 위 ⋮ → "홈 화면에 추가" 또는 "앱 설치" → "설치"
3. 홈 화면의 **TalkFeed 아이콘**을 눌러 열기 → 주소창 없이 앱처럼 열리면 성공!
   (처음 한 번은 다시 로그인해야 할 수 있어요. 아이폰은 홈 화면 앱과 사파리가 로그인을 따로 기억해요)

---

## B. (추천) 비밀번호 찾기 메일 켜기 — Gmail로 보내기 (15분)

지금은 Supabase 기본 메일이라 **가족에게 비밀번호 찾기 메일이 가지 않아요** (2단계에서 설명).
Gmail 계정으로 메일을 보내도록 설정하면 가족 누구나 "비밀번호를 잊으셨나요?"를 쓸 수 있어요.

> 💡 개인 Gmail 대신 **TalkFeed 전용 Gmail**(예: `kimfamily.talkfeed@gmail.com`)을 새로 만들어 쓰는 걸 추천해요.

### B-1. Gmail "앱 비밀번호" 만들기
1. 컴퓨터에서 메일을 보낼 Gmail로 로그인 → **https://myaccount.google.com** → 왼쪽 **보안**
2. **2단계 인증** 이 꺼져 있으면 눌러서 켜기 (휴대폰 번호 인증)
3. **https://myaccount.google.com/apppasswords** 에 들어가기
4. 앱 이름에 `TalkFeed` 입력 → **만들기**
5. 노란 상자에 나온 **16자리 비밀번호**를 메모장에 복사 (띄어쓰기는 빼도 돼요)

> ⛔ 이 16자리는 **비밀번호**예요. 이 대화창이나 GitHub에 절대 붙여넣지 마세요. 아래 Supabase 설정 칸에만 넣어요.

### B-2. Supabase에 메일 설정 넣기
1. Supabase → **Authentication** → **Emails** → 위쪽 **SMTP Settings** 탭
   (화면에 따라 "Set up custom SMTP" 버튼 → **Enable Custom SMTP** 스위치 켜기)
2. 아래처럼 입력 → **Save changes**

   | 칸 | 넣을 값 |
   |---|---|
   | Sender email address | 메일을 보낼 Gmail 주소 |
   | Sender name | `TalkFeed` |
   | Host | `smtp.gmail.com` |
   | Port number | `465` |
   | Username | 메일을 보낼 Gmail 주소 |
   | Password | B-1의 16자리 앱 비밀번호 |

### B-3. 비밀번호 찾기 메일을 한국어로 (이제 수정 가능!)
1. 같은 **Emails** 화면 → **Templates** 탭 → **Reset Password** (또는 "Reset password")
2. **Subject**: `[TalkFeed] 비밀번호를 새로 정해 주세요`
3. **Body**: 내용을 모두 지우고 아래를 붙여넣기 → **Save changes**
   ```html
   <h2>TalkFeed 비밀번호 재설정</h2>
   <p>아래 버튼을 누르면 새 비밀번호를 정할 수 있어요.</p>
   <p><a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:14px 24px;background:#c9581f;color:#ffffff;border-radius:12px;text-decoration:none;font-weight:bold;font-size:18px">새 비밀번호 정하기</a></p>
   <p>직접 요청하지 않았다면 이 메일은 무시하셔도 괜찮아요.</p>
   ```

### B-4. 시험해 보기
1. 2단계에서 넣은 **Authentication → URL Configuration** 이 그대로인지 확인
   (Site URL `https://talkfeed.netlify.app`, Redirect URLs `https://talkfeed.netlify.app/**`)
2. 앱에서 로그아웃 → **비밀번호를 잊으셨나요?** → 가입한 이메일 → **재설정 메일 받기**
3. 메일함(스팸함도)에서 **"새 비밀번호 정하기"** 버튼 → 앱이 열리고 새 비밀번호를 정하면 성공!

### (메일 설정을 안 할 때) 관리자가 직접 비밀번호 바꿔 주기
Supabase → **SQL Editor** 에서 아래를 실행하면 그 가족의 비밀번호가 바뀌어요.
이메일과 임시 비밀번호만 바꿔서 실행하고, 가족에게 임시 비밀번호를 알려 준 뒤 **내 정보에서 바꾸도록** 부탁하세요.
```sql
update auth.users
set encrypted_password = extensions.crypt('임시비밀번호123', extensions.gen_salt('bf'))
where email = '가족이메일@example.com';
```

---

## C. 가족 초대하기

**순서**: ① 가족에게 링크 보내기 → ② 가족이 가입 → ③ 닉네임 받기 → ④ 앱에서 초대 → ⑤ 가족이 수락

1. 앱 → 그룹 → **가족** 탭 → **📤 가족에게 TalkFeed 링크 보내기** → 카카오톡 → 가족 대화방 선택
   (컴퓨터에서는 문구가 복사돼요. 카카오톡에 붙여넣기)
   - 직접 보내고 싶다면 [가족 초대 문구](family-invite.md)를 복사해서 쓰세요
2. 가족이 가입하고 닉네임을 알려 주면 → **가족** 탭에서 닉네임으로 **초대 보내기**
3. 가족 휴대폰 홈 화면에 **📩 받은 초대** → **수락하기**
4. 부모님 휴대폰은 가능하면 **직접 옆에서** 홈 화면에 추가해 드리세요 (내 정보 → 📖 사용 방법)

---

## D. 알아 두면 좋은 것 (무료 요금제 기준, 2026년 10월)

요금제 내용은 바뀔 수 있어요. 문제가 생기면 각 사이트의 **Usage(사용량)** 화면을 확인하세요.

| 서비스 | 주의할 점 | 대처 |
|---|---|---|
| Supabase | **7일 동안 아무도 안 쓰면 일시정지** | Supabase 홈에서 **Restore project** 누르기 |
| Supabase | 사진 저장 공간 약 **1GB** (사진 한 장 약 0.3~0.6MB → 대략 2,000~3,000장) | Supabase → Project Settings → Usage 에서 확인. 가득 차면 유료(Pro) 전환 고려 |
| Netlify | 한 달 사용량 한도가 있어요 (가족끼리는 보통 충분) | Netlify → 프로젝트 → Usage 확인 |

- 앱 주소: **https://talkfeed.netlify.app** — 이 주소를 가족에게 알려 주면 돼요
- 지금은 Netlify가 작업 브랜치(`claude/talkfeed-family-app-qyi292`)를 그대로 올리고 있어요. 이대로 써도 괜찮아요.
  나중에 `main` 브랜치로 정리하고 싶으면 말씀해 주세요 (Pull Request를 만들어 드릴게요).

---

## 정리: 6단계에서 직접 하실 일 체크리스트

- [ ] A. `#/check` 에서 "앱 버전: 6단계" 확인 → 내 휴대폰 홈 화면에 추가
- [ ] B. (추천) Gmail 앱 비밀번호 → Supabase SMTP 설정 → 한국어 메일 양식 → 비밀번호 찾기 시험
- [ ] C. 가족에게 링크 보내고 초대하기
