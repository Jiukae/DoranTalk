# 도란톡 (TalkFeed) 🏡

가족끼리만 쓰는 소통 앱. 네이버 밴드 같은 **피드** + 카카오톡 같은 **채팅**.

- 프론트엔드: HTML + CSS + 순수 JavaScript (빌드 과정 없음)
- 백엔드: Supabase (로그인, 데이터베이스, 실시간 채팅, 사진 저장)
- 배포: Vercel (정적 사이트, 무료 Hobby) · PWA로 휴대폰 홈 화면에 추가 가능 → [옮기는 방법](docs/hosting-vercel.md)
- 앱 주소: **https://dorantalk.com**
- 비밀번호 찾기 메일: 도란톡 <admin@dorantalk.com> (Resend)

## 진행 단계

| 단계 | 내용 | 상태 |
|---|---|---|
| 1 | 프로젝트 구조 + Supabase 연결 + DB/보안(RLS) 설계 | ✅ 완료 (Supabase 연결됨) → [안내서](docs/step1-supabase-setup.md) |
| 2 | 회원가입 / 로그인 / 닉네임 | ✅ 완료 → [안내서](docs/step2-auth-setup.md) |
| 3 | 가족 그룹 만들기 + 닉네임 초대 + 수락/거절 | ✅ 완료 → [안내서](docs/step3-groups.md) |
| 4 | 피드 (글, 사진, 댓글, 좋아요) | ✅ 완료 → [안내서](docs/step4-feed.md) |
| 5 | 실시간 채팅 | ✅ 완료 → [안내서](docs/step5-chat.md) |
| 6 | PWA + 배포 + 가족 접속 링크 | ✅ 완료 → [안내서](docs/step6-launch.md) · [가족 초대 문구](docs/family-invite.md) |
| 7 | 앱 이름 "도란톡" + dorantalk.com 연결 + admin@dorantalk.com 메일 | ✅ 완료 → [안내서](docs/step7-domain.md) |
| 8 | 개인정보처리방침 · 이용약관 · 가입 동의 · 회원 탈퇴 · 문의 메일 | ✅ 완료 → [안내서](docs/step8-legal.md) |
| 9 | 휴대폰 알림 (채팅 · 새 소식 · 댓글 · 초대, 앱을 닫아도) | ✅ 완료 → [안내서](docs/step9-push.md) |
| - | 사이트 올리는 곳을 Netlify → Vercel(무료)로 옮김 | ✅ 완료 → [안내서](docs/hosting-vercel.md) |
| 10 | 다른 가족들에게 공개 · 홍보: 소개 화면 · 링크 미리보기 · 가입 경로 · 장난 방지 제한(DB 7) · 홍보 이미지와 문구 | ✅ 준비 완료 → [안내서](docs/step10-launch.md) · [홍보 문구](marketing/promo-texts.md) |

## 폴더 구조

