// 로그인 · 회원가입 · 비밀번호 찾기 화면
import { sb } from '../supabase.js';
import { state, loadProfile } from '../state.js';
import { go, currentPath } from '../router.js';
import { friendlyError } from '../errors.js';
import {
  el, render, brandHeader, brandHero, field, passwordInput, messageBox, setBusy, toast, icon, iconTile, loadingScreen,
  confirmDialog,
} from '../ui.js';
import { inAppBrowserNotice } from '../install.js';
import { consentChecklist, legalLinks } from './legal.js';
import { consentRecord, isChildUser, isReservedName, isAdminUser, ADMIN_EMAIL } from '../legal.js';
import { signupSource } from '../source.js';
import { forgetThisDevice } from '../push.js';

export const NICKNAME_RULE = /^[가-힣a-zA-Z0-9_]{2,12}$/;
export const NICKNAME_HINT = '2~12자. 그룹에서 보이는 이름이에요. 다른 사람과 같아도 괜찮아요.';
export const HANDLE_RULE = /^[가-힣a-zA-Z0-9_]{2,20}$/;
export const HANDLE_HINT = '2~20자, 한글·영어·숫자·밑줄(_). 다른 사람과 겹칠 수 없어요. 그룹에 초대받을 때 이 아이디로 찾아요.';

function emailInput(attrs = {}) {
  return el('input', {
    class: 'input', type: 'email', inputmode: 'email', autocomplete: 'email',
    autocapitalize: 'off', spellcheck: 'false', required: true, placeholder: '예) mom@naver.com', ...attrs,
  });
}

// 닉네임 형식만 먼저 검사 (서버에 묻기 전)
export function nicknameFormatError(nick) {
  if (!nick) return '닉네임을 입력해 주세요.';
  if (/\s/.test(nick)) return '닉네임에는 띄어쓰기를 쓸 수 없어요.';
  if (/[ㄱ-ㅎㅏ-ㅣ]/.test(nick)) return '완성된 글자로 입력해 주세요. (예: ㅎㅎ → 하하)';
  if (nick.length < 2) return '닉네임은 2자 이상이어야 해요.';
  if (nick.length > 12) return '닉네임은 12자까지 쓸 수 있어요.';
  if (!NICKNAME_RULE.test(nick)) return '한글, 영어, 숫자, 밑줄(_)만 쓸 수 있어요.';
  return null;
}

// 운영자인지: 로그인한 계정, 또는 가입할 때 적은 이메일이 운영자 이메일
function isAdminContext(email) {
  return isAdminUser(state.session?.user) || String(email || '').trim().toLowerCase() === ADMIN_EMAIL;
}

// "도란톡" · "관리자" 같은 이름은 운영자만 (가입 · 내 정보에서 이름을 정할 때)
export function reservedNameError(name, email) {
  if (!isReservedName(name) || isAdminContext(email)) return null;
  return '"도란톡" · "관리자" 같은 이름은 운영자만 쓸 수 있어요. 다른 이름을 골라 주세요.';
}

// 아이디 형식 검사 (서버에 묻기 전)
export function handleFormatError(h) {
  if (!h) return '아이디를 입력해 주세요.';
  if (/\s/.test(h)) return '아이디에는 띄어쓰기를 쓸 수 없어요.';
  if (/[ㄱ-ㅎㅏ-ㅣ]/.test(h)) return '완성된 글자로 입력해 주세요. (예: ㅎㅎ → 하하)';
  if (h.length < 2) return '아이디는 2자 이상이어야 해요.';
  if (h.length > 20) return '아이디는 20자까지 쓸 수 있어요.';
  if (!HANDLE_RULE.test(h)) return '한글, 영어, 숫자, 밑줄(_)만 쓸 수 있어요.';
  return null;
}

export async function checkHandleAvailable(h, email) {
  // 운영자 이름은 "쓸 수 없음"으로 나오지만, 운영자 본인은 써도 돼요 (겹치는지는 저장할 때 서버가 확인)
  if (isReservedName(h) && isAdminContext(email)) return true;
  const { data, error } = await sb.rpc('is_handle_available', { p_handle: h });
  // 예전 데이터베이스(버전 9 전)에는 아이디 확인 기능이 없어요 → 가입할 때 서버가 확인해요
  if (error?.code === 'PGRST202') return true;
  if (error) throw error;
  return data === true;
}

