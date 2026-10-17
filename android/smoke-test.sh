#!/usr/bin/env bash
# 에뮬레이터에서 앱을 설치 · 실행해 보고, 꺼지지(크래시) 않는지 확인해요. (GitHub Actions 에서 실행)
# 그다음 웹 알림을 하나 띄워서, 이 앱의 알림으로 "위에 팝업"(높음 중요도)으로 뜨는지 확인해요.
# 화면 사진은 smoke.png(실행) · popup.png(알림) 로 저장하고, 로그에도 글자(base64)로 남겨요.
set -u
APK=$(ls apk/dorantalk-smoke.apk)
echo "Chrome: $(adb shell dumpsys package com.android.chrome | grep -m1 versionName)"
adb install -r "$APK" || exit 1
# 시험할 때만: 크롬 첫 화면 건너뛰기 + 임시 열쇠로 서명한 앱도 www.dorantalk.com 주인으로 인정 (알림 위임 시험용)
adb shell am set-debug-app --persistent com.android.chrome
adb shell 'echo "_ --disable-fre --no-default-browser-check --no-first-run --disable-digital-asset-link-verification-for-url=https://www.dorantalk.com" > /data/local/tmp/chrome-command-line'
adb shell am force-stop com.android.chrome
adb shell pm grant com.dorantalk.app android.permission.POST_NOTIFICATIONS || true
adb logcat -c
adb shell am start -W -n com.dorantalk.app/com.google.androidbrowserhelper.trusted.LauncherActivity
sleep 30
adb shell dumpsys activity activities | grep -E "topResumedActivity|mResumedActivity" | head -3
adb exec-out screencap -p > smoke.png
adb logcat -d -b crash > crash.txt || true
if grep -q "com.dorantalk.app" crash.txt; then
  echo "SMOKE_FAIL: 앱이 꺼졌어요"; cat crash.txt; exit 1
fi
echo "SMOKE_OK: 앱이 꺼지지 않았어요"

# --- 알림 팝업 시험: 크롬 개발자 도구로 페이지에서 알림을 띄워요 ---
adb forward tcp:9222 localabstract:chrome_devtools_remote
pip3 install -q websocket-client > /dev/null 2>&1 || true
python3 - <<'PY'
import json, urllib.request, websocket, time
targets = json.load(urllib.request.urlopen('http://127.0.0.1:9222/json'))
page = next((t for t in targets if t.get('type') == 'page' and 'dorantalk' in t.get('url', '')), None)
print('PAGE', page and page['url'])
if not page:
    raise SystemExit(0)
ws = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=20)
expr = """(async () => {
  const perm = Notification.permission;
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification('도란톡', { body: '팝업 시험 알림이에요 🔔', tag: 'smoke', icon: '/icons/icon-192.png', badge: '/icons/badge-96.png' });
  return 'permission=' + perm + ' referrer=' + document.referrer;
})()"""
ws.send(json.dumps({'id': 1, 'method': 'Runtime.evaluate', 'params': {'expression': expr, 'awaitPromise': True, 'returnByValue': True}}))
print('EVAL', ws.recv()[:400])
PY
sleep 1.5
adb exec-out screencap -p > popup.png
echo "--- 알림 기록 ---"
adb shell dumpsys notification --noredact | grep -E "NotificationRecord.*pkg=com\.(dorantalk\.app|android\.chrome)" | head -5
adb shell dumpsys notification --noredact | grep -A2 -E "pkg=com.dorantalk.app" | grep -iE "channel|importance" | head -8
echo "--- 도란톡 앱의 알림 채널 ---"
adb shell dumpsys notification --noredact | grep -E "NotificationChannel\{" | grep -iE "_channel_id" | head -5

for f in smoke popup; do
  echo "${f^^}_PNG_BEGIN"; base64 -w 3000 $f.png; echo "${f^^}_PNG_END"
done
