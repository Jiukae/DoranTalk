package com.dorantalk.app;

import com.google.androidbrowserhelper.trusted.NotificationPermissionRequestHandler;

// 웹(dorantalk.com)에서 알림 권한을 물으면, 안드로이드 13 이상에서도 이 앱의 알림 권한 창이 뜨게 해요
public class DelegationService extends com.google.androidbrowserhelper.trusted.DelegationService {
    @Override
    public void onCreate() {
        super.onCreate();
        registerExtraCommandHandler(new NotificationPermissionRequestHandler());
    }
}
