package com.dorantalk.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/** 알림 띄우기: "가족 소식 · 채팅 알림" 채널(높음 중요도 → 카카오톡처럼 위에 팝업) */
final class Notifier {
    private Notifier() { }

    static void ensureChannel(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel ch = new NotificationChannel(
                c.getString(R.string.channelId), c.getString(R.string.channelName), NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription(c.getString(R.string.channelDesc));
        ch.enableVibration(true);
        ch.setShowBadge(true);
        c.getSystemService(NotificationManager.class).createNotificationChannel(ch);
    }

    /** url: '/#/group/…/chat' 처럼 도란톡 안의 주소 · tag: 같은 채팅방 알림은 하나로 묶어요 */
    static void show(Context c, String title, String body, String url, String tag, int badge) {
        ensureChannel(c);
        if (Build.VERSION.SDK_INT >= 33
                && c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        String key = tag == null || tag.isEmpty() ? "dorantalk" : tag;
        String path = url != null && url.startsWith("/") && !url.startsWith("//") ? url : "/#/home";
        Intent open = new Intent(c, MainActivity.class)
                .putExtra("url", path)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, key.hashCode(), open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String text = body == null ? "" : body;
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, c.getString(R.string.channelId))
                .setSmallIcon(R.drawable.ic_notification_icon)
                .setColor(c.getColor(R.color.brandColor))
                .setContentTitle(title == null || title.isEmpty() ? c.getString(R.string.appName) : title)
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setAutoCancel(true)
                .setContentIntent(pi)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setWhen(System.currentTimeMillis())
                .setShowWhen(true);
        if (badge > 0) b.setNumber(badge);
        try {
            NotificationManagerCompat.from(c).notify(key, 1, b.build());
        } catch (SecurityException ignored) {
            // 알림 권한이 막 꺼진 경우
        }
    }
}
