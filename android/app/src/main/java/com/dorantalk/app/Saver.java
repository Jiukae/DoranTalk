package com.dorantalk.app;

import android.app.DownloadManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/** 휴대폰에 파일 저장: 사진(길게 눌러 저장) · 압축 파일(한 달 사진 한 번에 내려받기) */
final class Saver {
    private static final class Open {
        final OutputStream out;
        final Uri uri;    // 안드로이드 10 이상 (MediaStore)
        final File file;  // 안드로이드 9 이하
        Open(OutputStream out, Uri uri, File file) { this.out = out; this.uri = uri; this.file = file; }
    }

    private final Context context;
    private final Map<String, Open> open = new HashMap<>();

    Saver(Context context) {
        this.context = context.getApplicationContext();
    }

    /** 파일 이름은 영어 · 숫자 · - _ . 만 (이상한 글자 · 폴더 이동 막기) */
    static String safeName(String name, String fallback) {
        String n = name == null ? "" : name.replaceAll("[^A-Za-z0-9._-]", "_");
        while (n.startsWith(".")) n = n.substring(1);
        if (n.isEmpty()) n = fallback;
        return n.length() > 80 ? n.substring(n.length() - 80) : n;
    }

    /** https 사진 주소를 "사진/DoranTalk" 폴더로 내려받기 (안드로이드 내려받기 관리자) */
    static boolean download(Context c, String url) {
        try {
            Uri u = Uri.parse(url);
            if (!"https".equals(u.getScheme())) return false;
            String name = "dorantalk-" + safeName(u.getLastPathSegment(), System.currentTimeMillis() + ".jpg");
            DownloadManager.Request r = new DownloadManager.Request(u)
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalPublicDir(Environment.DIRECTORY_PICTURES, "DoranTalk/" + name)
                    .setTitle(name);
            DownloadManager dm = (DownloadManager) c.getSystemService(Context.DOWNLOAD_SERVICE);
            dm.enqueue(r);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    synchronized String start(String name, String mime) throws IOException {
        String file = safeName(name, "dorantalk.zip");
        String type = mime == null || mime.isEmpty() ? "application/octet-stream" : mime;
        Open o;
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, file);
            v.put(MediaStore.MediaColumns.MIME_TYPE, type);
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/DoranTalk");
            v.put(MediaStore.MediaColumns.IS_PENDING, 1);
            ContentResolver cr = context.getContentResolver();
            Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (uri == null) throw new IOException("insert");
            OutputStream out = cr.openOutputStream(uri);
            if (out == null) throw new IOException("open");
            o = new Open(out, uri, null);
        } else {
            File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "DoranTalk");
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("mkdir");
            File f = new File(dir, file);
            o = new Open(new FileOutputStream(f), null, f);
        }
        String handle = UUID.randomUUID().toString();
        open.put(handle, o);
        return handle;
    }

    synchronized void chunk(String handle, String base64) throws IOException {
        Open o = open.get(handle);
        if (o == null) throw new IOException("handle");
        o.out.write(Base64.decode(base64, Base64.DEFAULT));
    }

    synchronized void finish(String handle) throws IOException {
        Open o = open.remove(handle);
        if (o == null) throw new IOException("handle");
        o.out.close();
        if (o.uri != null) {
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.IS_PENDING, 0);
            context.getContentResolver().update(o.uri, v, null, null);
        }
    }

    synchronized void abort(String handle) {
        Open o = open.remove(handle);
        if (o == null) return;
        try { o.out.close(); } catch (IOException ignored) { }
        if (o.uri != null) context.getContentResolver().delete(o.uri, null, null);
        //noinspection ResultOfMethodCallIgnored
        if (o.file != null) o.file.delete();
    }
}
