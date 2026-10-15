// 로그인 · 회원가입 · 비밀번호 찾기 화면
import { sb } from '../supabase.js';
import { state, loadProfile } from '../state.js';
import { go } from '../router.js';
import { friendlyError } from '../errors.js';
import {
  el, render, brandHeader, brandHero, field, passwordInput, messageBox, setBusy, toast, icon,
} from '../ui.js';
import { inAppBrowserNotice } from '../install.js';
import { consentChecklist, legalLinks } from './legal.js';
import { consentRecord } from '../legal.js';

export const NICKNAME_RULE = /^[가-힣a-zA-Z0-9_]{2,12}$/;
export const NICKNAME_HINT = '2~12자, 한글·영어·숫자로 지어 주세요. 가족이 나를 초대할 때 이 이름으로 찾아요.';

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

export async function checkNicknameAvailable(nick) {
  const { data, error } = await sb.rpc('is_nickname_available', { nick });
  if (error) throw error;
  return data === true;
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
// ------------------------------------------------------------------
export function renderSignup() {
  const nick = el('input', {
    class: 'input', type: 'text', autocomplete: 'nickname', autocapitalize: 'off',
    spellcheck: 'false', maxlength: 12, required: true, placeholder: '예) 엄마, 큰아들, 지우',
  });
  const nickStatus = el('p', { class: 'nick-status', 'aria-live': 'polite' });
  const email = emailInput();
  const pw = passwordInput({ autocomplete: 'new-password', placeholder: '6자 이상' });
  const pw2 = passwordInput({ autocomplete: 'new-password', placeholder: '한 번 더 입력' });
  const msg = messageBox();
  const submit = el('button', { class: 'btn btn-block', type: 'submit' }, '가입하기');

  // 닉네임을 입력하면 0.5초 뒤 자동으로 사용 가능 여부를 확인
  let timer;
  let checkSeq = 0;
  const setNickStatus = (text, kind) => {
    nickStatus.textContent = text;
    nickStatus.className = `nick-status ${kind || ''}`;
  };
  nick.addEventListener('input', () => {
    clearTimeout(timer);
    const value = nick.value.trim();
    if (!value) return setNickStatus('', '');
    const formatError = nicknameFormatError(value);
    if (formatError) return setNickStatus(formatError, 'bad');
    setNickStatus('확인하는 중…', '');
    const seq = ++checkSeq;
    timer = setTimeout(async () => {
      try {
        const ok = await checkNicknameAvailable(value);
        if (seq !== checkSeq) return;
        setNickStatus(ok ? '✓ 사용할 수 있는 닉네임이에요.' : '이미 다른 사람이 쓰고 있어요. 다른 닉네임을 골라 주세요.', ok ? 'good' : 'bad');
      } catch {
        if (seq === checkSeq) setNickStatus('', '');
      }
    }, 500);
  });

  const consent = consentChecklist();

  const form = el('form', {
    class: 'card', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      msg.clear();
      const nickname = nick.value.trim();
      const emailValue = email.value.trim();
      const password = pw.input.value;

      const formatError = nicknameFormatError(nickname);
      if (formatError) return msg.show(formatError);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) return msg.show('이메일 주소를 정확히 입력해 주세요. (예: mom@naver.com)');
      if (password.length < 6) return msg.show('비밀번호는 6자 이상으로 정해 주세요.');
      if (password !== pw2.input.value) return msg.show('비밀번호 두 개가 서로 달라요. 다시 입력해 주세요.');
      if (!consent.isComplete()) return msg.show('아래 필수 항목에 모두 동의해 주세요. (만 14세 미만은 가입할 수 없어요)');

      setBusy(submit, true, '가입하는 중…');
      try {
        if (!(await checkNicknameAvailable(nickname))) {
          setNickStatus('이미 다른 사람이 쓰고 있어요. 다른 닉네임을 골라 주세요.', 'bad');
          throw new Error('이미 다른 사람이 쓰고 있는 닉네임이에요. 다른 닉네임을 골라 주세요.');
        }
        const { data, error } = await sb.auth.signUp({
          email: emailValue,
          password,
          options: {
            data: { nickname, ...consentRecord() },
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
        msg.show(friendlyError(err));
      } finally {
        setBusy(submit, false);
      }
    },
  },
    el('h1', {}, '회원가입'),
    el('div', { class: 'field' },
      el('label', { class: 'label', for: 'signup-nick' }, '닉네임'),
      Object.assign(nick, { id: 'signup-nick' }),
      nickStatus,
      el('p', { class: 'hint' }, NICKNAME_HINT),
    ),
    field('이메일', email, '로그인할 때 써요. 자주 쓰는 이메일을 넣어 주세요.'),
    field('비밀번호', pw, '6자 이상. 잊지 않게 따로 적어 두세요.'),
    field('비밀번호 확인', pw2),
    el('h2', { class: 'consent-title' }, '약관 동의'),
    consent,
    msg,
    submit,
  );

  render(el('main', { class: 'page' },
    brandHeader('가족과 함께 시작해요'),
    inAppBrowserNotice(),
    form,
    el('p', { class: 'center' },
      '이미 가입하셨나요? ', el('a', { href: '#/login', class: 'link-strong' }, '로그인')),
    legalLinks(),
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
      el('a', { href: '#/help', class: 'link-strong' }, '사용 방법'), ' · ',
      el('a', { href: '#/check', class: 'muted' }, '연결 점검')),
    legalLinks(),
  );
}
