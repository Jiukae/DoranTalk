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
adb shell 'echo "_ --disable-fre --no-default-browser-check --no-first-run --disable-digital-asset-link-verification-for-url=https://www.dorantalk.com --remote-allow-origins=*" > /data/local/tmp/chrome-command-line'
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

# --- 알림 시험: 크롬 개발자 도구로 페이지에서 알림을 띄워요 ---
# 참고: 시험용 APK 는 임시 열쇠라서 크롬이 알림을 앱에 넘기지 않고 크롬 자체 알림(채널 web:..., 중요도 3 = 보통)으로 띄워요.
#       그래서 여기서는 팝업이 안 뜨는 게 정상이에요. (웹 앱 · PWA 에서 팝업이 안 뜨던 이유와 같아요)
#       업로드 키로 서명한 진짜 APK 는 www.dorantalk.com 주인으로 확인돼서, 알림이 도란톡 앱으로 넘어와
#       USE_HIGH_PRI_NOTIFICATIONS(AndroidManifest.xml) 로 만든 "높음" 중요도 채널로 위에 팝업이 떠요.
adb forward tcp:9222 localabstract:chrome_devtools_remote
pip3 install -q websocket-client > /dev/null 2>&1 || true
python3 - <<'PY'
import json, urllib.request, websocket, time, subprocess, re

def tap_allow():
    # 알림 허용 창(사이트 → 안드로이드 순서로 여러 번 뜰 수 있어요)에서 "Allow"(허용)를 모두 눌러요
    tapped = 0
    for _ in range(8):
        time.sleep(2)
        subprocess.run(['adb', 'shell', 'uiautomator', 'dump', '/sdcard/ui.xml'], capture_output=True)
        xml = subprocess.run(['adb', 'shell', 'cat', '/sdcard/ui.xml'], capture_output=True, text=True).stdout
        m = re.search(r'text="(?:Allow|허용)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml)
        if m:
            x1, y1, x2, y2 = map(int, m.groups())
            subprocess.run(['adb', 'shell', 'input', 'tap', str((x1 + x2) // 2), str((y1 + y2) // 2)])
            tapped += 1
            print('TAPPED Allow', tapped)
        elif tapped:
            return
    print('Allow taps:', tapped)

targets = json.load(urllib.request.urlopen('http://127.0.0.1:9222/json'))
page = next((t for t in targets if t.get('type') == 'page' and 'dorantalk' in t.get('url', '')), None)
print('PAGE', page and page['url'])
if not page:
    raise SystemExit(0)
ws = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=40, suppress_origin=True)
expr = """(async () => {
  const before = Notification.permission;
  const perm = await Notification.requestPermission();
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification('도란톡', { body: '팝업 시험 알림이에요 🔔', tag: 'smoke', icon: '/icons/icon-192.png', badge: '/icons/badge-96.png' });
  return 'permission ' + before + ' -> ' + perm + ' referrer=' + document.referrer;
})()"""
ws.send(json.dumps({'id': 1, 'method': 'Runtime.evaluate', 'params': {'expression': expr, 'awaitPromise': True, 'returnByValue': True, 'userGesture': True}}))
tap_allow()
print('EVAL', ws.recv()[:400])
time.sleep(2)
ws.close()
PY
adb exec-out screencap -p > popup.png
echo "--- 로그 (알림 위임) ---"
adb logcat -d | grep -iE "TrustedWebActivity|DelegationService|TwaLauncher|NotificationPermission|dorantalk" | tail -30 || true
echo "--- 알림 기록 ---"
adb shell dumpsys notification --noredact | grep -E "NotificationRecord.*pkg=com\.(dorantalk\.app|android\.chrome)" | head -5
adb shell dumpsys notification --noredact | grep -A2 -E "pkg=com.dorantalk.app" | grep -iE "channel|importance" | head -8
echo "--- 도란톡 앱의 알림 채널 ---"
adb shell dumpsys notification --noredact | grep -E "NotificationChannel\{" | grep -iE "_channel_id" | head -5

for f in smoke popup; do
  echo "${f^^}_PNG_BEGIN"; base64 -w 3000 $f.png; echo "${f^^}_PNG_END"
done
