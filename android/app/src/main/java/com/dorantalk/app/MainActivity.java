package com.dorantalk.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.view.ContextMenu;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

import androidx.core.content.FileProvider;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * 도란톡 앱 화면: 크롬 없이 앱 안의 화면(WebView)으로 www.dorantalk.com 을 열어요.
 * - 도란톡 주소만 앱 안에서 열고, 다른 주소(메일 · 카카오톡 · 다른 사이트)는 그 앱으로 넘겨요.
 * - 사진 · 동영상 고르기(카메라 포함), 동영상 전체 화면, 사진 길게 눌러 저장, 뒤로 가기를 직접 처리해요.
 * - 알림을 누르면 그 화면(예: 채팅방)으로 바로 가요.
 */
public class MainActivity extends Activity {
    static final String ORIGIN = "https://www.dorantalk.com";
    static final String HOME = ORIGIN + "/?from=app";
    static final int REQ_FILES = 11;
    static final int REQ_NOTIFY = 12;
    static final int REQ_STORAGE = 13;

    /** 알림이 왔을 때 지금 그 채팅방을 보고 있으면 알림을 띄우지 않으려고 (카카오톡처럼) */
    static volatile boolean foreground = false;
    static volatile String currentUrl = "";

    private FrameLayout root;
    private WebView web;
    private Bridge bridge;
    private ValueCallback<Uri[]> fileCallback;
    private File cameraPhoto;
    private File cameraVideo;
    private View fullscreenView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private String pendingSaveUrl;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Notifier.ensureChannel(this);

