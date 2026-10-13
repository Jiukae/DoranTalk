// 도란톡 서비스 워커
// - 앱 화면(HTML·CSS·JS·아이콘)을 휴대폰에 저장해 두어, 인터넷이 약하거나 끊겨도 앱이 열려요.
// - 인터넷이 되면 항상 서버의 최신 파일을 먼저 받아요 (네트워크 우선). 4초 넘게 걸리면 저장본을 보여 줘요.
// - Supabase(글·채팅·사진) 요청은 건드리지 않아요. 가족 데이터는 휴대폰에 따로 저장하지 않아요.

const VERSION = 'talkfeed-v7-dorantalk';
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
  '/js/lightbox.js',
  '/js/install.js',
  '/js/version.js',
  '/js/pages/auth.js',
  '/js/pages/home.js',
  '/js/pages/group.js',
  '/js/pages/feed.js',
  '/js/pages/chat.js',
  '/js/pages/check.js',
  '/js/pages/help.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png',
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
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // 우리 사이트 파일만 (Supabase 등 다른 주소는 그대로 통과)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(networkFirst(event, req));
});

async function networkFirst(event, req) {
  const cache = await caches.open(VERSION);
  const cacheKey = req.mode === 'navigate' ? '/index.html' : req;
  const fromNetwork = fetch(req, { cache: 'no-cache' }).then((res) => {
    if (res.ok) cache.put(cacheKey, res.clone());
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