// 아이디 입력 칸: 입력하면 0.5초 뒤 자동으로 쓸 수 있는지 확인
// current: 지금 내 아이디 (내 정보에서 바꿀 때) — 대소문자만 다르면 내 아이디라 괜찮아요
export function handleField({ id, value = '', current = '' }) {
  const input = el('input', {
    class: 'input', type: 'text', id, value, autocomplete: 'off', autocapitalize: 'off',
    spellcheck: 'false', maxlength: 20, required: true, placeholder: '예) 지우_2014, 김씨네엄마',
  });
  const status = el('p', { class: 'nick-status', 'aria-live': 'polite' });
  const setStatus = (text, kind) => {
    status.textContent = text;
    status.className = `nick-status ${kind || ''}`;
  };
  let timer;
  let seq = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const value = input.value.trim();
    if (!value || (current && value.toLowerCase() === current.toLowerCase())) return setStatus('', '');
    const formatError = handleFormatError(value) || reservedNameError(value);
    if (formatError) return setStatus(formatError, 'bad');
    setStatus('확인하는 중…', '');
    const mine = ++seq;
    timer = setTimeout(async () => {
      try {
        const ok = await checkHandleAvailable(value);
        if (mine !== seq) return;
        setStatus(ok ? '✓ 쓸 수 있는 아이디예요.' : '이미 다른 사람이 쓰고 있어요. 다른 아이디를 골라 주세요.', ok ? 'good' : 'bad');
      } catch {
        if (mine === seq) setStatus('', '');
      }
    }, 500);
  });
  const wrap = el('div', { class: 'field' },
    el('label', { class: 'label', for: id }, '아이디'),
    input,
    status,
    el('p', { class: 'hint' }, HANDLE_HINT),
  );
  wrap.input = input;
  wrap.setStatus = setStatus;
  return wrap;
}

// ------------------------------------------------------------------
// 로그인
// ------------------------------------------------------------------
export function renderLogin() {
  const email = emailInput({ autocomplete: 'username' });
  const pw = passwordInput({ autocomplete: 'current-password', placeholder: '비밀번호' });
  const msg = messageBox();
  const submit = el('button', { class: 'btn btn-block', type: 'submit' }, '로그인');

  const form = el('form', {
    class: 'card', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      msg.clear();
      const emailValue = email.value.trim();
      if (!emailValue || !pw.input.value) {
        msg.show('이메일과 비밀번호를 모두 입력해 주세요.');
        return;
      }
      setBusy(submit, true, '로그인하는 중…');
      const { error } = await sb.auth.signInWithPassword({ email: emailValue, password: pw.input.value });
      setBusy(submit, false);
      if (error) {
        msg.show(friendlyError(error));
        return;
      }
      // 로그인 성공 → app.js 의 onAuthStateChange 가 홈으로 보냅니다
    },
  },
    el('h2', {}, '로그인'),
    field('이메일', email),
    field('비밀번호', pw),
    msg,
    submit,
    el('p', { class: 'center', style: 'margin:14px 0 0' },
      el('a', { href: '#/forgot', class: 'link-strong' }, '비밀번호를 잊으셨나요?')),
  );

  render(el('main', { class: 'page' },
    brandHero('도란톡', '가족끼리 나누는 따뜻한 소식과 채팅'),
    inAppBrowserNotice(),
    form,
    el('section', { class: 'card center' },
      el('p', { class: 'muted', style: 'margin-bottom:12px' }, '처음 오셨나요?'),
      el('a', { href: '#/signup', class: 'btn btn-tonal btn-block' }, '회원가입 하기'),
    ),
    footerLinks(),
  ));
}

