#!/usr/bin/env bash
# 에뮬레이터에서 도란톡 앱(버전 2: 크롬 없이 앱 안의 화면 + Firebase 알림)을 시험해요. (GitHub Actions 에서 실행)
#  1) 크롬을 "사용 중지"한 상태로 설치 · 실행 → 꺼지지 않고 도란톡 화면이 뜨는지
#  2) 앱 안 화면이 www.dorantalk.com 이고, 웹 ↔ 앱 통로(DoranTalkApp)가 답하는지
#  3) 다른 사이트 주소는 앱 안에서 열지 않는지 · 뒤로 가기가 앱 안에서 동작하는지
#  4) 시험 알림이 이 앱의 "높음" 중요도 채널(위에 팝업)로 뜨는지, "Chrome에서 실행 중" 알림은 없는지
# 화면 사진은 smoke.png(실행) · popup.png(알림) 로 저장하고, 로그에도 글자(base64)로 남겨요.
# 시험용 APK 는 디버그 빌드예요 (앱 안 화면을 개발자 도구로 들여다보고, 시험 알림을 띄울 수 있게).
set -u
APK=apk/dorantalk-smoke.apk
FAIL=0
: > results.txt
note() { echo "$*" | tee -a results.txt; }
fail() { note "SMOKE_FAIL: $*"; FAIL=1; }

adb install -r "$APK" || exit 1
adb shell pm disable-user --user 0 com.android.chrome > /dev/null 2>&1 && note "크롬 사용 중지함"
adb shell pm list packages -d | grep -q com.android.chrome && note "확인: 크롬 꺼짐" || note "참고: 크롬이 없거나 끌 수 없음"
adb shell pm grant com.dorantalk.app android.permission.POST_NOTIFICATIONS || true
adb logcat -c
adb shell am start -W -n com.dorantalk.app/.MainActivity
sleep 25
adb shell dumpsys activity activities | grep -E "topResumedActivity|mResumedActivity" | head -3
adb exec-out screencap -p > smoke.png
adb logcat -d -b crash > crash.txt || true
grep -q "com.dorantalk.app" crash.txt && { fail "앱이 꺼졌어요"; cat crash.txt; }
PID=$(adb shell pidof com.dorantalk.app | tr -d '\r')
[ -n "$PID" ] || fail "앱이 실행 중이 아니에요"
note "앱 PID=$PID"

# --- 앱 안 화면(WebView) 들여다보기: 주소 · 통로 · 다른 사이트 막기 · 뒤로 가기 ---
adb forward tcp:9223 "localabstract:webview_devtools_remote_$PID"
pip3 install -q websocket-client > /dev/null 2>&1 || true
python3 - <<'PY' 2>&1 | tee -a results.txt

import json, time, urllib.request, subprocess, websocket, sys

targets = json.load(urllib.request.urlopen('http://127.0.0.1:9223/json'))
page = next((t for t in targets if t.get('type') == 'page'), None)
print('PAGE', page and page.get('url'))
if not page:
    print('SMOKE_FAIL: 앱 안 화면을 찾지 못했어요'); sys.exit(1)
ws = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=40, suppress_origin=True)
n = [0]
def ev(expr):
    n[0] += 1
    ws.send(json.dumps({'id': n[0], 'method': 'Runtime.evaluate', 'params': {'expression': expr, 'awaitPromise': True, 'returnByValue': True}}))
    while True:
        m = json.loads(ws.recv())
        if m.get('id') == n[0]:
            return m.get('result', {}).get('result', {}).get('value')

ok = True
def check(cond, msg):
    global ok
    print(('OK   ' if cond else 'FAIL ') + msg)
    ok = ok and bool(cond)

