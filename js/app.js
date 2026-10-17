// TalkFeed 시작 파일: 로그인 상태를 확인하고 알맞은 화면을 보여 줍니다.
import { sb, checkConfig } from './supabase.js';
import { state, loadProfile } from './state.js';
import { route, setGuard, startRouter, go, currentPath } from './router.js';
import { el, render, brandHeader, loadingScreen, toast, trackKeyboard } from './ui.js';
import { friendlyError } from './errors.js';
import { renderCheck } from './pages/check.js';
import { renderLogin, renderSignup, renderChildSignup, renderForgot, renderNewPassword } from './pages/auth.js';
import { renderChildren, renderGuardianConsent } from './pages/guardian.js';
import { renderHome, renderMe, renderNewGroup } from './pages/home.js';
import { renderGroup } from './pages/group.js';
import { renderHelp, renderDeleteGuide } from './pages/help.js';
import { setupInstall, isStandalone } from './install.js';
import { renderWrite, renderPostDetail } from './pages/feed.js';
import { renderPrivacy, renderTerms, renderConsent } from './pages/legal.js';
import { renderDeleteAccount } from './pages/account.js';
import { hasConsented, isAdminUser } from './legal.js';
import { renderPushSetup } from './pages/pushsetup.js';
import { refreshPush, listenNotificationClicks, forgetThisDevice } from './push.js';
import { captureSource } from './source.js';

// 홍보 링크(?from=insta 등)로 들어왔다면 기억해 두기 (가입할 때 함께 저장)
captureSource();

// 주소를 # 없이 입력한 경우 (예: dorantalk.com/push-setup) → dorantalk.com/#/push-setup 으로 바꿔서 열어요
if (location.pathname !== '/' && location.pathname !== '/index.html' && !location.hash) {
  history.replaceState(null, '', `/${location.search}#${location.pathname.replace(/\/+$/, '')}`);
}