// ------------------------------------------------------------------
// 회원가입
// child: { token, guardianNickname } — 보호자가 동의하고 보낸 링크로 들어온 만 14세 미만 (renderChildSignup 에서)
// ------------------------------------------------------------------
export function renderSignup(_params, child = null) {
  const handleBox = handleField({ id: 'signup-handle' });
  const nick = el('input', {
    class: 'input', type: 'text', autocomplete: 'nickname', autocapitalize: 'off',
    spellcheck: 'false', maxlength: 12, required: true, placeholder: '예) 엄마, 큰아들, 지우',
  });
  const email = emailInput();
  const pw = passwordInput({ autocomplete: 'new-password', placeholder: '6자 이상' });
  const pw2 = passwordInput({ autocomplete: 'new-password', placeholder: '한 번 더 입력' });
  const msg = messageBox();
  const submit = el('button', { class: 'btn btn-block', type: 'submit' }, '가입하기');

  const consent = consentChecklist(child ? { child: true } : { childHint: true });

  const form = el('form', {
    class: 'card', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      msg.clear();
      const handle = handleBox.input.value.trim();
      const nickname = nick.value.trim();
      const emailValue = email.value.trim();
      const password = pw.input.value;

      const handleError = handleFormatError(handle) || reservedNameError(handle, emailValue);
      if (handleError) return msg.show(handleError);
      const formatError = nicknameFormatError(nickname) || reservedNameError(nickname, emailValue);
      if (formatError) return msg.show(formatError);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) return msg.show('이메일 주소를 정확히 입력해 주세요. (예: mom@naver.com)');
      if (password.length < 6) return msg.show('비밀번호는 6자 이상으로 정해 주세요.');
      if (password !== pw2.input.value) return msg.show('비밀번호 두 개가 서로 달라요. 다시 입력해 주세요.');
      if (!consent.isComplete()) {
        return msg.show(child
          ? '아래 칸에 모두 체크해 주세요. 모르는 게 있으면 보호자에게 물어봐요.'
          : '아래 필수 항목에 모두 동의해 주세요. (만 14세 미만은 보호자가 보내 준 가입 링크로 가입해요)');
      }

      setBusy(submit, true, '가입하는 중…');
      try {
        if (!(await checkHandleAvailable(handle, emailValue))) {
          handleBox.setStatus('이미 다른 사람이 쓰고 있어요. 다른 아이디를 골라 주세요.', 'bad');
          throw new Error('이미 다른 사람이 쓰고 있는 아이디예요. 다른 아이디를 골라 주세요.');
        }
        const { data, error } = await sb.auth.signUp({
          email: emailValue,
          password,
          options: {
            data: {
              handle,
              nickname,
              ...consentRecord({ child: Boolean(child) }),
              ...(child ? { guardian_token: child.token } : {}),
              ...(signupSource() ? { signup_from: signupSource() } : {}),
            },
            emailRedirectTo: location.origin + location.pathname,
          },
        });
        if (error) throw error;

        // 이메일 인증을 켜 둔 경우, 이미 가입된 이메일이면 identities 가 비어서 옵니다
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          throw { code: 'user_already_exists' };
        }
        if (!data.session) {
          renderCheckEmail(emailValue);
          return;
        }
        toast(`${nickname}님, 환영해요! 🎉`);
        // 세션이 생기면 app.js 가 홈으로 보냅니다
      } catch (err) {
        // 자녀 가입: 그사이 링크가 만료·사용됐다면 그 안내를 보여 줌
        if (child && /database error saving new user/i.test(String(err?.message || ''))) {
          const status = await linkStatus(child.token).catch(() => null);
          if (status && status !== 'ok') return renderLinkProblem(status);
        }
        msg.show(friendlyError(err));
      } finally {
        setBusy(submit, false);
      }
    },
  },
    el('h1', {}, child ? '자녀 회원가입' : '회원가입'),
    handleBox,
    el('div', { class: 'field' },
      el('label', { class: 'label', for: 'signup-nick' }, '닉네임'),
      Object.assign(nick, { id: 'signup-nick' }),
      el('p', { class: 'hint' }, NICKNAME_HINT),
    ),
    field('이메일', email, child ? '로그인할 때 써요. 보호자가 만들어 준 이메일도 괜찮아요.' : '로그인할 때 써요. 자주 쓰는 이메일을 넣어 주세요.'),
    field('비밀번호', pw, '6자 이상. 잊지 않게 따로 적어 두세요.'),
    field('비밀번호 확인', pw2),
    el('h2', { class: 'consent-title' }, child ? '꼭 읽어 주세요' : '약관 동의'),
    consent,
    msg,
    submit,
  );

  render(el('main', { class: 'page' },
    brandHeader(child ? '보호자와 함께 시작해요' : '가족과 함께 시작해요'),
    inAppBrowserNotice(),
    child && el('section', { class: 'card guardian-ok' },
      iconTile('shield', 'green'),
      el('div', {},
        el('p', { class: 'guardian-ok-title' }, `보호자 ${child.guardianNickname}님이 가입을 허락했어요`),
        child.guardianHandle && el('p', { class: 'muted small' }, `보호자 아이디: ${child.guardianHandle}`),
        el('p', { class: 'muted' }, '아이디, 닉네임, 이메일, 비밀번호를 정해 줘. 모르는 게 있으면 보호자에게 물어봐요.'),
      ),
    ),
    form,
    el('p', { class: 'center' },
      '이미 가입하셨나요? ', el('a', { href: '#/login', class: 'link-strong' }, '로그인')),
    legalLinks(),
  ));
}

