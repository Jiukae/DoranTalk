# 21단계 안내서 — 크롬 없이 도는 도란톡 앱 (버전 2) + Firebase 알림

> 소요 시간: 약 30분 (컴퓨터 추천) · 비용: 무료 · 필요한 것: 엄마 구글 계정, 14단계 업로드 키 파일과 비밀번호

## 바뀌는 것
- 앱이 **크롬 없이 직접** 실행돼요.
  - 알림창의 **"Chrome에서 실행 중"** 이 사라져요.
  - 휴대폰에 크롬이 없거나 **사용 중지**돼 있어도 도란톡이 열려요.
- 알림은 **Firebase**(구글의 무료 알림 서비스)로 받아요. 지금처럼 카카오톡같이 **위에 팝업**으로 떠요.
- 사진 · 동영상 올리기(카메라로 바로 찍기 포함), 사진 길게 눌러 저장, 한 달 사진 압축 파일 저장(다운로드 → DoranTalk)도 앱이 직접 해요.
- 새 앱은 지금 앱 **위에 덮어 설치**돼요. (지우지 않아도 돼요 — 같은 업로드 키로 서명하니까요)
- 처음 한 번은 앱에서 **다시 로그인**해요. (크롬과 로그인 정보를 같이 쓰지 않아서)

## 순서 한눈에
| | 할 일 | 어디서 |
|---|---|---|
| 1 | 데이터베이스 업데이트 (`v14_to_v15.sql` 안 했으면 그것부터, 그다음 `v15_to_v16.sql`) | Supabase SQL Editor |
| 2 | Firebase 프로젝트 만들기 → `google-services.json` 받기 | Firebase |
| 3 | Firebase 서비스 계정 열쇠 → Supabase Secrets `FCM_SERVICE_ACCOUNT` | Firebase → Supabase |
| 4 | 알림 서버 전용 열쇠 `PUSH_DB_KEY` · `push_db_key` (20단계 할 일 3, **이번엔 꼭**) | Supabase |
| 5 | 알림 서버(push) 새 코드 다시 올리기 | Supabase |
| 6 | 업로드 키를 GitHub Secrets 에 넣기 (앱 서명용) | GitHub |
| 7 | `google-services.json` 을 Claude 에게 보내기 → Claude 가 새 앱(APK)을 만들어 사이트에 올려요 | 대화창 |
| 8 | 확인: 새 앱 설치 → 알림 켜기 → 시험 알림 | 휴대폰 |

