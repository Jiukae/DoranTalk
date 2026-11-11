// 도란톡 안드로이드 앱(버전 2, 크롬 없이 도는 앱) 안에서 열렸을 때 앱과 이야기하는 통로
// - 앱이 www.dorantalk.com 화면에만 window.DoranTalkApp 을 넣어 줘요 (android/.../Bridge.java)
// - 보내기: DoranTalkApp.postMessage(JSON) · 답: message 이벤트 { id, ok, result | error }
// 웹 브라우저 · 아이폰 · 예전 앱(크롬 기반)에서는 통로가 없어서 inNativeApp() 이 false 예요.

let seq = 0;
let listening = false;
const waiting = new Map();

function app() {
  const a = typeof window !== 'undefined' ? window.DoranTalkApp : null;
  return a && typeof a.postMessage === 'function' && /DoranTalkApp\//.test(navigator.userAgent) ? a : null;
}

// 크롬 없이 도는 도란톡 앱 안인지
export function inNativeApp() {
  return Boolean(app());
}

// 앱 버전 ("2.0.0"), 앱 밖이면 null
export function nativeAppVersion() {
  return navigator.userAgent.match(/DoranTalkApp\/([\d.]+)/)?.[1] || null;
}

function onMessage(event) {
  let m;
  try {
    m = JSON.parse(event.data);
  } catch {
    return;
  }
  const w = waiting.get(m?.id);
  if (!w) return;
  waiting.delete(m.id);
  clearTimeout(w.timer);
  if (m.ok) {
    w.resolve(m.result ?? null);
  } else {
    const err = new Error(m.error || 'app');
    err.code = m.error;
    w.reject(err);
  }
}

// 앱에 부탁하고 답을 기다려요: nativeCall('info') → { app, push }
export function nativeCall(type, data = {}, timeoutMs = 60000) {
  const a = app();
  if (!a) return Promise.reject(Object.assign(new Error('no-app'), { code: 'no-app' }));
  if (!listening) {
    a.addEventListener('message', onMessage);
    listening = true;
  }
  const id = `w${Date.now()}-${++seq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(Object.assign(new Error('app-timeout'), { code: 'app-timeout' }));
    }, timeoutMs);
    waiting.set(id, { resolve, reject, timer });
    a.postMessage(JSON.stringify({ ...data, id, type }));
  });
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// 파일(압축 파일 등)을 휴대폰 "다운로드/DoranTalk" 폴더에 저장 — 조각(512KB)으로 나눠 보내요
export async function saveFileInApp(blob, name, onProgress = () => {}) {
  const CHUNK = 512 * 1024;
  const start = await nativeCall('saveStart', { name, mime: blob.type || 'application/octet-stream' });
  const handle = start?.handle;
  if (!handle) throw new Error('save');
  for (let at = 0; at < blob.size; at += CHUNK) {
    await nativeCall('saveChunk', { handle, data: await toBase64(blob.slice(at, at + CHUNK)) });
    onProgress(Math.min(1, (at + CHUNK) / blob.size));
  }
  await nativeCall('saveEnd', { handle });
}