// ------------------------------------------------------------------
// 자녀(만 14세 미만) 회원가입: 보호자가 보낸 링크 #/signup/child/{링크 번호}
// ------------------------------------------------------------------
async function linkStatus(token) {
  const { data, error } = await sb.rpc('guardian_link_info', { p_token: token });
  if (error) throw error;
  return data?.[0] || { status: 'not_found' };
}

export async function renderChildSignup({ token }) {
  render(loadingScreen('가입 링크를 확인하는 중…'));
  let info;
  try {
    info = await linkStatus(token);
    if (state.session && !state.profile) await loadProfile();
  } catch (err) {
    render(el('main', { class: 'page' },
      brandHeader(),
      el('section', { class: 'card center stack' },
        el('h1', {}, '가입 링크를 확인하지 못했어요'),
        el('p', { class: 'muted' }, friendlyError(err)),
        el('button', { class: 'btn btn-block', type: 'button', onclick: () => renderChildSignup({ token }) }, '다시 시도'),
      ),
    ));
    return;
  }
  if (info.status !== 'ok') return renderLinkProblem(info.status);
  // 이 기기가 이미 누군가로 로그인되어 있으면: 그 계정에 동의를 연결할지, 로그아웃하고 새로 만들지
  if (state.session) return renderLoggedInChoice(token, info.guardian_nickname, info.guardian_handle);
  return renderSignup(null, { token, guardianNickname: info.guardian_nickname, guardianHandle: info.guardian_handle });
}

