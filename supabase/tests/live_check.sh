#!/usr/bin/env bash
# =====================================================================
#  운영 서버(www.dorantalk.com · Supabase) 읽기 전용 보안 점검 (108개)
#  - 앱에 이미 들어 있는 "공개 키"로만 요청해요. 가입 · 글쓰기 · 삭제는 하지 않아요.
#    (쓰기를 시도하는 항목은 모두 "거절되는지"만 확인해요)
#  - 결과: RESULT|번호|분류|PASS · FAIL · TODO|내용|자세히   (TODO = 업데이트를 올리면 끝나는 할 일)
#  - 필요한 것: bash · curl · openssl · node · python3
#  사용: ./supabase/tests/live_check.sh
# =====================================================================
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
K=sb_publishable_Aws1OnmwOZF_tMDzbOz9rA_XtuSDgZX; U=https://jksstsimlqxleoerizzy.supabase.co; W=https://www.dorantalk.com
CAT='운영 서버(읽기 전용)'; PASS=0; FAILN=0; TODON=0
out() { echo "RESULT|$1|$CAT|$2|$3|$(echo "$4" | tr '\n|' '  ' | cut -c1-160)"; case $2 in PASS) PASS=$((PASS+1));; FAIL) FAILN=$((FAILN+1));; TODO) TODON=$((TODON+1));; esac; }
ok() { if eval "$3"; then out "$1" PASS "$2" "$4"; else out "$1" FAIL "$2" "$4"; fi; }
todo() { if eval "$3"; then out "$1" PASS "$2" "$4"; else out "$1" TODO "$2" "$4"; fi; }
b64u() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

