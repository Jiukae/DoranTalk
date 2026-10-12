# TalkFeed 🏡

가족끼리만 쓰는 소통 앱. 네이버 밴드 같은 **피드** + 카카오톡 같은 **채팅**.

- 프론트엔드: HTML + CSS + 순수 JavaScript (빌드 과정 없음)
- 백엔드: Supabase (로그인, 데이터베이스, 실시간 채팅, 사진 저장)
- 배포: Netlify (정적 사이트) · PWA로 휴대폰 홈 화면에 추가 가능

## 진행 단계

| 단계 | 내용 | 상태 |
|---|---|---|
| 1 | 프로젝트 구조 + Supabase 연결 + DB/보안(RLS) 설계 | ✅ 완료 (Supabase 연결됨) → [안내서](docs/step1-supabase-setup.md) |
| 2 | 회원가입 / 로그인 / 닉네임 | |
| 3 | 가족 그룹 만들기 + 닉네임 초대 + 수락/거절 | |
| 4 | 피드 (글, 사진, 댓글, 좋아요) | |
| 5 | 실시간 채팅 | |
| 6 | PWA + 배포 + 가족 접속 링크 | |

## 폴더 구조

```
index.html              앱의 시작 화면 (한 페이지 앱)
css/style.css           디자인 (큰 글씨, 누르기 쉬운 버튼, 따뜻한 색)
js/config.js            Supabase 주소 + 공개(anon/publishable) 키  ← 여기만 채우면 연결
js/supabase.js          Supabase 연결 + 키 안전 검사 (비밀 키 감지 시 작동 중지)
js/ui.js                화면 그리기 도우미 (사용자 글은 항상 텍스트로만 표시)
js/app.js               앱 시작 / 화면 전환
vendor/supabase.js      Supabase 공식 라이브러리 v2.117.1 (MIT 라이선스)
supabase/schema.sql     DB 테이블 + 보안 규칙(RLS) + 사진 저장소 설정 — SQL Editor에서 실행
supabase/tests/         보안 규칙 자동 검사 (개발용, Supabase에 실행하지 않음)
docs/                   단계별 안내서
netlify.toml            배포 설정
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
