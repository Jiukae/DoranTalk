// 휴대폰 알림 (웹 푸시)
// - "알림 켜기"를 누르면 이 기기를 알림 받을 곳으로 등록해요 (supabase/functions/push 알림 서버 + DB 함수)
// - 가족이 채팅 · 글 · 댓글 · 초대를 보내면 알림 서버가 이 기기로 알림을 보내고,
//   앱이 꺼져 있어도 서비스 워커(sw.js)가 알림을 띄워요.
// - 아이폰은 "홈 화면에 추가"한 도란톡 앱(iOS 16.4 이상)에서만 알림을 받을 수 있어요.
import { sb } from './supabase.js';
import { isStandalone, platform } from './install.js';

const FUNCTION = 'push';
const ON_KEY = 'talkfeed.pushOn'; // 이 기기에서 알림을 켜 두었는지 (주소가 바뀌면 다시 등록하려고)
const PROMPT_KEY = 'talkfeed.pushPromptAt';
let serverInfo = null; // { ready, publicKey }

function remember(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* 저장 못 해도 괜찮아요 */ }
}
function recall(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function b64uToBytes(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}
function bytesToB64u(buf) {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 이 기기에서 알림을 쓸 수 있는지
//  'ios-install' : 아이폰 사파리 → 홈 화면에 추가한 앱에서만 가능
//  'unsupported' : 이 브라우저는 알림이 안 됨
//  'denied'      : 알림을 막아 둠 (휴대폰 설정에서 허용해야 함)
//  'default'     : 아직 묻지 않음
//  'granted'     : 허용함
export function pushStatus() {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (platform() === 'ios' && !isStandalone()) return 'ios-install';
  if (!supported) return 'unsupported';
  return Notification.permission;
}

// 알림 서버가 준비됐는지 (관리자가 9단계 설정을 마쳤는지)
export async function pushServerInfo({ fresh = false } = {}) {
  if (serverInfo && !fresh) return serverInfo;
  try {
    const { data, error } = await sb.functions.invoke(FUNCTION, { method: 'GET' });
    serverInfo = error ? { ready: false, error: error.message } : { ready: Boolean(data?.ready), publicKey: data?.publicKey, error: data?.error };
  } catch (err) {
    serverInfo = { ready: false, error: err.message };
  }
  return serverInfo;
}

async function registration() {
  return navigator.serviceWorker.ready;
}

export async function currentSubscription() {
  if (pushStatus() === 'unsupported' || pushStatus() === 'ios-install') return null;
  const reg = await registration();
  return reg.pushManager.getSubscription();
}

function deviceLabel() {
  const p = platform();
  return { ios: '아이폰', android: '안드로이드', desktop: '컴퓨터' }[p] || p;
}

async function save(sub) {
  const json = sub.toJSON();
  const { error } = await sb.rpc('push_subscribe', {
    p_endpoint: json.endpoint, p_p256dh: json.keys.p256dh, p_auth: json.keys.auth, p_device: deviceLabel(),
  });
  if (error) throw error;
}

async function subscribe(publicKey) {
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  // 알림 서버의 열쇠가 바뀌었으면 새로 등록
  const current = sub?.options?.applicationServerKey;
  if (sub && current && bytesToB64u(current) !== publicKey) {
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(publicKey) });
  await save(sub);
  return sub;
}

// "알림 켜기" (버튼을 누른 순간에 불러야 해요 — 브라우저가 허락 창을 띄우는 조건)
export async function enablePush() {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    const err = new Error(permission === 'denied' ? 'denied' : 'dismissed');
    err.code = permission;
    throw err;
  }
  const info = await pushServerInfo({ fresh: true });
  if (!info.ready) throw new Error('server-not-ready');
  await subscribe(info.publicKey);
  remember(ON_KEY, '1');
}

// "알림 끄기"
export async function disablePush() {
  remember(ON_KEY, null);
  dismissPushPrompt(); // 직접 끈 경우 홈에서 다시 조르지 않기
  const sub = await currentSubscription();
  if (!sub) return;
  await sb.rpc('push_unsubscribe', { p_endpoint: sub.endpoint });
  await sub.unsubscribe().catch(() => {});
}

// 로그아웃할 때: 이 기기로 내 알림이 더 오지 않게 (다음에 로그인한 사람은 다시 켤 수 있어요)
export async function forgetThisDevice() {
  try {
    const sub = await currentSubscription();
    if (sub) await sb.rpc('push_unsubscribe', { p_endpoint: sub.endpoint });
  } catch { /* 로그아웃은 그대로 진행 */ }
}

// 앱을 열 때: 알림을 켜 둔 기기는 등록 정보를 최신으로 (주소가 바뀌었거나, 다른 계정이 쓰던 기기인 경우)
export async function refreshPush() {
  if (pushStatus() !== 'granted' || recall(ON_KEY) !== '1') return;
  try {
    const info = await pushServerInfo();
    if (info.ready) await subscribe(info.publicKey);
  } catch { /* 다음에 다시 */ }
}

// 이 기기에서 알림을 받고 있는지
export async function isPushOn() {
  if (pushStatus() !== 'granted') return false;
  return Boolean(await currentSubscription().catch(() => null));
}

// 가족에게 알리기: 채팅 · 글 · 댓글 · 초대를 보낸 직후에 불러요 (실패해도 앱 사용에는 영향 없음)
export function notifyFamily(kind, id) {
  sb.functions.invoke(FUNCTION, { body: { kind, id } }).catch(() => {});
}

// 내 기기로 시험 알림
export async function sendTestPush() {
  const { data, error } = await sb.functions.invoke(FUNCTION, { body: { kind: 'test' } });
  if (error) throw error;
  return data;
}

// 앱 아이콘의 숫자 (안 읽은 채팅 수) — 지원하는 휴대폰에서만
export function setAppBadge(count) {
  try {
    if (count > 0) navigator.setAppBadge?.(count)?.catch?.(() => {});
    else navigator.clearAppBadge?.()?.catch?.(() => {});
  } catch { /* 지원 안 함 */ }
}

// 홈 화면의 "알림 켜기" 안내: 아직 묻지 않았고, 최근 2주 안에 "나중에"를 누르지 않았을 때만
export function shouldPromptPush() {
  const status = pushStatus();
  // 아직 묻지 않았거나, 허락은 했지만 이 앱에서 알림을 켠 적이 없을 때
  if (status !== 'default' && !(status === 'granted' && recall(ON_KEY) !== '1')) return false;
  const at = Number(recall(PROMPT_KEY) || 0);
  return Date.now() - at > 14 * 24 * 60 * 60 * 1000;
}
export function dismissPushPrompt() {
  remember(PROMPT_KEY, String(Date.now()));
}

// 알림을 눌러 앱이 열려 있을 때: 서비스 워커가 보낸 주소로 이동
export function listenNotificationClicks(navigate) {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'open-url' && typeof e.data.url === 'string') navigate(e.data.url);
  });
}