# --- 사이트 · 보안 머리말 ---
HD=$(curl -sS -D - -o /dev/null --max-time 20 $W/)
ok LIVE-01 'https 로만 열리고, 브라우저에 "항상 https" (HSTS 2년)를 알려요' '[[ "$HD" =~ HTTP/2\ 200 && "$HD" =~ strict-transport-security:\ max-age=([0-9]+) && ${BASH_REMATCH[1]} -ge 31536000 ]]' "$(grep -i strict <<<"$HD")"
AP=$(curl -sS -D - -o /dev/null --max-time 20 https://dorantalk.com/)
ok LIVE-02 'dorantalk.com 은 https://www.dorantalk.com 으로 안전하게 넘어가요' 'grep -qi "^location: https://www.dorantalk.com/" <<<"$AP"' "$(grep -i '^location' <<<"$AP")"
LIVECSP=$(grep -i '^content-security-policy:' <<<"$HD" | cut -d' ' -f2- | tr -d '\r')
REPOCSP=$(node -e "const v=require(process.argv[1]);console.log(v.headers.find(h=>h.source==='/(.*)').headers.find(h=>h.key==='Content-Security-Policy').value)" "$ROOT/vercel.json")
ok LIVE-03 '운영 사이트의 보안 정책(CSP)이 저장소 설정과 똑같이 적용돼 있어요' '[[ "$LIVECSP" == "$REPOCSP" ]]' "${LIVECSP:0:60}…"
ok LIVE-04 '다른 사이트가 틀 안에 넣지 못하게 (X-Frame-Options: DENY)' 'grep -qi "^x-frame-options: DENY" <<<"$HD"' ''
ok LIVE-05 '파일 형식 속이기 방지 (nosniff)' 'grep -qi "^x-content-type-options: nosniff" <<<"$HD"' ''
ok LIVE-06 '다른 사이트로 갈 때 주소를 덜 알려 줘요 (Referrer-Policy)' 'grep -qi "^referrer-policy: strict-origin-when-cross-origin" <<<"$HD"' ''
ok LIVE-07 '카메라 · 마이크 · 위치 · 결제 권한은 꺼 둬요 (Permissions-Policy)' 'grep -qi "^permissions-policy: camera=()" <<<"$HD"' ''
GITC=$(curl -sS --max-time 20 $W/.git/config)
ok LIVE-08 '사이트에서 .git 폴더(코드 저장소 정보)가 보이지 않아요' '! grep -q "\[core\]" <<<"$GITC"' "$(head -c 40 <<<"$GITC")"
ENVF=$(curl -sS --max-time 20 $W/.env)
ok LIVE-09 '사이트에서 .env (비밀 설정 파일)가 보이지 않아요' '! grep -qE "^[A-Z_]+=" <<<"$ENVF"' "$(head -c 40 <<<"$ENVF")"
SCH=$(curl -sS --max-time 20 $W/supabase/schema.sql)
ok LIVE-10 '공개된 설계 파일(schema.sql)에도 비밀 값은 없어요' '! grep -qE "sb_secret_|re_[A-Za-z0-9]{8,}_|service_role\"|-----BEGIN" <<<"$SCH"' "$(wc -c <<<"$SCH")바이트"

# --- 로그인(Auth) 설정 ---
AS=$(curl -sS --max-time 20 "$U/auth/v1/settings" -H "apikey: $K")
ok LIVE-11 '가입하면 이메일 인증을 해야 써요 (가짜 이메일 가입 막기)' 'grep -q "\"mailer_autoconfirm\":false" <<<"$AS"' ''
ok LIVE-12 '익명(이메일 없는) 로그인은 꺼져 있어요' 'grep -q "\"anonymous_users\":false" <<<"$AS"' ''
ok LIVE-13 '켜진 로그인 방법은 이메일 하나뿐 (안 쓰는 소셜 로그인 없음)' '[[ $(grep -o "\"[a-z_]*\":true" <<<"$(sed "s/.*\"external\":{\([^}]*\)}.*/\1/" <<<"$AS")" | tr "\n" " ") == "\"email\":true " ]]' ''
OA=$(curl -sS --max-time 20 -o /dev/null -w "%{http_code}" "$U/rest/v1/" -H "apikey: $K")
ok LIVE-14 '공개 키로는 DB 설계도(OpenAPI)를 볼 수 없어요' '[[ $OA == 401 ]]' "$OA"
GQ=$(curl -sS --max-time 20 -X POST "$U/graphql/v1" -H "apikey: $K" -H 'Content-Type: application/json' -d '{"query":"{__typename}"}')
ok LIVE-15 '쓰지 않는 GraphQL 창구는 꺼져 있어요' 'grep -q "not enabled" <<<"$GQ"' "$(head -c 60 <<<"$GQ")"

# --- 로그인 안 한 사람: 모든 표 읽기 막힘 ---
i=0
for t in profiles family_groups group_members group_invitations posts comments post_likes messages chat_reads push_subscriptions push_sent guardian_consents mail_log group_requests premium_codes premium_interest family_events family_event_notices; do
  i=$((i+1)); R=$(curl -sS --max-time 20 "$U/rest/v1/$t?select=*&limit=1" -H "apikey: $K" -w '|%{http_code}')
  ok "LIVE-T$(printf %02d $i)" "로그인 안 한 사람은 $t 표를 못 읽어요" '[[ "${R##*|}" == 401 && "$R" == *42501* ]]' "${R##*|}"
done

# --- 로그인 안 한 사람: 함수 실행 권한 (허용 5개만) ---
Z=00000000-0000-0000-0000-000000000000; i=0
fn() { # 이름 인자 기대(allow/deny/todo)
  i=$((i+1)); local R; R=$(curl -sS -X POST --max-time 20 "$U/rest/v1/rpc/$1" -H "apikey: $K" -H 'Content-Type: application/json' -d "$2" -w '|%{http_code}')
  case $3 in
    allow) ok "LIVE-F$(printf %02d $i)" "(정상 기능) 로그인 없이 $1 은 쓸 수 있어요" '[[ "${R##*|}" == 200 ]]' "${R##*|}";;
    deny)  ok "LIVE-F$(printf %02d $i)" "로그인 안 한 사람은 $1 함수를 못 불러요" '[[ "${R##*|}" == 401 && "$R" == *42501* ]]' "${R##*|}";;
    todo)  todo "LIVE-F$(printf %02d $i)" "로그인 안 한 사람은 계산용 $1 도 못 불러요 (버전 15 업데이트 후)" '[[ "${R##*|}" == 401 ]]' "지금 ${R##*|} (해는 없음)";;
  esac
}
for f in create_group:'{"group_name":"x"}' get_my_invitations:'{}' get_unread_counts:'{}' my_photo_paths:'{}' delete_my_account:'{}' \
  push_targets:'{"p_kind":"test"}' push_subscribe:'{"p_endpoint":"https://fcm.googleapis.com/x","p_p256dh":"x","p_auth":"x"}' push_unsubscribe:'{"p_endpoint":"x"}' push_forget:'{"p_endpoints":["x"]}' \
  my_children:'{}' my_guardian_links:'{}' my_guardian_info:'{}' create_guardian_link:'{"p_terms_version":"2026-01-01"}' attach_guardian_consent:'{"p_token":"x"}' \
  send_mail:'{"p_to":"","p_subject":"x","p_html":"x"}' request_group:'{"p_name":"x"}' my_group_requests:'{}' children_group_requests:'{}' \
  admin_stats:'{}' admin_premium_summary:'{}' admin_create_premium_codes:'{"p_count":1,"p_months":1}' has_premium_interest:'{}' \
  my_video_uploads_today:'{}' due_event_reminders:'{}' recently_signed_in_with_password:'{}' html_escape:'{"t":"x"}' is_admin:'{}' is_reserved_name:'{"t":"x"}'; do
  fn "${f%%:*}" "${f#*:}" deny
