#!/usr/bin/env bash
# 에뮬레이터에서 앱을 설치 · 실행해 보고, 꺼지지(크래시) 않는지 확인해요. (GitHub Actions 에서 실행)
# 화면 사진은 smoke.png 로 저장하고, 로그에도 글자(base64)로 남겨요.
set -u
APK=$(ls apk/*.apk | head -1)
echo "Chrome: $(adb shell dumpsys package com.android.chrome | grep -m1 versionName)"
adb install -r "$APK" || exit 1
# 새 에뮬레이터의 크롬은 "Welcome to Chrome" 첫 화면이 떠서, 시험할 때만 건너뛰어요 (실제 폰은 이미 크롬을 쓰고 있어요)
adb shell am set-debug-app --persistent com.android.chrome
adb shell 'echo "_ --disable-fre --no-default-browser-check --no-first-run" > /data/local/tmp/chrome-command-line'
adb shell am force-stop com.android.chrome
adb logcat -c
adb shell am start -W -n com.dorantalk.app/com.google.androidbrowserhelper.trusted.LauncherActivity
sleep 30
adb shell dumpsys activity activities | grep -E "topResumedActivity|mResumedActivity" | head -3
adb exec-out screencap -p > smoke.png
adb logcat -d -b crash > crash.txt || true
adb logcat -d | grep -iE "androidbrowserhelper|TrustedWebActivity|TWA|LauncherActivity" | tail -40 || true
if grep -q "com.dorantalk.app" crash.txt; then
  echo "SMOKE_FAIL: 앱이 꺼졌어요"; cat crash.txt; exit 1
fi
echo "SMOKE_OK: 앱이 꺼지지 않았어요"
echo "SMOKE_PNG_BEGIN"; base64 -w 3000 smoke.png; echo "SMOKE_PNG_END"
