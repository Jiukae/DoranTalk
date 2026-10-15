// 앱 설치(홈 화면에 추가) 도우미
// - 서비스 워커 등록 (인터넷이 약해도 앱 화면이 열리게)
// - 안드로이드 크롬/컴퓨터: "홈 화면에 추가" 버튼을 앱 안에서 바로 띄울 수 있음
// - 아이폰: 버튼을 띄울 수 없어서 방법을 안내
// - 카카오톡·네이버 앱 안에서 열린 경우: 기본 브라우저로 열도록 안내
import { el, iconTile } from './ui.js';
import { reloadOnNextNavigation } from './router.js';

let deferredPrompt = null;
const listeners = new Set();
const DISMISS_KEY = 'talkfeed.installDismissedAt';

export function setupInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // 브라우저가 멋대로 띄우지 않게 하고, 우리 버튼으로 띄움
    deferredPrompt = e;
    listeners.forEach((fn) => fn());
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    listeners.forEach((fn) => fn());
  });
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

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export function platform() {
  const ua = navigator.userAgent;
  if (/KAKAOTALK/i.test(ua)) return 'kakao';
  if (/NAVER\(inapp|; NAVER|Instagram|FBAN|FBAV|Line\/|DaumApps|everytimeApp|BAND\//i.test(ua)) return 'inapp';
  if (/iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

export function canPromptInstall() {
  return Boolean(deferredPrompt);
}

export async function promptInstall() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  listeners.forEach((fn) => fn());
  return outcome === 'accepted';
}

export function onInstallChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
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
      el('p', {}, '홈 화면에 앱으로 추가하고 로그인을 유지하려면 크롬이나 사파리에서 열어 주세요.'),
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

// 홈 화면에 보여 주는 "앱으로 설치" 안내 (이미 설치했거나, 최근에 "나중에"를 누르면 안 보임)
export function installBanner() {
  const p = platform();
  if (isStandalone() || dismissedRecently() || p === 'kakao' || p === 'inapp') return null;

  const box = el('div', { class: 'notice notice-install' });
  const later = el('button', {
    class: 'btn btn-ghost btn-small', type: 'button',
    onclick: () => {
      try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* 무시 */ }
      box.remove();
    },
  }, '나중에');

  let painted = false;
  let stop = () => {};
  const paint = () => {
    // 다른 화면으로 넘어가 배너가 사라졌으면 더 이상 신경 쓰지 않음
    if (painted && !box.isConnected) {
      stop();
      return;
    }
    painted = true;
    if (isStandalone()) {
      box.remove();
      return;
    }
    let body;
    if (canPromptInstall()) {
      body = [
        el('p', {}, '홈 화면에 도란톡 아이콘을 만들어 두면 앱처럼 바로 열 수 있어요.'),
        el('div', { class: 'btn-row' },
          el('button', { class: 'btn', type: 'button', onclick: () => promptInstall() }, '홈 화면에 추가'),
          later),
      ];
    } else if (p === 'ios') {
      body = [
        el('p', {}, '아래쪽(또는 위쪽) ', el('strong', {}, '공유 버튼 ⬆️'), ' → ', el('strong', {}, '"홈 화면에 추가"'), ' 를 누르면 앱처럼 쓸 수 있어요.'),
        el('div', { class: 'btn-row' }, el('a', { href: '#/help', class: 'btn btn-secondary' }, '자세히 보기'), later),
      ];
    } else {
      body = [
        el('p', {}, '브라우저 메뉴(⋮)에서 ', el('strong', {}, '"홈 화면에 추가"'), ' 또는 ', el('strong', {}, '"앱 설치"'), ' 를 누르면 앱처럼 쓸 수 있어요.'),
        el('div', { class: 'btn-row' }, el('a', { href: '#/help', class: 'btn btn-secondary' }, '자세히 보기'), later),
      ];
    }
    box.replaceChildren(
      el('div', { class: 'notice-head' }, iconTile('download'), el('p', { class: 'notice-title' }, '휴대폰 홈 화면에 추가하기')),
      ...body);
  };
  paint();
  stop = onInstallChange(paint);
  return box;
}
