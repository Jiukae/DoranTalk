# 7단계 안내서 — 도란톡: dorantalk.com 연결 + admin@dorantalk.com 메일

> 소요 시간: 약 40분 (기다리는 시간 제외) · 비용: 도메인 1년 약 1만 원(가비아) · 나머지는 무료
>
> 화면 이름은 가끔 바뀌어요. 비슷한 메뉴를 찾거나, 막히면 화면을 캡처해 보여 주세요.

앱 이름은 이미 **도란톡**으로 바꿔 두었어요 (로그인 화면, 위쪽 제목, 홈 화면 아이콘 이름, 초대 문구).
이제 주소를 **https://dorantalk.com** 으로 옮기고, 비밀번호 찾기 메일을 **admin@dorantalk.com** 에서 보내도록 할게요.

| 순서 | 할 일 | 걸리는 시간 |
|---|---|---|
| A | 가비아에서 dorantalk.com 사기 | 10분 |
| B | Netlify에 도메인 연결 (가비아 DNS 설정) | 10분 + 기다림(보통 수십 분, 길면 하루) |
| C | Supabase에 새 주소 알려 주기 | 3분 |
| D | admin@dorantalk.com 으로 메일 보내기 (Resend) | 15분 + 기다림 |
| E | 확인하고 가족에게 새 주소 알리기 | 5분 |

---

## A. 가비아에서 dorantalk.com 사기

1. **https://domain.gabia.com** → 검색창에 `dorantalk` → 검색
2. **dorantalk.com** 오른쪽 **선택**(또는 신청) → **신청하기**
3. 기간은 **1년** (가격 화면에서 **다음 해 연장 가격**도 한 번 봐 두세요)
4. 소유자 정보 입력 화면에서
   - **"WHOIS 정보 공개 대행"** 또는 **"개인정보 보호"** 같은 선택이 있으면 **켜 두세요** (내 이름·연락처가 인터넷에 공개되지 않게)
   - **자동 연장**이 있으면 켜 두면 주소를 실수로 잃지 않아요
5. 결제 → **My가비아 → 서비스 관리 → 도메인** 에 dorantalk.com 이 보이면 완료

---

## B. Netlify에 도메인 연결

### B-1. Netlify에 도메인 추가
1. **https://app.netlify.com** → 도란톡(TalkFeed) 프로젝트 → 왼쪽 **Domain management**
2. **Add a domain** (또는 Add custom domain) → `dorantalk.com` 입력 → **Verify** → **Add domain**
3. "Awaiting External DNS" 같은 표시와 함께 **DNS 설정값**을 보여 줘요. 이 화면은 열어 두세요.

### B-2. 가비아에 DNS 설정 넣기
1. **My가비아 → 서비스 관리 → 도메인** → dorantalk.com 옆 **관리**
2. **DNS 정보** → **도메인 연결** 또는 **DNS 관리툴** → **설정** (또는 **레코드 수정**)
3. 이미 있는 **A 레코드**(가비아 기본 안내 페이지용)가 있으면 **삭제**
4. **레코드 추가**로 아래 2개를 넣고 **저장**

   | 타입 | 호스트 | 값/위치 | TTL |
   |---|---|---|---|
   | **A** | `@` | `75.2.60.5` | 기본값 |
   | **CNAME** | `www` | `talkfeed.netlify.app.` | 기본값 |

   - 값은 **Netlify 화면(B-1의 3번)에 나온 값이 다르면 Netlify 값을 따르세요.**
   - CNAME 값 끝의 점(`.`)은 가비아 화면이 요구할 때만 붙이세요.

### B-3. 기다리기 → 보안 주소(https) 켜기
1. 보통 **10분~몇 시간** 걸려요 (드물게 하루).
2. Netlify **Domain management** 에서 dorantalk.com 옆 경고가 사라지면,
   아래 **HTTPS** 칸에서 **Verify DNS configuration** → **Provision certificate** (자동으로 될 때도 있어요)
3. dorantalk.com 옆 **Options → Set as primary domain** (대표 주소로)
   → 이제 예전 주소(talkfeed.netlify.app)로 들어와도 자동으로 dorantalk.com 으로 옮겨져요
4. 휴대폰에서 **https://dorantalk.com** 이 열리면 성공 🎉

---

## C. Supabase에 새 주소 알려 주기

1. Supabase → **Authentication → URL Configuration**
2. **Site URL**: `https://dorantalk.com` → **Save**
3. **Redirect URLs** → **Add URL** → `https://dorantalk.com/**` → 저장
   (예전 `https://talkfeed.netlify.app/**` 는 그대로 두어도 괜찮아요)

---

