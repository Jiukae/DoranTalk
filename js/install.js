// 앱 설치 도우미
// - 서비스 워커 등록 (인터넷이 약해도 앱 화면이 열리게)
// - 안드로이드: 홈 화면에서 "도란톡 안드로이드 앱을 설치할까요?"를 묻고 앱(APK)을 내려받아요 (알림이 위에 팝업으로 떠요)
//   ("홈 화면에 추가"는 안내하지 않아요. 그렇게 만든 앱은 알림이 아이콘으로만 와서요)
// - 아이폰: 홈 화면에 추가해야 알림을 받을 수 있어서 그 방법을 안내
// - 카카오톡·네이버 앱 안에서 열린 경우: 기본 브라우저로 열도록 안내
import { el, iconTile } from './ui.js';
import { reloadOnNextNavigation } from './router.js';

// 도란톡 안드로이드 앱(APK). android/ 를 고쳐 새로 서명하면 download/dorantalk.apk 파일과 아래 버전을 함께 바꿔요
export const ANDROID_APP = { url: '/download/dorantalk.apk', version: '1.0.0', size: '0.9MB' };

const DISMISS_KEY = 'talkfeed.installDismissedAt';

export function setupInstall() {
  // 크롬이 스스로 "홈 화면에 추가" 안내를 띄우지 않게 해요 (안드로이드는 앱(APK)을 안내해요)
  window.addEventListener('beforeinstallprompt', (e) => e.preventDefault());
  const secure = location.protocol === 'https:' || location.hostname === 'localhost';
  if ('serviceWorker' in navigator && secure) {
    // 이미 예전 버전이 있던 기기에서 새 버전이 자리를 잡으면 → 다음 화면 이동 때 새로 불러오기
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) reloadOnNextNavigation();
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('서비스 워커 등록 실패', err));
    });
    // 앱으로 돌아올 때마다 새 버전이 있는지 확인 (1분에 한 번까지)
    let lastCheck = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastCheck < 60 * 1000) return;
      lastCheck = Date.now();
      navigator.serviceWorker.getRegistration().then((reg) => reg?.update()).catch(() => {});
    });
  }
}

// 도란톡 안드로이드 앱(TWA)으로 열면 처음 주소의 referrer 가 android-app://com.dorantalk.app 이에요.
// 화면을 옮기면 referrer 가 사라져서 이 탭(sessionStorage)에만 기억해요. (크롬과 저장소를 같이 써서 localStorage 는 안 돼요)
const PLAY_APP_KEY = 'talkfeed.playapp';
export function isAndroidApp() {
  const fromApp = document.referrer.startsWith('android-app://com.dorantalk.app');
  try {
    if (fromApp) sessionStorage.setItem(PLAY_APP_KEY, '1');
    return sessionStorage.getItem(PLAY_APP_KEY) === '1';
  } catch {
    return fromApp;
  }
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true || isAndroidApp();
}

