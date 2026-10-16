# admin@dorantalk.com 을 Outlook(윈도우 · 새 Outlook)에서 쓰기 — IMAP

> 소요 시간: 약 15분 · 비용: 무료
>
> 화면 이름은 가끔 바뀌어요. 비슷한 메뉴를 찾거나, 막히면 화면을 캡처해 보여 주세요. (비밀번호 · 키가 보이는 부분은 가리고!)

## 어떻게 연결되나요?
admin@dorantalk.com 은 메일함이 따로 없는 **전달 주소**예요. (8단계 ImprovMX)
그래서 Outlook에는 이렇게 연결해요.

| 하는 일 | 연결하는 곳 | 사용자 이름 | 비밀번호 |
|---|---|---|---|
| **받기** (IMAP) | 전달된 메일이 쌓이는 지메일 `imap.gmail.com` | `gjiukae@gmail.com` | 지메일 **앱 비밀번호** (A에서 만들기) |
| **보내기** (SMTP) | 비밀번호 메일을 보내는 Resend `smtp.resend.com` | `resend` | Resend **API 키** (B에서 만들기) |

- Outlook에서 답장하면 받는 사람에게 **도란톡 &lt;admin@dorantalk.com&gt;** 으로 보여요.
- ⚠️ Outlook 받은편지함에는 **gjiukae@gmail.com 으로 오는 메일이 모두** 보여요. (admin@ 문의 메일도 여기로 전달되니까요)

| 순서 | 할 일 | 걸리는 시간 |
|---|---|---|
| A | 지메일 앱 비밀번호 만들기 | 5분 |
| B | Resend API 키 만들기 | 2분 |
| C | 새 Outlook에 계정 추가 | 5분 |
| D | 시험하기 | 3분 |

---

## A. 지메일 앱 비밀번호 만들기 (gjiukae@gmail.com)
Outlook 같은 다른 프로그램이 지메일을 열 때 쓰는 **전용 비밀번호**예요. 지메일 비밀번호를 그대로 쓰는 것보다 안전해요.

1. 컴퓨터 크롬에서 **gjiukae@gmail.com** 으로 로그인한 상태로 **https://myaccount.google.com/security** 를 열어요.
   - 오른쪽 위 동그라미(프로필)를 눌러 **gjiukae@gmail.com** 이 맞는지 꼭 확인!
2. **2단계 인증**이 **사용 중**인지 봐요.
   - 꺼져 있으면 눌러서 켜요. (휴대폰 번호 확인 → 사용 설정) — 앱 비밀번호는 2단계 인증이 켜져 있어야 만들 수 있어요.
3. **https://myaccount.google.com/apppasswords** 를 열어요. (구글 비밀번호를 한 번 더 물어볼 수 있어요)
4. **앱 이름** 칸에 `Outlook` → **만들기**
5. 노란 상자에 **16자리 비밀번호**(예: `abcd efgh ijkl mnop`)가 나와요.
   - ⛔ 이 창은 **닫지 말고** 열어 두세요. 닫으면 다시 볼 수 없어요. (그때는 지우고 새로 만들면 돼요)
   - ⛔ 이 비밀번호는 대화창 · GitHub · 카톡 어디에도 붙여넣지 마세요. **Outlook에만** 넣어요.

> 지메일의 IMAP은 따로 켤 필요가 없어요. (지메일 설정에 "IMAP 사용" 항목이 보이면 **사용**으로)

## B. Resend API 키 만들기 (Outlook 전용)
1. **https://resend.com** 로그인 → 왼쪽 **API Keys** → **Create API Key**
2. 이렇게 입력 → **Add**
   - **Name**: `outlook`
   - **Permission**: **Sending access**
   - **Domain**: `dorantalk.com`
3. 나온 키(`re_` 로 시작)를 **Copy** — 이 창도 열어 두세요. (다시 볼 수 없어요)
   - ⛔ 이 키도 **Outlook에만** 넣어요.
   - 8단계에서 지메일용(`gmail`) 키를 만들었어도, 따로 만드는 게 좋아요. 나중에 하나만 끌 수 있어요.

## C. 새 Outlook에 계정 추가
1. **Outlook (new)** 를 열어요.
2. 오른쪽 위 **⚙️ (설정)** → 왼쪽 **계정** → **전자 메일 계정** → **+ 계정 추가**
3. 이메일 주소에 `admin@dorantalk.com` → **계속**
4. 계정 종류(공급자)를 고르라고 나오면 **IMAP** 선택
   - "Microsoft 클라우드와 동기화" 안내가 나오면 **계속** (새 Outlook은 지메일 같은 계정을 이렇게 연결해요)