function renderLoggedInChoice(token, guardianNickname, guardianHandle) {
  const me = state.profile?.nickname || state.session.user?.email || '';
  // 닉네임은 겹칠 수 있어서 아이디로 비교해요
  const guardianSelf = guardianHandle
    ? (state.profile?.handle || '').toLowerCase() === guardianHandle.toLowerCase()
    : state.profile?.nickname === guardianNickname;
  const alreadyChild = isChildUser(state.session.user);
  const msg = messageBox();

  const logout = el('button', {
    class: `btn ${guardianSelf || alreadyChild ? '' : 'btn-secondary'} btn-block`, type: 'button',
    onclick: async () => {
      setBusy(logout, true, '로그아웃하는 중…');
      state.afterSignOut = currentPath();
      await forgetThisDevice();
      const { error } = await sb.auth.signOut();
      if (error) {
        state.afterSignOut = null;
        setBusy(logout, false);
        toast(friendlyError(error));
      }
    },
  }, '로그아웃하고 자녀 새 계정 만들기');

  // 예전에 가입한 자녀 계정에 보호자 동의 연결
  const attach = el('button', {
    class: 'btn btn-block', type: 'button',
    onclick: async () => {
      const ok = await confirmDialog({
        title: `${me} 계정에 보호자 동의를 연결할까요?`,
        message: `보호자 ${guardianNickname}님의 동의로 쓰는 자녀 계정이 돼요. 앞으로 그룹을 직접 만들 수 없고, 보호자가 있는 그룹에만 새로 초대받을 수 있어요. (지금 있는 그룹과 글은 그대로예요)`,
        confirmText: '연결하기',
      });
      if (!ok) return;
      msg.clear();
      setBusy(attach, true, '연결하는 중…');
      try {
        const { error } = await sb.rpc('attach_guardian_consent', { p_token: token });
        // 이미 연결된 경우(앞에서 연결은 됐는데 기록 저장만 실패했던 경우)는 기록만 다시 저장
        if (error && !/이미 보호자 동의가 연결된/.test(error.message || '')) throw error;
        const { data, error: saveError } = await sb.auth.updateUser({ data: consentRecord({ child: true }) });
        if (saveError) throw saveError;
        if (data?.user) state.session = { ...state.session, user: data.user };
        toast(`보호자 ${guardianNickname}님의 동의를 연결했어요 👍`, 4000);
        go('/me', { replace: true });
      } catch (err) {
        setBusy(attach, false);
        msg.show(friendlyError(err));
      }
    },
  }, '이 계정에 보호자 동의 연결하기');

  const head = [
    el('div', { class: 'empty-icon', 'aria-hidden': 'true' }, icon('user', { size: 34 })),
    el('h1', {}, '지금 로그인되어 있어요'),
    el('p', {}, el('strong', {}, me), ' 계정으로 로그인되어 있어요.'),
  ];
  const cancel = el('a', { href: '#/home', class: 'btn btn-ghost btn-block' }, '취소하고 돌아가기');

  if (guardianSelf || alreadyChild) {
    render(el('main', { class: 'page' },
      brandHeader('보호자와 함께 시작해요'),
      el('section', { class: 'card center stack' },
        ...head,
        el('p', { class: 'muted' }, guardianSelf
          ? `이 링크는 보호자 ${guardianNickname}님이 만든 링크예요. 자녀의 휴대폰에서 열거나, 이 기기에서 로그아웃한 뒤 자녀 계정을 만들어 주세요.`
          : '이 계정은 이미 보호자 동의가 연결되어 있어요. 다른 자녀의 계정을 만들려면 로그아웃해 주세요.'),
        logout,
        cancel,
      ),
    ));
    return;
  }

  render(el('main', { class: 'page' },
    brandHeader('보호자와 함께 시작해요'),
    el('section', { class: 'card center stack' }, ...head,
      el('p', { class: 'muted' }, `보호자 ${guardianNickname}님이 만든 자녀 가입 링크예요.`)),
    el('section', { class: 'card stack' },
      el('h2', {}, '이 계정이 만 14세 미만 자녀의 계정인가요?'),
      el('p', { class: 'muted' }, '예전에 가입한 자녀 계정이라면, 새로 만들지 않고 이 계정에 보호자 동의를 연결할 수 있어요.'),
      msg,
      attach,
    ),
    el('section', { class: 'card stack' },
      el('h2', {}, '자녀의 새 계정을 만들려면'),
      el('p', { class: 'muted' }, '먼저 로그아웃해야 해요. (지금 계정은 나중에 다시 로그인하면 돼요)'),
      logout,
    ),
    cancel,
  ));
}

function renderLinkProblem(status) {
  const [title, text] = {
    used: ['이미 사용한 링크예요', '이 링크로 이미 가입했어요. 가입한 계정으로 로그인해 주세요. 새로 가입하려면 보호자께 새 링크를 부탁해 주세요.'],
    expired: ['링크 기간이 지났어요', '가입 링크는 7일 동안만 쓸 수 있어요. 보호자께 새 링크를 부탁해 주세요.'],
  }[status] || ['링크 주소가 올바르지 않아요', '보호자가 보낸 링크를 그대로 눌러 열어 주세요. 주소가 잘렸을 수 있어요.'];
  render(el('main', { class: 'page' },
    brandHeader('보호자와 함께 시작해요'),
    el('section', { class: 'card center stack' },
      el('div', { class: 'empty-icon', 'aria-hidden': 'true' }, icon('lock', { size: 34 })),
      el('h1', {}, title),
      el('p', { class: 'muted' }, text),
      el('a', { href: '#/login', class: 'btn btn-secondary btn-block' }, '로그인 화면으로'),
    ),
  ));
}