// 메일 링크(비밀번호 재설정·가입 인증)를 눌러 들어왔는지 확인
const initialHash = location.hash;
const fromRecoveryLink = /(^|[#&])type=recovery(&|$)/.test(initialHash);
const linkError = (() => {
  const params = new URLSearchParams(initialHash.replace(/^#/, ''));
  return params.get('error_code') || params.get('error') ? params : null;
})();

// 로그인이 필요한 화면은 닉네임 정보까지 준비된 뒤에 그립니다
// skipConsent: 약관 동의 화면·탈퇴 화면처럼, 동의하지 않아도 들어갈 수 있어야 하는 화면
function needsProfile(renderPage, { skipConsent = false } = {}) {
  return async (params) => {
    if (!state.profile) {
      render(loadingScreen());
      try {
        await loadProfile();
      } catch (err) {
        return renderProfileError(friendlyError(err));
      }
      if (!state.profile) return renderProfileError('내 닉네임 정보를 찾을 수 없어요.');
    }
    // 최신 약관에 아직 동의하지 않았으면 동의 화면부터 (동의 후 원래 가려던 화면으로)
    if (!skipConsent && !hasConsented(state.session?.user)) {
      state.afterConsent = currentPath();
      return go('/consent', { replace: true });
    }
    return renderPage(params);
  };
}

// 운영자 계정만 볼 수 있는 화면
function adminOnly(renderPage) {
  return (params) => {
    if (isAdminUser(state.session?.user)) return renderPage(params);
    render(el('main', { class: 'page' },
      brandHeader(),
      el('section', { class: 'card center stack' },
        el('h1', {}, '운영자만 볼 수 있는 화면이에요'),
        el('p', { class: 'muted' }, '잘 안 되는 게 있으면 화면을 캡처해 내 정보 → 문의하기로 보내 주세요.'),
        el('a', { href: '#/home', class: 'btn btn-block' }, '홈으로'),
      ),
    ));
    return null;
  };
}

function renderProfileError(message) {
  render(el('main', { class: 'page' },
    brandHeader(),
    el('section', { class: 'card stack' },
      el('h1', {}, '정보를 불러오지 못했어요'),
      el('p', { class: 'muted' }, message),
      el('button', { class: 'btn btn-block', type: 'button', onclick: () => location.reload() }, '다시 시도'),
      el('button', {
        class: 'btn btn-secondary btn-block', type: 'button',
        onclick: async () => { await forgetThisDevice(); sb.auth.signOut(); },
      }, '로그아웃'),
    ),
  ));
}

// 연결 점검은 운영자(admin@dorantalk.com)만
route('/check', needsProfile(adminOnly(renderCheck), { skipConsent: true }));
route('/help', renderHelp, { access: 'any' });
route('/delete-account', renderDeleteGuide, { access: 'any' });
route('/privacy', renderPrivacy, { access: 'any' });
route('/terms', renderTerms, { access: 'any' });
route('/push-setup', renderPushSetup, { access: 'any' });
route('/welcome', () => { location.assign('/welcome'); }, { access: 'any' });
route('/consent', needsProfile(renderConsent, { skipConsent: true }));
route('/me/delete', needsProfile(renderDeleteAccount, { skipConsent: true }));
route('/login', renderLogin, { access: 'guest' });
route('/signup', renderSignup, { access: 'guest' });
// 만 14세 미만: 보호자가 보낸 가입 링크 (로그인된 기기에서 열면 로그아웃할지 물어봐요)
route('/signup/child/:token', renderChildSignup, { access: 'any' });
route('/forgot', renderForgot, { access: 'guest' });
route('/new-password', renderNewPassword, { access: 'auth' });
route('/home', needsProfile(renderHome));
route('/me', needsProfile(renderMe));
route('/me/children', needsProfile(renderChildren));
route('/me/children/consent', needsProfile(renderGuardianConsent));
route('/groups/new', needsProfile(renderNewGroup));
// 더 구체적인 주소를 먼저 등록해야 해요 (/group/:id/write 가 :tab 으로 잡히지 않게)
route('/group/:id/write', needsProfile(renderWrite));
route('/group/:id/post/:postId', needsProfile(renderPostDetail));
route('/group/:id/post/:postId/edit', needsProfile(renderWrite));
route('/group/:id/:tab', needsProfile(renderGroup));

setGuard((path, access) => {
  if (access === 'any') return null;
  if (access === 'auth' && !state.session) return '/login';
  if (state.recovery && state.session) return '/new-password';
  if (access === 'guest' && state.session) return '/home';
  return null;
});

function listenAuthChanges() {
  sb.auth.onAuthStateChange((event, session) => {
    const wasLoggedIn = Boolean(state.session);
    state.session = session;

    // Supabase 안내: 이 콜백 안에서 바로 다른 요청을 기다리면 멈출 수 있어 다음 차례로 미룹니다
    setTimeout(() => {
      if (event === 'PASSWORD_RECOVERY') {
        state.recovery = true;
        go('/new-password', { replace: true });
      } else if (event === 'SIGNED_OUT') {
        state.profile = null;
        state.recovery = false;
        // 자녀 가입 링크에서 로그아웃한 경우처럼, 로그아웃 뒤 갈 화면이 정해져 있으면 그리로
        go(state.afterSignOut || '/login', { replace: true });
        state.afterSignOut = null;
      } else if (event === 'SIGNED_IN' && !wasLoggedIn) {
        state.profile = null;
        state.autoOpen = true;
        refreshPush();
        go(state.recovery ? '/new-password' : '/home', { replace: true });
      }
    }, 0);
  });
}

function firstVisit() {
  try {
    if (localStorage.getItem('talkfeed.visited')) return false;
    // 예전부터 쓰던 기기(테마 · 로그인 기록이 있는 기기)는 처음 온 사람이 아니에요
    return !Object.keys(localStorage).some((k) => k.startsWith('sb-') || (k.startsWith('talkfeed.') && k !== 'talkfeed.from'));
  } catch {
    return false;
  }
}
function rememberVisit() {
  try { localStorage.setItem('talkfeed.visited', '1'); } catch { /* 무시 */ }
}

// "홈 화면에 추가" 신호는 앱이 열리자마자 올 수 있어서 가장 먼저 준비
setupInstall();

// 알림을 눌렀을 때 이미 열려 있는 앱이면 그 화면으로 이동
listenNotificationClicks((url) => {
  const target = new URL(url, location.href);
  if (target.origin === location.origin && target.hash) location.hash = target.hash;
});

// 지금 보고 있는 화면을 서비스 워커에 알려 줘요 (그 채팅방을 보고 있으면 알림을 띄우지 않으려고)
function tellScreen() {
  const visible = document.visibilityState === 'visible';
  navigator.serviceWorker?.controller?.postMessage({ type: 'screen', url: visible ? location.href : '' });
}
window.addEventListener('hashchange', tellScreen);
document.addEventListener('visibilitychange', tellScreen);
navigator.serviceWorker?.addEventListener('controllerchange', tellScreen);

async function start() {
  trackKeyboard();
  // 설정 파일에 문제가 있으면 연결 점검 화면만 보여 줌
  if (!checkConfig().ok) {
    renderCheck();
    return;
  }

  render(loadingScreen());
  // 메일 링크로 들어왔다면 이 과정에서 로그인 처리가 끝납니다
  const { data } = await sb.auth.getSession();
  state.session = data.session;

  // 처음 온 사람이 주소(dorantalk.com)만 입력해 들어오면 소개 화면부터 (홈 화면 앱 · 로그인한 사람 · 링크로 바로 온 경우는 제외)
  if (!state.session && !currentPath() && !isStandalone() && firstVisit()) {
    location.replace('/welcome');
    return;
  }
  rememberVisit();
  state.recovery = fromRecoveryLink && Boolean(data.session);

  listenAuthChanges();

  if (linkError) {
    const code = linkError.get('error_code');
    toast(code === 'otp_expired'
      ? '링크가 만료되었어요. 처음부터 다시 시도해 주세요.'
      : friendlyError({ code, message: linkError.get('error_description') || '' }), 5000);
  }

  if (state.recovery) {
    history.replaceState(null, '', '#/new-password');
  } else if (!currentPath()) {
    // 앱을 그냥 열었을 때: 가족 그룹이 하나뿐이면 홈에서 바로 그 그룹으로 넘어가요
    state.autoOpen = Boolean(state.session);
    history.replaceState(null, '', state.session ? '#/home' : '#/login');
  }
  await startRouter();
  tellScreen();
  if (state.session) refreshPush();
}

start();