## D. admin@dorantalk.com 으로 비밀번호 메일 보내기 (Resend, 무료)

내 도메인으로 메일을 보내려면 "메일 발송 서비스"가 필요해요. **Resend**는 무료 요금제로도 가족 서비스에 충분해요.
(6단계의 Gmail 방법을 이미 했다면, 이걸로 **바꾸는 것**이에요. 둘 중 하나만 쓰면 돼요)

### D-1. Resend에 도메인 등록
1. **https://resend.com** → **Sign up** (Google이나 GitHub로 가입하면 편해요)
2. 왼쪽 **Domains** → **Add Domain** → `dorantalk.com` 입력
   - 지역(Region)을 고르라면 **Tokyo (ap-northeast-1)** (한국에서 가까워요) → **Add**
3. Resend가 **DNS 레코드 3~4개**(MX 1개, TXT 2~3개)를 보여 줘요. 이 화면은 열어 두세요.

### D-2. 가비아에 메일용 DNS 넣기
1. B-2처럼 가비아 **DNS 관리** → **레코드 추가**
2. Resend 화면의 레코드를 **하나씩 그대로** 옮겨요
   - **타입**: MX / TXT (Resend에 나온 대로)
   - **호스트**: Resend의 Name 칸 앞부분만 (예: `send`, `resend._domainkey`, `_dmarc`)
     - 가비아가 뒤에 `.dorantalk.com` 을 알아서 붙여요
   - **값**: Resend의 Value 칸 전체를 복사해 붙여넣기 (TXT 값은 아주 길어요. 끝까지!)
   - **MX 우선순위**: Resend에 나온 숫자(보통 `10`)
3. **저장** → Resend 화면에서 **Verify DNS Records** → 몇 분~몇 시간 뒤 **Verified** 가 되면 완료

### D-3. 메일 보내기용 열쇠(API Key) 만들기
1. Resend 왼쪽 **API Keys** → **Create API Key**
2. 이름 `dorantalk-supabase`, 권한 **Sending access**, 도메인 **dorantalk.com** → **Add**
3. `re_` 로 시작하는 열쇠를 **복사** (이 화면을 닫으면 다시 볼 수 없어요)

> ⛔ 이 열쇠는 **비밀**이에요. 이 대화창이나 GitHub에 절대 붙여넣지 말고, 아래 Supabase 칸에만 넣으세요.

### D-4. Supabase에 넣기
1. Supabase → **Authentication → Emails → SMTP Settings** → **Enable Custom SMTP** 켜기
2. 아래처럼 입력 → **Save changes**

   | 칸 | 넣을 값 |
   |---|---|
   | Sender email address | `admin@dorantalk.com` |
   | Sender name | `도란톡` |
   | Host | `smtp.resend.com` |
   | Port number | `465` |
   | Username | `resend` |
   | Password | D-3에서 복사한 `re_...` 열쇠 |

3. 같은 화면 **Templates → Reset Password** 를 한국어로 (6단계 안내서 B-3의 문구, 제목은 `[도란톡] 비밀번호를 새로 정해 주세요`)

> 참고: `admin@dorantalk.com` 은 **보내기 전용**이에요. 이 주소로 오는 답장을 받으려면 따로 메일함 설정이 필요해요 (필요하면 말씀해 주세요).

---

## E. 확인하고 가족에게 알리기

1. 휴대폰에서 **https://dorantalk.com/#/check** → 5개 모두 초록색 ✓, 맨 아래 **"앱 버전: 도란톡"**
2. 로그아웃 → **비밀번호를 잊으셨나요?** → 메일이 **도란톡 (admin@dorantalk.com)** 에서 오는지 확인 → 버튼 → 새 비밀번호
3. 주소가 바뀌었으니 **한 번 다시 로그인**해야 해요. 홈 화면에 이미 추가했다면 **예전 아이콘은 지우고 새로 추가**해 주세요.
4. 가족에게 새 주소를 보내세요: [가족 초대 문구](family-invite.md) (이미 dorantalk.com 으로 바꿔 두었어요)

---

## 정리 체크리스트

- [ ] A. 가비아에서 dorantalk.com 구매 (WHOIS 공개 대행, 자동 연장)
- [ ] B. Netlify 도메인 추가 → 가비아 A·CNAME 레코드 → HTTPS → 대표 주소 설정
- [ ] C. Supabase Site URL / Redirect URLs 에 dorantalk.com
- [ ] D. Resend 도메인 인증 → API Key → Supabase SMTP → 한국어 메일 양식
- [ ] E. `#/check` 확인, 비밀번호 찾기 메일 시험, 홈 화면 아이콘 다시 추가