done
for f in invite_by_handle:gid,p_handle respond_invitation:inv_id cancel_invitation:inv_id mark_chat_read:gid is_group_member:gid can_access_post:pid \
  can_see_profile:target unread_total_for:target is_child_account:target child_photo_paths:p_child delete_child_account:p_child cancel_guardian_link:p_id \
  cancel_group_request:p_id is_premium_group:p_group register_premium_interest:p_group; do
  name=${f%%:*}; args=${f#*:}; body=$(python3 -c "import json,sys;a=sys.argv[1].split(',');print(json.dumps({k:('$Z' if k!='p_handle' else 'x') for k in a}))" "$args")
  [[ $name == respond_invitation ]] && body="{\"inv_id\":\"$Z\",\"accept\":true}"
  fn "$name" "$body" deny
done
fn decide_group_request "{\"p_id\":\"$Z\",\"p_approve\":false}" deny
fn redeem_premium_code "{\"p_group\":\"$Z\",\"p_code\":\"x\"}" deny
fn is_guardian_of '{"child":"x"}' deny
fn can_see_avatar '{"p_owner":"x"}' deny
fn paths_in_group_folder "{\"paths\":[],\"gid\":\"$Z\",\"folder\":\"posts\"}" deny
fn mail_layout '{"p_title":"a","p_body_html":"b","p_button":"c","p_url":"d"}' deny
fn is_video_path '{"p":"a.mp4"}' todo
fn media_summary '{"paths":["a.mp4"],"verb":"x"}' todo
fn talkfeed_schema_version '{}' allow
fn is_nickname_available '{"nick":"ab"}' allow
fn is_handle_available '{"p_handle":"zz_probe"}' allow
fn guardian_link_info '{"p_token":"nope"}' allow
fn mail_ready '{}' allow

# --- 사진 창고 ---
R=$(curl -sS --max-time 20 "$U/storage/v1/bucket" -H "apikey: $K" -H "Authorization: Bearer $K"); ok LIVE-S01 '로그인 안 한 사람에게 창고 목록이 안 보여요' '[[ "$R" == "[]" ]]' "$R"
R=$(curl -sS --max-time 20 -X POST "$U/storage/v1/object/list/family-photos" -H "apikey: $K" -H "Authorization: Bearer $K" -H 'Content-Type: application/json' -d '{"prefix":"","limit":5}'); ok LIVE-S02 '로그인 안 한 사람에게 가족 사진 파일 목록이 안 보여요' '[[ "$R" == "[]" ]]' "$R"
R=$(curl -sS --max-time 20 -X POST "$U/storage/v1/object/list/family-photos" -H "apikey: $K" -H "Authorization: Bearer $K" -H 'Content-Type: application/json' -d '{"prefix":"avatars/","limit":5}'); ok LIVE-S03 '로그인 안 한 사람에게 프로필 사진 목록이 안 보여요' '[[ "$R" == "[]" ]]' "$R"
R=$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' "$U/storage/v1/object/public/family-photos/avatars/x.jpg"); ok LIVE-S04 '공개 주소(/public/)로는 사진을 볼 수 없어요 (비공개 창고)' '[[ $R == 400 || $R == 404 ]]' "$R"
R=$(curl -sS --max-time 20 "$U/storage/v1/object/sign/family-photos/avatars/x.jpg?token=eyJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJmYW1pbHktcGhvdG9zL2F2YXRhcnMveC5qcGcifQ.AAAA"); ok LIVE-S05 '가짜 서명 주소로는 사진을 볼 수 없어요' 'grep -q "signature verification failed" <<<"$R"' "$(head -c 60 <<<"$R")"
R=$(printf 'x' | curl -sS --max-time 20 -X POST "$U/storage/v1/object/family-photos/avatars/zz-security-test.jpg" -H "apikey: $K" -H "Authorization: Bearer $K" -H 'Content-Type: image/jpeg' --data-binary @-); ok LIVE-S06 '로그인 안 한 사람은 파일을 올릴 수 없어요' 'grep -q "row-level security" <<<"$R"' "$(head -c 60 <<<"$R")"

# --- 로그인 정보 위조 ---
H=$(printf '{"alg":"HS256","typ":"JWT"}' | b64u); NOW=$(date +%s)
PS=$(printf '{"iss":"supabase","ref":"jksstsimlqxleoerizzy","role":"service_role","iat":%d,"exp":%d}' $NOW $((NOW+600)) | b64u)
PU=$(printf '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aud":"authenticated","exp":%d}' $((NOW+600)) | b64u)
SVC="$H.$PS.$(printf '%s.%s' "$H" "$PS" | openssl dgst -sha256 -hmac guessed-secret -binary | b64u)"
NONE="$(printf '{"alg":"none","typ":"JWT"}' | b64u).$PU."
DEF="$H.$PU.$(printf '%s.%s' "$H" "$PU" | openssl dgst -sha256 -hmac super-secret-jwt-token-with-at-least-32-characters-long -binary | b64u)"
R=$(curl -sS --max-time 20 "$U/rest/v1/profiles?select=id&limit=1" -H "apikey: $K" -H "Authorization: Bearer $SVC" -w '|%{http_code}'); ok LIVE-J01 '위조한 관리자(service_role) 로그인 정보는 거절돼요' '[[ "${R##*|}" == 401 ]]' "${R##*|}"
R=$(curl -sS --max-time 20 "$U/rest/v1/profiles?select=id&limit=1" -H "apikey: $K" -H "Authorization: Bearer $NONE" -w '|%{http_code}'); ok LIVE-J02 '서명 없는(alg: none) 로그인 정보는 거절돼요' '[[ "${R##*|}" == 401 ]]' "${R##*|}"
R=$(curl -sS --max-time 20 "$U/rest/v1/profiles?select=id&limit=1" -H "apikey: $K" -H "Authorization: Bearer $DEF" -w '|%{http_code}'); ok LIVE-J03 '널리 알려진 예시 비밀 열쇠로 만든 로그인 정보는 거절돼요' '[[ "${R##*|}" == 401 ]]' "${R##*|}"
R=$(curl -sS --max-time 20 "$U/auth/v1/user" -H "apikey: $K" -H "Authorization: Bearer $DEF" -w '|%{http_code}'); ok LIVE-J04 '로그인 서버도 위조한 로그인 정보를 거절해요' '[[ "${R##*|}" == 403 || "${R##*|}" == 401 ]]' "${R##*|}"
R=$(curl -sS --max-time 20 "$U/auth/v1/admin/users" -H "apikey: $K" -H "Authorization: Bearer $K" -w '|%{http_code}'); ok LIVE-J05 '공개 키로는 회원 목록(관리자 기능)을 볼 수 없어요' '[[ "${R##*|}" == 401 || "${R##*|}" == 403 ]]' "${R##*|}"

# --- 알림 서버 ---
R=$(curl -sS --max-time 25 "$U/functions/v1/push" -H "apikey: $K"); ok LIVE-E01 '알림 서버는 준비 상태와 공개 열쇠만 알려 줘요' '[[ "$R" =~ ^\{\"ready\":true,\"publicKey\":\"[A-Za-z0-9_-]{87}\"\}$ ]]' "${R:0:40}…"
R=$(curl -sS --max-time 25 -X POST "$U/functions/v1/push" -H 'Content-Type: application/json' -d '{"kind":"test"}' -w '|%{http_code}'); ok LIVE-E02 '로그인 없이 알림을 보내 달라고 하면 거절돼요' '[[ "${R##*|}" == 401 ]]' "${R##*|}"
R=$(curl -sS --max-time 25 -X POST "$U/functions/v1/push" -H "apikey: $K" -H "Authorization: Bearer $SVC" -H 'Content-Type: application/json' -d '{"kind":"test"}' -w '|%{http_code}'); ok LIVE-E03 '위조한 로그인 정보로도 알림을 보낼 수 없어요' '[[ "${R##*|}" == 401 ]]' "${R##*|}"
R=$(curl -sS --max-time 25 -X POST "$U/functions/v1/push" -H "apikey: $K" -H "Authorization: Bearer $NONE" -H 'Content-Type: application/json' -d '{"kind":"test"}' -w '|%{http_code}'); ok LIVE-E04 '서명 없는 로그인 정보로도 알림을 보낼 수 없어요' '[[ "${R##*|}" == 401 ]]' "${R##*|}"
R=$(curl -sS --max-time 25 -X POST "$U/functions/v1/push" -H "apikey: $K" -H "Authorization: Bearer $DEF" -H 'Content-Type: application/json' -d '{"kind":"sql;drop"}' -w '|%{http_code}'); ok LIVE-E05 '이상한 알림 종류는 400 으로 거절돼요' '[[ "${R##*|}" == 400 ]]' "${R##*|}"
R=$(curl -sS --max-time 25 -X PUT "$U/functions/v1/push" -H "apikey: $K" -w '|%{http_code}'); ok LIVE-E06 '정해진 방법(GET · POST) 말고는 거절돼요' '[[ "${R##*|}" == 405 ]]' "${R##*|}"

# --- 해야 할 일 (업데이트 · 다시 배포) ---
V=$(curl -sS --max-time 20 "$U/rest/v1/rpc/talkfeed_schema_version" -H "apikey: $K")
todo LIVE-V01 '운영 DB 가 보안 보강 버전(15)이에요' '[[ "$V" -ge 15 ]]' "지금 버전 $V → v14_to_v15.sql 실행 필요"
R=$(curl -sS --max-time 25 -X POST "$U/functions/v1/push" -H "apikey: $K" -H "Authorization: Bearer $DEF" -H 'Content-Type: application/json' -d '{"kind":"event","id":"11111111-1111-1111-1111-111111111111"}' -w '|%{http_code}')
todo LIVE-V02 '운영 알림 서버가 최신 코드예요 (달력 알림 · 전용 열쇠 지원)' '[[ "${R##*|}" == 401 ]]' "지금 ${R##*|} (예전 코드: 달력 알림 모름) → 다시 배포 필요"

echo "SUMMARY|$((PASS+FAILN+TODON))|$PASS|$FAILN|$TODON"