```
index.html              앱의 시작 화면 (한 페이지 앱)
welcome.html            소개 화면 (dorantalk.com/welcome) — 처음 온 사람 · 홍보 링크용
robots.txt, sitemap.xml 검색 사이트 안내 (소개 화면을 찾을 수 있게)
assets/                 소개 화면 사진(앱 화면 예시) · 링크 미리보기 그림(og-image.png)
marketing/              홍보 이미지(인스타 · 쇼츠 · 배너) + 홍보 문구 모음(promo-texts.md)
manifest.webmanifest    홈 화면 앱 정보(이름, 아이콘, 색)
sw.js                   서비스 워커: 앱 화면 저장(인터넷이 약해도 열림), 항상 최신 파일 우선, 알림 띄우기 · 누르면 그 화면 열기
icons/                  앱 아이콘 (주황색 집 + 하트)
css/style.css           디자인 (큰 글씨, 누르기 쉬운 버튼, 따뜻한 색)
js/config.js            Supabase 주소 + 공개(anon/publishable) 키  ← 여기만 채우면 연결
js/supabase.js          Supabase 연결 + 키 안전 검사 (비밀 키 감지 시 작동 중지)
js/app.js               앱 시작: 로그인 상태 확인, 화면 연결, 처음 온 사람은 소개 화면으로
js/welcome.js           소개 화면 도우미 (로그인한 사람에게는 "도란톡 열기")
js/source.js            가입 경로 기억 (홍보 주소의 ?from=insta 등)
js/router.js            주소(#/login, #/home …)에 따라 화면 바꾸기
js/state.js             로그인 정보와 내 닉네임 보관
js/errors.js            서버 오류를 쉬운 한국어로 바꾸기
js/ui.js                화면 그리기 도우미: 확인 창, 아래 메뉴, 불러오는 중 틀, 프로필 색 (사용자 글은 항상 텍스트로만 표시)
js/icons.js             선 아이콘 모음 (Lucide 모양, icons/LICENSE-lucide.txt)
js/pages/auth.js        로그인 · 회원가입 · 비밀번호 찾기/재설정
js/pages/home.js        홈(받은 초대, 그룹 목록) · 그룹 만들기 · 내 정보
js/pages/group.js       그룹 화면(소식·채팅·가족 탭), 초대·멤버·나가기
js/groups.js            그룹·초대 관련 서버 요청과 실시간 알림
js/pages/feed.js        소식 목록 · 글쓰기/수정 · 글 상세(댓글, 하트)
js/feed.js              글·댓글·하트 서버 요청과 실시간 알림
js/images.js            사진 고르기 · 자동으로 줄이기 · 올리기 · 임시 주소 받기
js/lightbox.js          사진 크게 보기
js/pages/chat.js        채팅방: 실시간 메시지, 사진, 안 읽은 가족 수, 놓친 메시지 따라잡기
js/chat.js              메시지·읽음 표시·안 읽은 수 서버 요청과 실시간 연결
js/version.js           앱 버전 표시
js/theme.js             배경 테마(화이트·블랙·베이지·블루) 고르기와 기억
js/theme-boot.js        저장된 테마를 화면 그리기 전에 먼저 적용(깜빡임 방지)
js/install.js           홈 화면 추가 안내, 카카오톡 안 브라우저 안내, 서비스 워커 등록
js/pages/help.js        사용 방법 화면 (#/help)
js/format.js            "방금 전", "어제" 같은 날짜 표시
js/pages/check.js       연결 점검 화면 (#/check)
js/legal.js             약관 버전 · 보호책임자 · 문의 메일 + 동의 기록 확인
js/pages/legal.js       개인정보처리방침(#/privacy) · 이용약관(#/terms) · 약관 동의 화면 · 동의 체크 칸
js/pages/account.js     회원 탈퇴 (#/me/delete): 내 사진 파일 → 계정 순서로 삭제
js/push.js              휴대폰 알림: 켜기 · 끄기 · 가족에게 알리기 · 앱 아이콘 숫자
js/pages/pushsetup.js   알림 열쇠(VAPID) 만들기 · 알림 서버 확인 (관리자용, #/push-setup)
vendor/supabase.js      Supabase 공식 라이브러리 v2.117.1 (MIT 라이선스)
fonts/                  글꼴: 네이버 나눔스퀘어 네오 (보통·굵게·아주 굵게, © NAVER Corp., fonts/LICENSE.txt)
supabase/schema.sql     DB 전체 설계(테이블 + 보안 규칙 RLS + 사진 저장소) — 처음 설치할 때 SQL Editor에서 실행
supabase/updates/       단계별 짧은 업데이트 파일 (이미 설치한 DB에 바뀐 부분만 적용)
supabase/functions/push 알림 서버 (Supabase Edge Function, 표준 암호 기능만 사용 · 비밀 키 없음)
supabase/tests/         보안 규칙 자동 검사 (개발용, Supabase에 실행하지 않음)
docs/                   단계별 안내서
vercel.json             배포 설정(Vercel) + 보안 머리말(CSP 등) + # 없는 주소도 앱으로
netlify.toml            (예전) Netlify 배포 설정 — 다시 돌아갈 때를 위해 남겨 둠
```

## 보안 설계 요약

- 모든 테이블에 RLS 적용. 글·댓글·좋아요·채팅·사진은 **같은 그룹 멤버만** 읽고 쓸 수 있음.
- 그룹 생성·초대·수락은 서버 함수(RPC)로만 가능 → 스스로 남의 그룹에 들어가는 것 불가.
- 초대를 **수락하기 전에는** 그룹 이름과 초대한 사람 닉네임 외에는 아무것도 안 보임.
- 사진은 비공개 버킷 `family-photos/{그룹ID}/...` 에 저장, 멤버만 서명된 임시 주소로 열람.
- 프론트엔드에는 공개 키만 사용. secret / service_role 키는 코드에 절대 넣지 않음.

## 개발자용: 보안 규칙 테스트

로컬 PostgreSQL 16이 있다면:

```bash
PGHOST=... PGPORT=... PGUSER=postgres ./supabase/tests/run.sh
# 마지막에 "ALL RLS TESTS PASSED" 가 나오면 성공
```
