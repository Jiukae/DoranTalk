package com.dorantalk.app;

import androidx.annotation.NonNull;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Firebase 로 온 알림 받기. 알림 서버(supabase/functions/push)는 "데이터 알림"으로 보내서,
 * 앱이 꺼져 있어도 여기서 직접 "높음" 중요도 알림을 만들어요.
 */
public class PushService extends FirebaseMessagingService {
    @Override
    public void onNewToken(@NonNull String token) {
        // 웹 앱이 다음에 열릴 때 새 주소로 다시 등록해요 (push.js refreshPush)
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> d = message.getData();
        String title = d.get("title");
        String body = d.get("body");
        if (title == null && message.getNotification() != null) {
            title = message.getNotification().getTitle();
            body = message.getNotification().getBody();
        }
        String url = d.get("url");
        // 그 채팅방을 지금 보고 있으면 알림을 띄우지 않아요 (카카오톡처럼)
        if ("message".equals(d.get("kind")) && MainActivity.foreground && url != null
                && (MainActivity.ORIGIN + url).equals(MainActivity.currentUrl)) {
            return;
        }
        int badge = 0;
        try { badge = Integer.parseInt(d.get("badge")); } catch (Exception ignored) { }
        Notifier.show(this, title, body, url, d.get("tag"), badge);
    }
}