info = json.loads(ev("""(async () => {
  const r = { href: location.href, ua: navigator.userAgent.includes('DoranTalkApp/'), bridge: typeof window.DoranTalkApp };
  if (r.bridge === 'object') {
    r.info = await new Promise((res) => {
      const id = 'smoke-' + Date.now();
      window.DoranTalkApp.addEventListener('message', (e) => { try { const m = JSON.parse(e.data); if (m.id === id) res(m); } catch {} });
      window.DoranTalkApp.postMessage(JSON.stringify({ id, type: 'info' }));
      setTimeout(() => res('timeout'), 6000);
    });
  }
  r.text = document.body.innerText.slice(0, 120);
  return JSON.stringify(r);
})()"""))
print('INFO', json.dumps(info, ensure_ascii=False))
check(info['href'].startswith('https://www.dorantalk.com/'), '크롬 없이 앱 안 화면에서 www.dorantalk.com 이 열렸어요')
check(info['ua'], '웹 앱이 "도란톡 앱 안"인 걸 알아요 (DoranTalkApp/)')
check(info['bridge'] == 'object', '웹 ↔ 앱 통로(DoranTalkApp)가 있어요')
res = info.get('info') if isinstance(info.get('info'), dict) else {}
check(res.get('ok') is True and res.get('result', {}).get('push') in ('unavailable', 'default', 'granted', 'denied'), '통로가 앱 정보로 답해요: ' + json.dumps(res.get('result'), ensure_ascii=False))

# 다른 사이트 주소는 앱 안에서 열지 않아요 (휴대폰의 다른 앱으로 넘기거나 "열 수 있는 앱이 없어요")
ev("location.href = 'https://example.com/'; 1")
time.sleep(4)
check(ev('location.href').startswith('https://www.dorantalk.com/'), '다른 사이트(example.com)는 앱 안에서 열리지 않아요')

# 뒤로 가기: 앱 안 화면에서 한 단계 뒤로
before = ev('location.hash')
ev("location.hash = '#/help'; 1")
time.sleep(2)
subprocess.run(['adb', 'shell', 'input', 'keyevent', 'KEYCODE_BACK'])
time.sleep(2)
check(ev('location.hash') == before, f'뒤로 가기 버튼이 앱 안에서 이전 화면으로 가요 ({before})')
ws.close()
if not ok:
    print('SMOKE_FAIL: 앱 안 화면 시험 중 FAIL 이 있어요')
PY
grep -q "SMOKE_FAIL" results.txt && FAIL=1

# --- 시험 알림: 이 앱의 높음 중요도 채널로 위에 팝업 ---
adb shell am start -n com.dorantalk.app/.MainActivity --ez testNotify true > /dev/null
sleep 1.5
adb exec-out screencap -p > popup.png
sleep 2
echo "--- 도란톡 앱의 알림 ---"
adb shell dumpsys notification --noredact | grep -E "NotificationRecord.*pkg=com\.dorantalk\.app" | head -3 | tee -a results.txt
adb shell dumpsys notification --noredact | grep -E "NotificationRecord.*pkg=com\.dorantalk\.app" | grep -q "channel=family_alerts" \
  || adb shell dumpsys notification --noredact | grep -A3 "pkg=com.dorantalk.app" | grep -q "family_alerts" \
  || fail "시험 알림이 도란톡 알림 채널로 오지 않았어요"
adb shell dumpsys notification --noredact | grep -E "mId='family_alerts'|id=family_alerts" | head -2
adb shell dumpsys notification --noredact | grep -A6 "family_alerts" | grep -qiE "mImportance=4|importance=4|IMPORTANCE_HIGH" \
  && note "OK   알림 채널 중요도: 높음 (위에 팝업)" || fail "알림 채널 중요도가 높음이 아니에요"
if adb shell dumpsys notification --noredact | grep -E "NotificationRecord" | grep -q "pkg=com.android.chrome"; then
  fail "크롬 알림(Chrome에서 실행 중 등)이 있어요"
else
  note "OK   'Chrome에서 실행 중' 같은 크롬 알림이 없어요"
fi
adb logcat -d -b crash > crash2.txt || true
grep -q "com.dorantalk.app" crash2.txt && { fail "알림 시험 중에 앱이 꺼졌어요"; cat crash2.txt; }

for f in smoke popup; do
  echo "${f^^}_PNG_BEGIN"; base64 -w 3000 $f.png; echo "${f^^}_PNG_END"
done
# 결과 요약은 맨 끝에 (로그 끝부분만 읽어도 보이게)
echo "=== 결과 요약 ==="
cat results.txt
[ "$FAIL" = 0 ] && echo "SMOKE_OK: 모든 시험 통과" || { echo "SMOKE_FAIL: 위의 FAIL 을 확인해 주세요"; exit 1; }
