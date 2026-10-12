// TalkFeed 시작 파일: 로그인 상태를 확인하고 알맞은 화면을 보여 줍니다.
import { sb, checkConfig } from './supabase.js';
import { state, loadProfile } from './state.js';
import { route, setGuard, startRouter, go, currentPath } from './router.js';
import { el, render, brandHeader, loadingScreen, toast } from './ui.js';
import { friendlyError } from './errors.js';
import { renderCheck } from './pages/check.js';
import { renderLogin, renderSignup, renderForgot, renderNewPassword } from './pages/auth.js';
import { renderHome, renderMe, renderNewGroup } from './pages/home.js';
import { renderGroup } from './pages/group.js';
import { renderWrite, renderPostDetail } from './pages/feed.js';

// 메일 링크(비밀번호 재설정·가입 인증)를 눌러 들어왔는지 확인
const initialHash = location.hash;
const fromRecoveryLink = /(^|[#&])type=recovery(&|$)/.test(initialHash);
const linkError = (() => {
  const params = new URLSearchParams(initialHash.replace(/^#/, ''));
  return params.get('error_code') || params.get('error') ? params : null;
})();

// 로그인이 필요한 화면은 닉네임 정보까지 준비된 뒤에 그립니다
function needsProfile(renderPage) {
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
    return renderPage(params);
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
        onclick: () => sb.auth.signOut(),
      }, '로그아웃'),
    ),
  ));
}

route('/check', renderCheck, { access: 'any' });
route('/login', renderLogin, { access: 'guest' });
route('/signup', renderSignup, { access: 'guest' });
route('/forgot', renderForgot, { access: 'guest' });
route('/new-password', renderNewPassword, { access: 'auth' });
route('/home', needsProfile(renderHome));
route('/me', needsProfile(renderMe));
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
        go('/login', { replace: true });
      } else if (event === 'SIGNED_IN' && !wasLoggedIn) {
        state.profile = null;
        state.autoOpen = true;
        go(state.recovery ? '/new-password' : '/home', { replace: true });
      }
    }, 0);
  });
}

async function start() {
  // 설정 파일에 문제가 있으면 연결 점검 화면만 보여 줌
  if (!checkConfig().ok) {
    renderCheck();
    return;
  }

  render(loadingScreen());
  // 메일 링크로 들어왔다면 이 과정에서 로그인 처리가 끝납니다
  const { data } = await sb.auth.getSession();
  state.session = data.session;
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
}

start();