export function platform() {
  const ua = navigator.userAgent;
  if (/KAKAOTALK/i.test(ua)) return 'kakao';
  if (/NAVER\(inapp|; NAVER|Instagram|FBAN|FBAV|Line\/|DaumApps|everytimeApp|BAND\//i.test(ua)) return 'inapp';
  if (/iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

// 이 휴대폰에 도란톡 안드로이드 앱이 이미 설치돼 있는지 (크롬이 알려 줄 때만 — manifest 의 related_applications)
async function hasAndroidAppInstalled() {
  try {
    if (!('getInstalledRelatedApps' in navigator)) return false;
    const apps = await navigator.getInstalledRelatedApps();
    return apps.some((app) => app.id === 'com.dorantalk.app');
  } catch {
    return false;
  }
}

function rememberDismiss() {
  try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* 무시 */ }
}

// 카카오톡 안에서 열린 링크를 기본 브라우저(크롬/사파리)로 다시 열기
export function openInExternalBrowser() {
  location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(location.href)}`;
}

function dismissedRecently() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return Date.now() - at < 14 * 24 * 60 * 60 * 1000; // 2주 동안은 다시 안 보여 줌
  } catch {
    return false;
  }
}

// 카카오톡 등 앱 안에서 열렸을 때 보여 주는 안내 (로그인 화면, 홈 화면 맨 위)
export function inAppBrowserNotice() {
  const p = platform();
  if (p === 'kakao') {
    return el('div', { class: 'notice notice-warn' },
      el('p', { class: 'notice-title' }, '카카오톡 안에서 열려 있어요'),
      el('p', {}, '앱을 설치하고 로그인을 유지하려면 크롬이나 사파리에서 열어 주세요.'),
      el('button', { class: 'btn btn-block', type: 'button', onclick: openInExternalBrowser }, '크롬/사파리로 열기'),
    );
  }
  if (p === 'inapp') {
    return el('div', { class: 'notice notice-warn' },
      el('p', { class: 'notice-title' }, '다른 앱 안에서 열려 있어요'),
      el('p', {}, '오른쪽 위(또는 아래) ⋮ 메뉴를 눌러 "다른 브라우저로 열기" 또는 "Safari로 열기"를 골라 주세요.'),
    );
  }
  return null;
}

// 홈 화면 맨 위 안내 (이미 설치했거나, 최근 2주 안에 "나중에"를 누르면 안 보임)
// - 안드로이드: "도란톡 안드로이드 앱을 설치할까요?" → 설치하기를 누르면 바로 내려받고 설치 방법을 보여 줘요
// - 아이폰: 홈 화면에 추가해야 알림을 받을 수 있어서 그 방법
export function installBanner() {
  const p = platform();
  if (dismissedRecently()) return null;
  if (p === 'android') return isAndroidApp() ? null : androidAppPrompt();
  if (p === 'ios' && !isStandalone()) return iosHomeScreenTip();
  return null;
}

function bannerHead(title) {
  return el('div', { class: 'notice-head' }, iconTile('download'), el('p', { class: 'notice-title' }, title));
}

function androidAppPrompt() {
  const box = el('div', { class: 'notice notice-install' });
  const later = el('button', {
    class: 'btn btn-ghost btn-small', type: 'button',
    onclick: () => { rememberDismiss(); box.remove(); },
  }, '나중에');
  const install = el('a', {
    class: 'btn', href: ANDROID_APP.url, download: 'dorantalk.apk',
    // 링크가 내려받기를 시작하고, 이 안내는 설치 방법으로 바뀌어요
    onclick: () => { rememberDismiss(); setTimeout(showSteps, 300); },
  }, '설치하기');
  box.append(
    bannerHead('도란톡 안드로이드 앱을 설치할까요?'),
    el('p', {}, '설치하면 알림이 카카오톡처럼 ', el('strong', {}, '위에 팝업'), '으로 떠요. (약 ', ANDROID_APP.size, ')'),
    el('div', { class: 'btn-row' }, install, later),
  );
  // 이미 설치된 휴대폰이면 묻지 않아요
  hasAndroidAppInstalled().then((yes) => { if (yes) box.remove(); });

  function showSteps() {
    const b = (text) => el('strong', {}, text);
    box.replaceChildren(
      bannerHead('받은 파일을 열어 설치해 주세요'),
      el('ol', { class: 'steps' },
        el('li', {}, '예전에 홈 화면에 추가한 도란톡이 있으면 ', b('먼저 지워요'), ' (아이콘 길게 누르기 → 삭제)'),
        el('li', {}, '알림창의 ', b('다운로드 완료'), ' 또는 ', b('내 파일 → 다운로드 → dorantalk.apk'), ' 를 눌러요'),
        el('li', {}, b('"출처를 알 수 없는 앱"'), '이 나오면 ', b('설정 → 이 출처 허용'), ' → 뒤로'),
        el('li', {}, b('설치'), ' → ', b('열기')),
      ),
      el('div', { class: 'btn-row' },
        el('a', { href: '#/help', class: 'btn btn-secondary' }, '자세한 방법'),
        el('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: () => box.remove() }, '닫기')),
    );
  }
  return box;
}

function iosHomeScreenTip() {
  const box = el('div', { class: 'notice notice-install' });
  const later = el('button', {
    class: 'btn btn-ghost btn-small', type: 'button',
    onclick: () => { rememberDismiss(); box.remove(); },
  }, '나중에');
  box.append(
    bannerHead('아이폰 홈 화면에 도란톡 놓기'),
    el('p', {}, '아래쪽(또는 위쪽) ', el('strong', {}, '공유 버튼 ⬆️'), ' → ', el('strong', {}, '"홈 화면에 추가"'), ' 를 누르면 앱처럼 쓰고 알림도 받을 수 있어요.'),
    el('div', { class: 'btn-row' }, el('a', { href: '#/help', class: 'btn btn-secondary' }, '자세히 보기'), later),
  );
  return box;
}
