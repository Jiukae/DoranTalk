package com.dorantalk.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;

import java.util.Locale;

// 크롬이 넘겨준 웹 알림(채팅 · 새 소식 등)을 이 앱의 알림으로 보여 줘요.
// 기본 동작(androidx)은 알림 종류(채널)를 "보통" 중요도로 만들어서 위에 팝업이 안 떠요.
// 같은 이름의 알림 종류를 먼저 "높음" 중요도로 만들어 두면, 카카오톡처럼 위에 팝업으로 떠요.
public class DelegationService extends com.google.androidbrowserhelper.trusted.DelegationService {
    @Override
    public boolean onNotifyNotificationWithChannel(String platformTag, int platformId,
            Notification notification, String channelName) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ensureHighImportanceChannel(channelName);
        } else {
            // 안드로이드 7.x 는 알림마다 중요도를 정해요
            notification.priority = Notification.PRIORITY_HIGH;
        }
        return super.onNotifyNotificationWithChannel(platformTag, platformId, notification, channelName);
    }

    private void ensureHighImportanceChannel(String channelName) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        // androidx TrustedWebActivityService 가 채널 id 를 만드는 규칙과 같아요
        String channelId = channelName.toLowerCase(Locale.ROOT).replace(' ', '_') + "_channel_id";
        // 이미 있으면 사용자가 휴대폰 설정에서 바꾼 값을 그대로 둬요
        if (manager.getNotificationChannel(channelId) != null) return;
        NotificationChannel channel =
                new NotificationChannel(channelId, channelName, NotificationManager.IMPORTANCE_HIGH);
        channel.enableVibration(true);
        channel.setShowBadge(true);
        manager.createNotificationChannel(channel);
    }
}
