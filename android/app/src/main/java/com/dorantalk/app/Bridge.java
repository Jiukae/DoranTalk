package com.dorantalk.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.core.app.NotificationManagerCompat;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

import java.util.Arrays;
import java.util.HashSet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 웹 앱(www.dorantalk.com) ↔ 안드로이드 앱 연결 통로.
 * - 웹에서는 window.DoranTalkApp.postMessage(JSON) 로 부르고, 답은 DoranTalkApp.onmessage 로 받아요.
 * - 도란톡 주소(https://www.dorantalk.com · https://dorantalk.com)의 맨 위 화면에서만 쓸 수 있어요.
 *   (다른 사이트 · 틀(iframe) 안에서는 이 통로가 아예 안 생겨요)
 * 할 수 있는 일: 앱 정보, 알림 켜기(Firebase 주소 받기), 알림 설정 열기, 압축 파일 저장.
 */
final class Bridge implements WebViewCompat.WebMessageListener {
    private static final String NAME = "DoranTalkApp";
    private static final String PREFS = "dorantalk";

    private final MainActivity activity;
    private final WebView web;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Saver saver;
    private JavaScriptReplyProxy reply;
    private String pendingPushId;
    private String pendingSaveId;

    Bridge(MainActivity activity, WebView web) {
        this.activity = activity;
        this.web = web;
        this.saver = new Saver(activity);
    }

    void install() {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return; // 아주 오래된 WebView
        WebViewCompat.addWebMessageListener(web, NAME,
                new HashSet<>(Arrays.asList("https://www.dorantalk.com", "https://dorantalk.com")), this);
    }

    void close() {
        io.shutdown();
    }

    @Override
    public void onPostMessage(WebView view, WebMessageCompat message, Uri sourceOrigin, boolean isMainFrame, JavaScriptReplyProxy replyProxy) {
        if (!isMainFrame || message.getData() == null) return;
        reply = replyProxy;
        JSONObject m;
        try {
            m = new JSONObject(message.getData());
        } catch (Exception e) {
            return;
        }
        String id = m.optString("id");
        switch (m.optString("type")) {
            case "info":
                ok(id, info());
                break;
            case "pushEnable":
                pushEnable(id);
                break;
            case "pushToken":
                pushToken(id, false);
                break;
            case "openNotificationSettings":
                openNotificationSettings();
                ok(id, null);
                break;
            case "saveStart":
                saveStart(id, m.optString("name"), m.optString("mime"));
                break;
            case "saveChunk": {
                String handle = m.optString("handle");
                String data = m.optString("data");
                io.execute(() -> {
                    try {
                        saver.chunk(handle, data);
                        ok(id, null);
                    } catch (Exception e) {
                        saver.abort(handle);
                        fail(id, "save");
                    }
                });
                break;
            }
            case "saveEnd": {
                String handle = m.optString("handle");
                io.execute(() -> {
                    try {
                        saver.finish(handle);
                        ok(id, null);
                        web.post(() -> Toast.makeText(activity, R.string.saved, Toast.LENGTH_SHORT).show());
                    } catch (Exception e) {
                        saver.abort(handle);
                        fail(id, "save");
                    }
                });
                break;
            }
            default:
                fail(id, "unknown");
        }
    }

    // ------------------------------------------------------------------
    // 앱 정보 · 알림
    // ------------------------------------------------------------------
    static boolean firebaseReady(android.content.Context c) {
        return !FirebaseApp.getApps(c).isEmpty();
    }

    private boolean notificationsAllowed() {
        if (Build.VERSION.SDK_INT >= 33
                && activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        return NotificationManagerCompat.from(activity).areNotificationsEnabled();
    }

    /** 'unavailable'(Firebase 설정 전) · 'granted' · 'default'(아직 안 물음) · 'denied' */
    private String pushState() {
        if (!firebaseReady(activity)) return "unavailable";
        if (notificationsAllowed()) return "granted";
        boolean asked = activity.getSharedPreferences(PREFS, 0).getBoolean("askedNotify", false);
        return Build.VERSION.SDK_INT >= 33 && !asked ? "default" : "denied";
    }

    private JSONObject info() {
        JSONObject o = new JSONObject();
        try {
            o.put("app", BuildConfig.VERSION_NAME);
            o.put("push", pushState());
        } catch (Exception ignored) { }
        return o;
    }

    private void pushEnable(String id) {
        if (!firebaseReady(activity)) {
            fail(id, "unavailable");
            return;
        }
        if (notificationsAllowed()) {
            pushToken(id, true);
            return;
        }
        if (Build.VERSION.SDK_INT >= 33) {
            activity.getSharedPreferences(PREFS, 0).edit().putBoolean("askedNotify", true).apply();
            pendingPushId = id;
            activity.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, MainActivity.REQ_NOTIFY);
        } else {
            fail(id, "denied"); // 안드로이드 12 이하: 휴대폰 설정에서 이 앱 알림이 꺼져 있어요
        }
    }

    void onNotificationPermission(boolean granted) {
        String id = pendingPushId;
        pendingPushId = null;
        if (id == null) return;
        if (granted && notificationsAllowed()) pushToken(id, true);
        else fail(id, "denied");
    }

    private void pushToken(String id, boolean enable) {
        if (!firebaseReady(activity) || !notificationsAllowed()) {
            JSONObject o = new JSONObject();
            try { o.put("token", JSONObject.NULL); } catch (Exception ignored) { }
            ok(id, o);
            return;
        }
        FirebaseMessaging fm = FirebaseMessaging.getInstance();
        if (enable) fm.setAutoInitEnabled(true);
        fm.getToken().addOnCompleteListener(task -> {
            if (!task.isSuccessful() || task.getResult() == null) {
                fail(id, "token");
                return;
            }
            JSONObject o = new JSONObject();
            try { o.put("token", task.getResult()); } catch (Exception ignored) { }
            ok(id, o);
        });
    }

    private void openNotificationSettings() {
        Intent i;
        if (Build.VERSION.SDK_INT >= 26) {
            i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, activity.getPackageName());
        } else {
            i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + activity.getPackageName()));
        }
        try {
            activity.startActivity(i);
        } catch (Exception ignored) { }
    }

    // ------------------------------------------------------------------
    // 압축 파일(한 달 사진) 저장: 웹이 조각(base64)으로 나눠 보내면 "다운로드/DoranTalk" 에 저장
    // ------------------------------------------------------------------
    private void saveStart(String id, String name, String mime) {
        if (Build.VERSION.SDK_INT < 29
                && activity.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            pendingSaveId = id;
            activity.requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, MainActivity.REQ_STORAGE);
            return;
        }
        io.execute(() -> {
            try {
                JSONObject o = new JSONObject();
                o.put("handle", saver.start(name, mime));
                ok(id, o);
            } catch (Exception e) {
                fail(id, "save");
            }
        });
    }

    void onStoragePermission(boolean granted) {
        String id = pendingSaveId;
        pendingSaveId = null;
        if (id != null) fail(id, granted ? "retry" : "permission");
    }

    // ------------------------------------------------------------------
    @SuppressLint("RequiresFeature") // 통로는 WEB_MESSAGE_LISTENER 가 있을 때만 만들어져요 (install)
    private void send(JSONObject o) {
        JavaScriptReplyProxy r = reply;
        if (r == null) return;
        String text = o.toString();
        web.post(() -> {
            try {
                r.postMessage(text);
            } catch (Exception ignored) { }
        });
    }

    private void ok(String id, Object result) {
        JSONObject o = new JSONObject();
        try {
            o.put("id", id);
            o.put("ok", true);
            o.put("result", result == null ? JSONObject.NULL : result);
        } catch (Exception ignored) { }
        send(o);
    }

    private void fail(String id, String error) {
        JSONObject o = new JSONObject();
        try {
            o.put("id", id);
            o.put("ok", false);
            o.put("error", error);
        } catch (Exception ignored) { }
        send(o);
    }
}