5. **자세한 설정 표시**(또는 고급 설정 · Show more)를 눌러 칸이 여러 개 나오게 한 뒤, 아래처럼 넣어요.

   **받기 (IMAP)**
   | 칸 | 넣을 값 |
   |---|---|
   | 표시 이름 | `도란톡` |
   | IMAP 사용자 이름 | `gjiukae@gmail.com` |
   | IMAP 암호 | A의 **16자리 앱 비밀번호** (띄어쓰기 없이 붙여서) |
   | IMAP 수신 서버 | `imap.gmail.com` |
   | 포트 | `993` |
   | 보안 연결 유형 | **SSL/TLS** |

   **보내기 (SMTP)**
   | 칸 | 넣을 값 |
   |---|---|
   | SMTP 사용자 이름 | `resend` |
   | SMTP 암호 | B의 **`re_` 키** |
   | SMTP 발신 서버 | `smtp.resend.com` |
   | 포트 | `465` |
   | 보안 연결 유형 | **SSL/TLS** |

6. **계속** → 잠시 기다리면 왼쪽 목록에 **admin@dorantalk.com** 이 생겨요. 🎉
7. A · B 에서 열어 둔 창은 이제 닫아도 돼요.

## D. 시험하기
1. **평소 쓰는 다른 메일**(네이버 · 다른 지메일 등)에서 `admin@dorantalk.com` 으로 "시험" 메일 보내기
2. 1~2분 뒤 Outlook 받은편지함에 오면 **받기 성공**
3. 그 메일에 Outlook에서 **회신** → 다른 메일함에 **도란톡 &lt;admin@dorantalk.com&gt;** 으로 도착하면 **보내기 성공**
   - 스팸함도 확인해 보세요. 처음 몇 번은 스팸으로 갈 수 있어요. ("스팸 아님"으로 표시)
4. (확인) **resend.com → Emails** 에 방금 보낸 메일이 **Delivered** 로 보여요.

---

## 안 될 때
| 증상 | 해결 |
|---|---|
| 앱 비밀번호 화면에 "사용할 수 없는 설정" | 2단계 인증이 꺼져 있어요 → A-2 먼저 |
| 받기 오류 (IMAP 연결 실패) | 사용자 이름이 `gjiukae@gmail.com` 전체인지, 앱 비밀번호를 **띄어쓰기 없이** 넣었는지 확인. 그래도 안 되면 앱 비밀번호를 지우고 새로 만들기 |
| 보내기 오류 (SMTP) | 사용자 이름이 정확히 `resend` 인지, 키 권한이 **Sending access** · 도메인 **dorantalk.com** 인지 확인. 그래도 안 되면 포트 `587` + **StartTLS** 로 바꿔 보기 |
| 지메일 비밀번호를 바꾼 뒤 갑자기 안 됨 | 구글이 앱 비밀번호를 자동으로 지워요 → A를 다시 해서 Outlook 계정 설정의 IMAP 암호만 바꾸기 |

## 알아 두기
- **보내기 한도**: Resend 무료는 **하루 100통 · 한 달 3,000통**이고, 가입 인증 · 비밀번호 찾기 메일과 **합쳐서** 세요. 문의 답장 정도는 충분해요.
- **보안**: 노트북을 잃어버리거나 비밀번호가 새었다고 느끼면
  - 지메일: https://myaccount.google.com/apppasswords 에서 `Outlook` **삭제**
  - Resend: **API Keys** 에서 `outlook` 키 **삭제**
  - (도란톡 앱 · 가족 데이터와는 상관없는 키들이에요)
- 문의 메일은 법에서 "지체 없이" 처리하라고 해요. 보통 **10일 안에** 답하면 돼요. (8단계)

## 체크리스트
- [ ] A. gjiukae@gmail.com 2단계 인증 → 앱 비밀번호(Outlook) 만들기
- [ ] B. Resend API 키(outlook · Sending access · dorantalk.com) 만들기
- [ ] C. 새 Outlook → 계정 추가 → IMAP → 받기 imap.gmail.com:993 / 보내기 smtp.resend.com:465
- [ ] D. 다른 메일 → admin@ 로 보내기 → Outlook에서 받기 → 회신이 admin@ 로 도착