        // 화면 끝까지 그리고, 위 · 아래 막대와 키보드만큼 안쪽으로 띄워요 (안드로이드 15 이상 방식)
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        root = new FrameLayout(this);
        root.setBackgroundColor(getColor(R.color.backgroundColor));
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return WindowInsetsCompat.CONSUMED;
        });
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), root);
        bars.setAppearanceLightStatusBars(true);
        bars.setAppearanceLightNavigationBars(true);

        setupWebView();
        bridge = new Bridge(this, web);
        bridge.install();
        registerForContextMenu(web);
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBack);
        }
        cleanCameraFiles();

        String start = appUrl(getIntent());
        web.loadUrl(start != null ? start : HOME);
        testNotification(getIntent());
    }

    /** 시험용(디버그 빌드만): 에뮬레이터에서 알림이 "위에 팝업"으로 뜨는지 확인할 때 */
    private void testNotification(Intent intent) {
        if (BuildConfig.DEBUG && intent != null && intent.hasExtra("testNotify")) {
            Notifier.show(this, "우리 가족 · 엄마", "팝업 시험 알림이에요 🔔", "/#/home", "smoke", 1);
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        // 휴대폰 "글자 크기" 설정을 따라요 (할머니 · 할아버지 휴대폰에서 크게)
        s.setTextZoom(Math.round(getResources().getConfiguration().fontScale * 100));
        // 웹 앱이 "도란톡 앱 안"인 걸 알 수 있게 (설치 안내 숨기기 · 앱 알림 쓰기)
        s.setUserAgentString(s.getUserAgentString() + " DoranTalkApp/" + BuildConfig.VERSION_NAME);
        if (WebViewFeature.isFeatureSupported(WebViewFeature.SAFE_BROWSING_ENABLE)) {
            WebSettingsCompat.setSafeBrowsingEnabled(s, true);
        }
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setBackgroundColor(getColor(R.color.backgroundColor));
        web.setWebViewClient(new AppClient());
        web.setWebChromeClient(new AppChrome());
        // 내려받기 링크(https)는 휴대폰의 내려받기 앱 · 브라우저로
        web.setDownloadListener((url, userAgent, disposition, mime, length) -> {
            Uri u = Uri.parse(url);
            if ("https".equals(u.getScheme())) openExternal(u);
        });
    }

    // ------------------------------------------------------------------
    // 주소 다루기
    // ------------------------------------------------------------------
    static boolean isAppUri(Uri u) {
        if (u == null || !"https".equals(u.getScheme())) return false;
        String host = u.getHost();
        return "www.dorantalk.com".equals(host) || "dorantalk.com".equals(host);
    }

    /** 앱을 연 이유(알림 · 링크)에서 열 주소를 꺼내요. 도란톡 주소가 아니면 null */
    static String appUrl(Intent intent) {
        if (intent == null) return null;
        String extra = intent.getStringExtra("url");
        if (extra != null) {
            if (extra.startsWith("/") && !extra.startsWith("//")) return ORIGIN + extra;
            if (isAppUri(Uri.parse(extra))) return extra;
            return null;
        }
        Uri data = intent.getData();
        if (Intent.ACTION_VIEW.equals(intent.getAction()) && isAppUri(data)) return data.toString();
        return null;
    }

    void openExternal(Uri u) {
        String scheme = u.getScheme() == null ? "" : u.getScheme();
        try {
            Intent i;
            switch (scheme) {
                case "intent":
                    i = Intent.parseUri(u.toString(), Intent.URI_INTENT_SCHEME);
                    i.addCategory(Intent.CATEGORY_BROWSABLE);
                    i.setComponent(null);
                    i.setSelector(null);
                    break;
                case "http": case "https": case "mailto": case "tel": case "sms": case "kakaotalk": case "market":
                    i = new Intent(Intent.ACTION_VIEW, u);
                    i.addCategory(Intent.CATEGORY_BROWSABLE);
                    break;
                default:
                    return; // javascript: · file: · content: 같은 주소는 열지 않아요
            }
            startActivity(i);
        } catch (Exception e) {
            Toast.makeText(this, R.string.noApp, Toast.LENGTH_SHORT).show();
        }
    }

    // ------------------------------------------------------------------
    // 화면 이동 · 뒤로 가기
    // ------------------------------------------------------------------
    private void goBack() {
        if (fullscreenView != null) {
            exitFullscreen();
        } else if (web.canGoBack()) {
            web.goBack();
        } else {
            moveTaskToBack(true);
        }
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        goBack(); // 안드로이드 12 이하
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        testNotification(intent);
        String url = appUrl(intent);
        if (url == null) return;
        Uri target = Uri.parse(url);
        Uri now = Uri.parse(currentUrl == null ? "" : currentUrl);
        // 이미 앱이 열려 있으면 새로 불러오지 않고 화면만 바꿔요 (쓰던 글이 날아가지 않게)
        String path = target.getPath() == null || target.getPath().isEmpty() ? "/" : target.getPath();
        if (isAppUri(now) && target.getEncodedFragment() != null && "/".equals(path)) {
            web.evaluateJavascript("location.hash = " + JSONObject.quote("#" + target.getFragment()) + ";", null);
        } else {
            web.loadUrl(url);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        foreground = true;
        web.onResume();
    }

    @Override
    protected void onPause() {
        foreground = false;
        web.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        bridge.close();
        root.removeView(web);
        web.destroy();
        super.onDestroy();
    }

    // ------------------------------------------------------------------
    // 사진 길게 눌러 저장
    // ------------------------------------------------------------------
    @Override
    public void onCreateContextMenu(ContextMenu menu, View v, ContextMenu.ContextMenuInfo info) {
        WebView.HitTestResult r = web.getHitTestResult();
        String src = r.getExtra();
        if (r.getType() == WebView.HitTestResult.IMAGE_TYPE && src != null && src.startsWith("https://")) {
            menu.add(R.string.savePhoto).setOnMenuItemClickListener(item -> {
                savePhoto(src);
                return true;
            });
        }
    }

    private void savePhoto(String url) {
        if (Build.VERSION.SDK_INT < 29 && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            pendingSaveUrl = url;
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE);
            return;
        }
        Toast.makeText(this, Saver.download(this, url) ? R.string.saved : R.string.saveFailed, Toast.LENGTH_SHORT).show();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        if (requestCode == REQ_STORAGE) {
            String url = pendingSaveUrl;
            pendingSaveUrl = null;
            if (granted && url != null) savePhoto(url);
            bridge.onStoragePermission(granted);
        } else if (requestCode == REQ_NOTIFY) {
            bridge.onNotificationPermission(granted);
        }
    }

    // ------------------------------------------------------------------
    // 사진 · 동영상 고르기 (앨범 또는 카메라)
    // ------------------------------------------------------------------
    private boolean chooseFiles(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        fileCallback = callback;
        List<String> types = new ArrayList<>();
        for (String a : params.getAcceptTypes()) {
            if (a == null) continue;
            for (String t : a.split(",")) {
                t = t.trim().toLowerCase(Locale.ROOT);
                if (!t.isEmpty()) types.add(t);
            }
        }
        boolean images = types.isEmpty();
        boolean videos = false;
        for (String t : types) {
            if (t.startsWith("image")) images = true;
            if (t.startsWith("video")) videos = true;
        }

        Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
        pick.addCategory(Intent.CATEGORY_OPENABLE);
        pick.setType(types.size() == 1 ? types.get(0) : "*/*");
        if (types.size() > 1) pick.putExtra(Intent.EXTRA_MIME_TYPES, types.toArray(new String[0]));
        if (params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);

        List<Intent> cameras = new ArrayList<>();
        cameraPhoto = null;
        cameraVideo = null;
        if (images) {
            cameraPhoto = newCameraFile("jpg");
            Intent i = cameraIntent(MediaStore.ACTION_IMAGE_CAPTURE, cameraPhoto);
            if (i != null) cameras.add(i);
        }
        if (videos) {
            cameraVideo = newCameraFile("mp4");
            Intent i = cameraIntent(MediaStore.ACTION_VIDEO_CAPTURE, cameraVideo);
            if (i != null) cameras.add(i);
        }
        Intent chooser = Intent.createChooser(pick, getString(R.string.chooseFile));
        if (!cameras.isEmpty()) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, cameras.toArray(new Intent[0]));
        try {
            startActivityForResult(chooser, REQ_FILES);
            return true;
        } catch (ActivityNotFoundException e) {
            fileCallback = null;
            callback.onReceiveValue(null);
            return false;
        }
    }

    private File newCameraFile(String ext) {
        File dir = new File(getCacheDir(), "camera");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        return new File(dir, "dorantalk-" + System.currentTimeMillis() + "." + ext);
    }

    private Intent cameraIntent(String action, File file) {
        Intent i = new Intent(action);
        if (i.resolveActivity(getPackageManager()) == null) return null;
        Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", file);
        i.putExtra(MediaStore.EXTRA_OUTPUT, uri);
        i.setClipData(ClipData.newRawUri("", uri));
        i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        return i;
    }

    private void cleanCameraFiles() {
        File[] old = new File(getCacheDir(), "camera").listFiles();
        if (old == null) return;
        long dayAgo = System.currentTimeMillis() - 24L * 3600 * 1000;
        for (File f : old) {
            //noinspection ResultOfMethodCallIgnored
            if (f.lastModified() < dayAgo) f.delete();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != REQ_FILES) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        ValueCallback<Uri[]> cb = fileCallback;
        fileCallback = null;
        if (cb == null) return;
        List<Uri> picked = new ArrayList<>();
        if (resultCode == RESULT_OK) {
            ClipData clip = data == null ? null : data.getClipData();
            if (clip != null) {
                for (int i = 0; i < clip.getItemCount(); i++) {
                    Uri u = clip.getItemAt(i).getUri();
                    if (u != null) picked.add(u);
                }
            } else if (data != null && data.getData() != null) {
                picked.add(data.getData());
            }
            // 카메라 앱이 돌려준 "우리 임시 파일" 주소는 빼고, 아래에서 실제로 찍힌 파일만 넣어요
            String ours = getPackageName() + ".fileprovider";
            picked.removeIf(u -> ours.equals(u.getAuthority()));
            if (picked.isEmpty()) {
                if (cameraPhoto != null && cameraPhoto.length() > 0) picked.add(FileProvider.getUriForFile(this, ours, cameraPhoto));
                else if (cameraVideo != null && cameraVideo.length() > 0) picked.add(FileProvider.getUriForFile(this, ours, cameraVideo));
            }
        }
        cb.onReceiveValue(picked.isEmpty() ? null : picked.toArray(new Uri[0]));
    }

    // ------------------------------------------------------------------
    // 동영상 전체 화면
    // ------------------------------------------------------------------
    private void exitFullscreen() {
        if (fullscreenView == null) return;
        ((FrameLayout) getWindow().getDecorView()).removeView(fullscreenView);
        fullscreenView = null;
        if (fullscreenCallback != null) fullscreenCallback.onCustomViewHidden();
        fullscreenCallback = null;
        WindowCompat.getInsetsController(getWindow(), root).show(WindowInsetsCompat.Type.systemBars());
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
    }

    // 인터넷이 끊겨서 처음 화면을 못 불러올 때
    private void showOffline(WebView view) {
        String html = "<!doctype html><html lang=ko><meta name=viewport content='width=device-width,initial-scale=1'>"
                + "<body style='margin:0;font-family:sans-serif;background:#FFF8F1;color:#2a1f17;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center'>"
                + "<div style='padding:24px'><p style='font-size:22px;font-weight:800'>인터넷에 연결되지 않았어요</p>"
                + "<p style='font-size:17px;color:#6b5b4f'>와이파이나 데이터를 켠 뒤 다시 눌러 주세요.</p>"
                + "<a href='" + HOME + "' style='display:inline-block;margin-top:12px;padding:14px 28px;border-radius:14px;background:#C9581F;color:#fff;font-size:18px;font-weight:700;text-decoration:none'>다시 시도</a>"
                + "</div></body></html>";
        view.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
    }

    private class AppClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            if (isAppUri(u)) return false;
            if (!request.isForMainFrame()) return true;
            openExternal(u);
            return true;
        }

        @Override
        public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
            currentUrl = url;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            currentUrl = url;
            CookieManager.getInstance().flush();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) showOffline(view);
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // 화면을 그리는 부분이 멈추면 앱이 꺼지지 않게 화면만 새로 만들어요
            root.removeView(web);
            web.destroy();
            recreate();
            return true;
        }
    }

    private class AppChrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            return chooseFiles(callback, params);
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (fullscreenView != null) {
                callback.onCustomViewHidden();
                return;
            }
            fullscreenView = view;
            fullscreenCallback = callback;
            ((FrameLayout) getWindow().getDecorView()).addView(view,
                    new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), root);
            c.hide(WindowInsetsCompat.Type.systemBars());
            c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR);
        }

        @Override
        public void onHideCustomView() {
            exitFullscreen();
        }

        // 카메라 · 마이크 · 위치는 쓰지 않아요
        @Override
        public void onPermissionRequest(PermissionRequest request) {
            request.deny();
        }

        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            callback.invoke(origin, false, false);
        }
    }
}
