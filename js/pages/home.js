// 로그인한 뒤 보이는 화면: 홈, 내 정보
import { sb } from '../supabase.js';
import { state } from '../state.js';
import { go } from '../router.js';
import { friendlyError } from '../errors.js';
import { el, render, appBar, backButton, field, messageBox, setBusy, toast } from '../ui.js';
import { nicknameFormatError, checkNicknameAvailable, NICKNAME_HINT } from './auth.js';

function avatar(nickname, size = '') {
  return el('div', { class: `avatar ${size}`, 'aria-hidden': 'true' }, (nickname || '?').slice(0, 1));
}

function meButton() {
  return el('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: () => go('/me') },
    avatar(state.profile?.nickname, 'avatar-sm'), '내 정보');
}

// ------------------------------------------------------------------
// 홈 (3단계에서 가족 그룹 목록으로 채워집니다)
// ------------------------------------------------------------------
export function renderHome() {
  const nickname = state.profile?.nickname || '';
  render(
    appBar('TalkFeed', { right: meButton() }),
    el('main', { class: 'page' },
      el('section', { class: 'card welcome' },
        avatar(nickname, 'avatar-lg'),
        el('div', {},
          el('p', { class: 'welcome-hello' }, `안녕하세요, ${nickname}님 👋`),
          el('p', { class: 'muted', style: 'margin:0' }, '로그인되어 있어요.'),
        ),
      ),
      el('section', { class: 'card' },
        el('h2', {}, '우리 가족 그룹'),
        el('p', { class: 'muted' }, '가족 그룹 만들기와 초대 기능은 다음 단계(3단계)에서 여기에 생겨요.'),
      ),
    ),
  );
}

// ------------------------------------------------------------------
// 내 정보: 닉네임 바꾸기, 로그아웃
// ------------------------------------------------------------------
export function renderMe() {
  const profile = state.profile;
  const nick = el('input', {
    class: 'input', type: 'text', value: profile?.nickname || '', maxlength: 12,
    autocapitalize: 'off', spellcheck: 'false', required: true,
  });
  const msg = messageBox();
  const save = el('button', { class: 'btn btn-block', type: 'submit' }, '닉네임 저장');
  const headerAvatar = avatar(profile?.nickname, 'avatar-lg');
  const headerName = el('p', { class: 'welcome-hello' }, profile?.nickname || '');

  const nickForm = el('form', {
    class: 'card', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      msg.clear();
      const nickname = nick.value.trim();
      if (nickname === profile.nickname) return msg.show('지금 쓰는 닉네임과 같아요.', 'info');
      const formatError = nicknameFormatError(nickname);
      if (formatError) return msg.show(formatError);

      setBusy(save, true, '저장하는 중…');
      try {
        // 대소문자만 바꾸는 경우(예: jiwoo → Jiwoo)는 내 닉네임이라 중복 검사를 건너뜀
        const sameIgnoringCase = nickname.toLowerCase() === profile.nickname.toLowerCase();
        if (!sameIgnoringCase && !(await checkNicknameAvailable(nickname))) {
          throw new Error('이미 다른 사람이 쓰고 있어요. 다른 닉네임을 골라 주세요.');
        }
        const { data, error } = await sb.from('profiles')
          .update({ nickname })
          .eq('id', profile.id)
          .select('id, nickname, created_at')
          .single();
        if (error) throw error;
        state.profile = data;
        headerName.textContent = data.nickname;
        headerAvatar.textContent = data.nickname.slice(0, 1);
        msg.show('닉네임을 바꿨어요. 이제 가족들은 새 닉네임으로 나를 찾을 수 있어요.', 'success');
      } catch (err) {
        msg.show(friendlyError(err));
      } finally {
        setBusy(save, false);
      }
    },
  },
    el('h2', {}, '닉네임'),
    field('내 닉네임', nick, NICKNAME_HINT),
    msg,
    save,
  );

  const logout = el('button', {
    class: 'btn btn-secondary btn-block', type: 'button',
    onclick: async () => {
      if (!confirm('로그아웃할까요?')) return;
      setBusy(logout, true, '로그아웃하는 중…');
      const { error } = await sb.auth.signOut();
      setBusy(logout, false);
      if (error) return toast(friendlyError(error));
      // 로그아웃되면 app.js 가 로그인 화면으로 보냅니다
    },
  }, '로그아웃');

  render(
    appBar('내 정보', { left: backButton(() => go('/home')) }),
    el('main', { class: 'page' },
      el('section', { class: 'card welcome' },
        headerAvatar,
        el('div', {},
          headerName,
          el('p', { class: 'muted', style: 'margin:0' }, state.session?.user?.email || ''),
        ),
      ),
      nickForm,
      el('section', { class: 'card' },
        el('h2', {}, '계정'),
        el('p', { class: 'muted' }, '이 기기에서는 로그아웃하기 전까지 계속 로그인되어 있어요.'),
        logout,
      ),
    ),
  );
}