function renderCheckEmail(email) {
  render(el('main', { class: 'page' },
    brandHeader(),
    el('section', { class: 'card center stack' },
      el('div', { class: 'empty-icon', 'aria-hidden': 'true' }, icon('mail', { size: 34 })),
      el('h1', {}, '메일함을 확인해 주세요'),
      el('p', {}, el('strong', {}, email), ' 로 인증 메일을 보냈어요.'),
      el('p', { class: 'muted' }, '메일 안의 링크를 누르면 가입이 끝나고 자동으로 로그인돼요. 메일이 안 보이면 스팸함도 확인해 주세요.'),
      el('a', { href: '#/login', class: 'btn btn-secondary btn-block' }, '로그인 화면으로'),
    ),
  ));
}

// ------------------------------------------------------------------
// 비밀번호 찾기 (메일로 재설정 링크 받기)
// ------------------------------------------------------------------
export function renderForgot() {
  const email = emailInput();
  const msg = messageBox();
  const submit = el('button', { class: 'btn btn-block', type: 'submit' }, '재설정 메일 받기');

  const form = el('form', {
    class: 'card', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      msg.clear();
      const emailValue = email.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) return msg.show('가입할 때 쓴 이메일을 정확히 입력해 주세요.');
      setBusy(submit, true, '보내는 중…');
      const { error } = await sb.auth.resetPasswordForEmail(emailValue, {
        redirectTo: location.origin + location.pathname,
      });
      setBusy(submit, false);
      if (error) return msg.show(friendlyError(error));
      msg.show('메일을 보냈어요! 메일 안의 링크를 누르면 새 비밀번호를 정할 수 있어요. (스팸함도 확인해 주세요)', 'success');
      submit.disabled = true;
    },
  },
    el('h1', {}, '비밀번호 찾기'),
    el('p', { class: 'muted' }, '가입한 이메일로 비밀번호를 새로 정하는 링크를 보내 드려요.'),
    field('이메일', email),
    msg,
    submit,
  );

  render(el('main', { class: 'page' },
    brandHeader(),
    form,
    el('p', { class: 'center' }, el('a', { href: '#/login', class: 'link-strong' }, '로그인으로 돌아가기')),
  ));
}

// ------------------------------------------------------------------
// 새 비밀번호 정하기 (메일 링크를 누르고 들어온 경우)
// ------------------------------------------------------------------
export function renderNewPassword() {
  const pw = passwordInput({ autocomplete: 'new-password', placeholder: '6자 이상' });
  const pw2 = passwordInput({ autocomplete: 'new-password', placeholder: '한 번 더 입력' });
  const msg = messageBox();
  const submit = el('button', { class: 'btn btn-block', type: 'submit' }, '새 비밀번호 저장');

  const form = el('form', {
    class: 'card', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      msg.clear();
      if (pw.input.value.length < 6) return msg.show('비밀번호는 6자 이상으로 정해 주세요.');
      if (pw.input.value !== pw2.input.value) return msg.show('비밀번호 두 개가 서로 달라요.');
      setBusy(submit, true, '저장하는 중…');
      const { error } = await sb.auth.updateUser({ password: pw.input.value });
      setBusy(submit, false);
      if (error) return msg.show(friendlyError(error));
      state.recovery = false;
      if (!state.profile) await loadProfile().catch(() => null);
      toast('새 비밀번호로 바꿨어요.');
      go('/home', { replace: true });
    },
  },
    el('h1', {}, '새 비밀번호 정하기'),
    field('새 비밀번호', pw, '6자 이상. 잊지 않게 따로 적어 두세요.'),
    field('새 비밀번호 확인', pw2),
    msg,
    submit,
  );

  render(el('main', { class: 'page' }, brandHeader(), form));
}

function footerLinks() {
  return el('div', {},
    el('p', { class: 'center small muted', style: 'margin-top:8px' },
      el('a', { href: '#/help', class: 'link-strong' }, '사용 방법')),
    legalLinks(),
  );
}