## 1. 데이터베이스 업데이트
1. 아직 20단계의 `v14_to_v15.sql` 을 안 했다면 그것부터 같은 방법으로 해요.
2. GitHub → **supabase → updates → v15_to_v16.sql** → 📋 전체 복사
3. Supabase → **SQL Editor** → **+ New query** → 붙여넣기 → **Run**
4. **"업데이트 완료! 버전 16"** → 연결 점검(**#/check**) "최신 버전(16)"

## 2. Firebase 프로젝트 만들기
1. 컴퓨터에서 **https://console.firebase.google.com** → **엄마 구글 계정**으로 로그인
2. **프로젝트 만들기**(또는 "시작하기") → 이름 `dorantalk` → **계속**
3. **Google 애널리틱스** 는 **끄기** → **프로젝트 만들기** → 다 되면 **계속**
4. 프로젝트 첫 화면 가운데의 **안드로이드 모양 아이콘**(앱 추가 → Android)
5. **Android 패키지 이름**: `com.dorantalk.app` ← **정확히 이 글자** · 앱 닉네임: `도란톡` · 디버그 서명 인증서(SHA-1)는 **비워 두기** → **앱 등록**
6. **google-services.json 다운로드** → 저장
7. 다음 단계("Firebase SDK 추가")는 Claude 가 이미 해 뒀어요 → **다음** → **다음** → **콘솔로 이동**

> 💡 `google-services.json` 은 앱 안에 그대로 들어가는 **공개 값**이라 Claude 에게 보내도 괜찮아요. (아래 3번의 서비스 계정 열쇠와 달라요!)

## 3. 서비스 계정 열쇠 → Supabase Secrets
알림 서버가 "도란톡이 보낸 알림"이라고 구글에 증명할 때 쓰는 열쇠예요.
1. Firebase 왼쪽 위 **⚙️(톱니)** → **프로젝트 설정** → 위쪽 탭 **서비스 계정**
2. **새 비공개 키 생성** → **키 생성** → JSON 파일이 내려받아져요
   - ⛔ 이 파일은 **비밀번호와 같아요.** Claude · 카톡 · GitHub · 메일에 **절대** 보내지 마세요. 아래 Secrets 에만 넣어요.
3. 그 파일을 **메모장**으로 열어 **전체 복사** (Ctrl+A → Ctrl+C)
4. **Supabase** → **Edge Functions** → **Secrets** (못 찾으면 ⚙️ Project Settings → Edge Functions → Secrets)
5. **Add new secret** → **Name**: `FCM_SERVICE_ACCOUNT` (정확히 대문자) · **Value**: 붙여넣기 → **Save**
6. 같은 Firebase **프로젝트 설정** → **클라우드 메시징** 탭 → **Firebase Cloud Messaging API (V1)** 이 **사용 설정됨** 인지 확인 (보통 처음부터 켜져 있어요)
7. 내려받은 JSON 파일은 지워도 돼요. (필요하면 2번처럼 새로 만들 수 있어요)

## 4. 알림 서버 전용 열쇠 (이번엔 꼭)
가족 휴대폰의 Firebase 주소는 이 열쇠를 가진 알림 서버만 받을 수 있게 만들었어요. 열쇠가 없으면 **앱 알림이 가지 않아요.**
20단계를 이미 했다면 건너뛰어요. 아니면 [20단계 할 일 3](step20-security.md#할-일-3-권장-알림-서버-전용-열쇠) 그대로:
1. SQL Editor 에서 `select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') as push_db_key;` → **Run** → 64글자 복사
2. Edge Functions → Secrets → `PUSH_DB_KEY` = 64글자 → Save
3. Integrations → Vault → `push_db_key` = **같은** 64글자 → Save

## 5. 알림 서버(push) 새 코드 다시 올리기
1. GitHub → **supabase → functions → push → index.ts** → **복사 버튼**(📋)으로 **전체** 복사
2. Supabase → **Edge Functions** → **push** → 위쪽 **Code** 탭 → 모두 지우고 **붙여넣기** → **Deploy updates**
3. **Details** 탭 → **Verify JWT** 가 **꺼짐(OFF)** 인지 확인
4. **https://www.dorantalk.com/#/check** → "휴대폰 알림 서버"에 **"안드로이드 앱 알림(Firebase)도 준비됐어요"** 가 나오면 2 ~ 5번 성공 🎉

## 6. 업로드 키를 GitHub Secrets 에 넣기 (앱 서명용)
새 앱이 지금 앱 위에 덮어 설치되려면, 14단계의 **같은 업로드 키**로 서명해야 해요. GitHub 이 만들 때 서명하도록 열쇠를 맡겨요.
(이미 넣어 두었다면 건너뛰어요. GitHub → Settings → Secrets and variables → Actions 목록에 두 이름이 있으면 된 거예요)
1. GitHub 저장소 → **Settings** → 왼쪽 **Secrets and variables** → **Actions** → **New repository secret**
2. **Name** `ANDROID_UPLOAD_KEYSTORE_B64` · **Secret**: 14단계에서 받은 `dorantalk-upload-key.jks.base64.txt` 파일 내용 **전체** → **Add secret**
   - 그 txt 파일이 없고 `dorantalk-upload-key.jks` 만 있으면: 윈도우 컴퓨터에서 jks 파일이 있는 폴더의 빈 곳을 **Shift + 오른쪽 클릭** → **PowerShell 창 열기** → 아래 한 줄 → 클립보드에 복사돼요
     `[Convert]::ToBase64String([IO.File]::ReadAllBytes("dorantalk-upload-key.jks")) | Set-Clipboard`
3. 다시 **New repository secret** → **Name** `ANDROID_UPLOAD_KEYSTORE_PASSWORD` · **Secret**: 업로드 키 비밀번호 → **Add secret**

> 🔒 GitHub Secrets 는 저장하면 **아무도(넣은 사람도) 다시 볼 수 없고**, 앱을 만들 때만 잠깐 쓰여요. 키 파일 · 비밀번호를 대화창에 붙여넣지는 마세요.

## 7. Claude 에게 `google-services.json` 보내기
- 2번에서 받은 파일을 대화창에 **올리거나**, 메모장으로 열어 내용을 **붙여넣어** 주세요.
- Claude 가 저장소(`android/app/google-services.json`)에 넣으면 GitHub 이 **서명된 새 앱**을 만들고, Claude 가 확인한 뒤 **사이트(/download/dorantalk.apk)** 에 올려요.

## 8. 확인
1. 안드로이드 휴대폰에서 도란톡 → 홈의 **"새 버전 받기"** (또는 사용 방법 → 안드로이드 앱 받기) → 받은 파일 열기 → **업데이트**(설치) → **열기**
2. 로그인 → **내 정보 → 알림 → 알림 켜기** → 휴대폰이 물으면 **허용**
3. **시험 알림 보내기** → 위에 팝업으로 오면 성공 🎉
4. (선택) 설정 → 앱 → **Chrome → 사용 중지** 해도 도란톡이 열리는지

## 알아 둘 것
- 화면 · 기능은 앞으로도 **사이트에서 바로** 바뀌어요. 앱(APK)은 안드로이드 부분을 바꿀 때만 다시 설치해요.
- 아이폰 · 컴퓨터는 그대로예요. (웹 알림)
- Firebase 알림은 **무료**예요. (Spark 요금제, 카드 등록 필요 없음)
- 개인정보처리방침 6조에 알림 전달 업체 **Google Firebase** 를 적었어요. (안드로이드 앱 알림은 구글 서버를 거쳐 전달돼요)
- 예전 앱(크롬으로 열리는 앱)을 쓰는 가족에게는 홈 화면에 **"새 버전이 나왔어요"** 안내가 떠요. (새 앱을 사이트에 올린 뒤부터)

## 체크리스트
- [ ] `v14_to_v15.sql` → `v15_to_v16.sql` → 연결 점검 "최신 버전(16)"
- [ ] Firebase 프로젝트 + 안드로이드 앱(`com.dorantalk.app`) → `google-services.json`
- [ ] Secrets: `FCM_SERVICE_ACCOUNT` · `PUSH_DB_KEY` / Vault: `push_db_key`
- [ ] 알림 서버(push) 다시 올리기 → #/check 에 "안드로이드 앱 알림(Firebase)도 준비됐어요"
- [ ] GitHub Secrets: `ANDROID_UPLOAD_KEYSTORE_B64` · `ANDROID_UPLOAD_KEYSTORE_PASSWORD`
- [ ] `google-services.json` 을 Claude 에게 → 새 앱이 사이트에 올라오면 설치 → 알림 켜기 → 시험 알림
