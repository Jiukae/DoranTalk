// 도란톡 서비스 워커
// - 앱 화면(HTML·CSS·JS·아이콘)을 휴대폰에 저장해 두어, 인터넷이 약하거나 끊겨도 앱이 열려요.
// - 인터넷이 되면 항상 서버의 최신 파일을 먼저 받아요 (네트워크 우선). 4초 넘게 걸리면 저장본을 보여 줘요.
// - Supabase(글·채팅·사진) 요청은 건드리지 않아요. 가족 데이터는 휴대폰에 따로 저장하지 않아요.
// - 알림: 앱이 꺼져 있어도 알림 서버가 보낸 알림을 띄우고, 누르면 그 화면을 열어요.

const VERSION = 'talkfeed-v32-seo';
// 글꼴은 앱이 업데이트돼도 다시 받지 않도록 따로 보관 (글꼴 파일을 바꿀 때만 이름을 올려요)
const FONT_CACHE = 'talkfeed-fonts-v1';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/css/style.css',
  '/vendor/supabase.js',
  '/js/app.js',
  '/js/config.js',
  '/js/supabase.js',
  '/js/router.js',
  '/js/state.js',
  '/js/errors.js',
  '/js/ui.js',
  '/js/format.js',
  '/js/groups.js',
  '/js/feed.js',
  '/js/chat.js',
  '/js/images.js',
  '/js/avatars.js',
  '/js/lightbox.js',
  '/js/install.js',
  '/js/version.js',
  '/js/theme.js',
  '/js/theme-boot.js',
  '/js/icons.js',
  '/js/push.js',
  '/js/source.js',
  '/js/legal.js',
  '/js/pages/legal.js',
  '/js/pages/account.js',
  '/js/pages/guardian.js',
  '/js/pages/auth.js',
  '/js/pages/home.js',
  '/js/pages/group.js',
  '/js/pages/feed.js',
  '/js/pages/chat.js',
  '/js/pages/check.js',
  '/js/pages/stats.js',
  '/js/pages/help.js',
  '/js/pages/pushsetup.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png',
  '/icons/badge-96.png',
];
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== FONT_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // 우리 사이트 파일만 (Supabase 등 다른 주소는 그대로 통과)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  // 안드로이드 앱(APK) 내려받기는 저장하지 않고 그대로
  if (url.pathname.startsWith('/download/')) return;
  // 글꼴은 바뀌지 않으니 저장본 먼저 (처음 한 번만 내려받음)
  if (url.pathname.startsWith('/fonts/')) {
    event.respondWith(cacheFirst(req));
    return;
  }
  event.respondWith(networkFirst(event, req));
});

async function cacheFirst(req) {
  const cache = await caches.open(FONT_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(event, req) {
  const cache = await caches.open(VERSION);
  const path = new URL(req.url).pathname;
  const isNavigate = req.mode === 'navigate';
  // 화면 이동은 앱(index.html) 하나로 저장 — 소개 화면(/welcome)은 따로
  const isWelcome = path === '/welcome' || path === '/welcome.html';
  const cacheKey = isNavigate ? (isWelcome ? '/welcome' : '/index.html') : req;
  const fromNetwork = fetch(req, { cache: 'no-cache' }).then((res) => {
    // 그림 같은 파일을 주소창에 직접 열었을 때 앱 자리에 저장되지 않게 (HTML 만)
    const html = (res.headers.get('content-type') || '').includes('text/html');
    if (res.ok && !res.redirected && (!isNavigate || html)) cache.put(cacheKey, res.clone());
    return res;
  });
  event.waitUntil(fromNetwork.catch(() => {}));

  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS, null));
  try {
    const res = await Promise.race([fromNetwork, timeout]);
    if (res) return res;
  } catch { /* 인터넷 끊김 → 저장본 */ }
  const cached = await cache.match(cacheKey, { ignoreSearch: true });
  return cached || fromNetwork;
}

// ---------------------------------------------------------------------
// 알림 (웹 푸시)
// ---------------------------------------------------------------------
// 아이폰 · 맥 사파리는 알림을 받으면 꼭 화면에 띄워야 해요 (안 띄우면 알림이 끊길 수 있음)
const IS_APPLE = /iPhone|iPad|iPod|Macintosh/.test(self.navigator.userAgent) && !/Chrome|CriOS|Android|Firefox/.test(self.navigator.userAgent);

// 앱이 알려 주는 "지금 보고 있는 화면" (그 채팅방을 보고 있을 때는 알림을 띄우지 않으려고)
const screens = new Map();
self.addEventListener('message', (event) => {
  if (event.data?.type === 'screen' && event.source?.id) screens.set(event.source.id, String(event.data.url || ''));
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(showPush(data));
});

async function showPush(data) {
  const url = new URL(data.url || '/#/home', self.location.origin).href;
  // 그 채팅방을 지금 보고 있으면 알림을 띄우지 않아요 (카카오톡처럼)
  if (!IS_APPLE && data.kind === 'message') {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some((w) => w.focused && w.visibilityState === 'visible' && (w.url === url || screens.get(w.id) === url))) return;
  }
  // 앱 아이콘에 안 읽은 채팅 수
  if ('setAppBadge' in self.navigator) {
    const n = Number(data.badge) || 0;
    (n > 0 ? self.navigator.setAppBadge(n) : self.navigator.setAppBadge()).catch(() => {});
  }
  await self.registration.showNotification(data.title || '도란톡', {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    lang: 'ko',
    timestamp: Date.now(),
    data: { url },
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || new URL('/#/home', self.location.origin).href;
  event.waitUntil(openApp(url));
});

async function openApp(url) {
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
  if (win) {
    // 이미 열려 있는 앱을 앞으로 가져와서 그 화면으로 이동
    await win.focus().catch(() => {});
    win.postMessage({ type: 'open-url', url });
    return;
  }
  await self.clients.openWindow(url);
}
