// 로그인한 뒤 보이는 화면: 홈(받은 초대 + 내 가족 그룹), 새 그룹 만들기, 내 정보
import { sb } from '../supabase.js';
import { state } from '../state.js';
import { go, navToken, isStale } from '../router.js';
import { friendlyError } from '../errors.js';
import {
  el, render, appBar, backButton, field, messageBox, setBusy, toast, avatar, emptyState, errorCard,
  loadingScreen,
} from '../ui.js';
import { nicknameFormatError, checkNicknameAvailable, NICKNAME_HINT } from './auth.js';
import {
  fetchMyGroups, fetchMyInvitations, respondInvitation, createGroup, watchMyInvitations,
} from '../groups.js';
import { timeAgo } from '../format.js';

function meButton() {
  return el('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: () => go('/me') },
    avatar(state.profile?.nickname, 'avatar-sm'), '내 정보');
}

// ------------------------------------------------------------------
// 홈: 받은 초대 + 내 가족 그룹 목록
// ------------------------------------------------------------------
export async function renderHome() {
  const token = navToken();
  const content = el('main', { class: 'page' }, loadingScreen());
  render(appBar('TalkFeed', { right: meButton() }), content);

  async function load() {
    let groups;
    let invites;
    try {
      [groups, invites] = await Promise.all([fetchMyGroups(), fetchMyInvitations()]);
    } catch (err) {
      if (!isStale(token)) content.replaceChildren(errorCard(friendlyError(err), load));
      return;
    }
    if (isStale(token)) return;

    // 앱을 처음 열었을 때 그룹이 하나뿐이면 바로 그 그룹으로
    if (state.autoOpen) {
      state.autoOpen = false;
      if (groups.length === 1 && invites.length === 0) {
        go(`/group/${groups[0].id}/feed`, { replace: true });
        return;
      }
    }

    content.replaceChildren(
      ...(invites.length > 0 ? [invitationsSection(invites, load)] : []),
      groupsSection(groups),
    );
  }

  await load();

  // 초대가 새로 오면 바로 보여 주기 + 앱으로 돌아왔을 때 새로고침
  const stopWatching = watchMyInvitations(load);
  const onVisible = () => { if (document.visibilityState === 'visible') load(); };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    stopWatching();
    document.removeEventListener('visibilitychange', onVisible);
  };
}

function invitationsSection(invites, reload) {
  return el('section', { class: 'invites' },
    el('h2', { class: 'section-title' }, `📩 받은 초대 ${invites.length}개`),
    ...invites.map((inv) => invitationCard(inv, reload)),
  );
}

function invitationCard(inv, reload) {
  const msg = messageBox();
  const accept = el('button', { class: 'btn', type: 'button' }, '수락하기');
  const decline = el('button', { class: 'btn btn-secondary', type: 'button' }, '거절');

  accept.addEventListener('click', async () => {
    msg.clear();
    setBusy(accept, true, '들어가는 중…');
    decline.disabled = true;
    try {
      const groupId = await respondInvitation(inv.id, true);
      toast(`'${inv.group_name}' 그룹에 들어왔어요! 🎉`);
      go(`/group/${groupId}/feed`);
    } catch (err) {
      msg.show(friendlyError(err));
      setBusy(accept, false);
      decline.disabled = false;
    }
  });

  decline.addEventListener('click', async () => {
    if (!confirm(`'${inv.group_name}' 그룹 초대를 거절할까요?`)) return;
    msg.clear();
    setBusy(decline, true, '거절하는 중…');
    accept.disabled = true;
    try {
      await respondInvitation(inv.id, false);
      toast('초대를 거절했어요.');
      reload();
    } catch (err) {
      msg.show(friendlyError(err));
      setBusy(decline, false);
      accept.disabled = false;
    }
  });

  return el('article', { class: 'card invite-card' },
    el('p', { class: 'invite-from' }, `${inv.inviter_nickname || '가족'}님이 초대했어요 · ${timeAgo(inv.created_at)}`),
    el('p', { class: 'invite-group' }, inv.group_name),
    el('p', { class: 'muted small', style: 'margin:0 0 14px' }, '수락하면 이 그룹의 글과 채팅을 함께 볼 수 있어요.'),
    msg,
    el('div', { class: 'btn-row' }, accept, decline),
  );
}

function groupsSection(groups) {
  const createBtn = el('a', { href: '#/groups/new', class: 'btn btn-block' }, '+ 새 가족 그룹 만들기');

  if (groups.length === 0) {
    return el('section', {},
      el('h2', { class: 'section-title' }, '우리 가족 그룹'),
      el('div', { class: 'card' },
        emptyState('🏡', '아직 가족 그룹이 없어요',
          '가족 그룹을 새로 만들거나, 가족에게 초대를 받아 보세요.'),
        el('div', { class: 'my-nick' },
          el('p', { class: 'muted small', style: 'margin:0' }, '가족에게 이 닉네임을 알려 주면 초대받을 수 있어요'),
          el('p', { class: 'my-nick-value' }, state.profile?.nickname || ''),
        ),
        createBtn,
      ),
    );
  }

  return el('section', {},
    el('h2', { class: 'section-title' }, '우리 가족 그룹'),
    el('ul', { class: 'group-list' },
      ...groups.map((g) => el('li', {},
        el('a', { href: `#/group/${g.id}/feed`, class: 'group-item' },
          el('div', { class: 'group-icon', 'aria-hidden': 'true' }, '👨‍👩‍👧‍👦'),
          el('div', { class: 'group-text' },
            el('p', { class: 'group-name' }, g.name),
            el('p', { class: 'muted small', style: 'margin:0' }, `가족 ${g.memberCount}명`),
          ),
          el('span', { class: 'chevron', 'aria-hidden': 'true' }, '›'),
        ),
      )),
    ),
    createBtn,
  );
}

// ------------------------------------------------------------------
// 새 가족 그룹 만들기
// ------------------------------------------------------------------
export function renderNewGroup() {
  const name = el('input', {
    class: 'input', type: 'text', maxlength: 30, required: true, placeholder: '예) 우리 가족, 김씨네',
  });
  const msg = messageBox();
  const submit = el('button', { class: 'btn btn-block', type: 'submit' }, '그룹 만들기');

  const form = el('form', {
    class: 'card', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      msg.clear();
      const value = name.value.trim();
      if (!value) return msg.show('그룹 이름을 입력해 주세요.');
      setBusy(submit, true, '만드는 중…');
      try {
        const groupId = await createGroup(value);
        toast(`'${value}' 그룹을 만들었어요! 이제 가족을 초대해 보세요.`, 3500);
        go(`/group/${groupId}/members`, { replace: true });
      } catch (err) {
        msg.show(friendlyError(err));
        setBusy(submit, false);
      }
    },
  },
    el('h1', {}, '새 가족 그룹'),
    field('그룹 이름', name, '가족 모두가 보는 이름이에요. 나중에 바꿀 수 있어요.'),
    msg,
    submit,
  );

  render(
    appBar('그룹 만들기', { left: backButton(() => go('/home')) }),
    el('main', { class: 'page' },
      form,
      el('p', { class: 'muted small center' }, '그룹을 만들면 내가 방장이 되고, 가족을 닉네임으로 초대할 수 있어요.'),
    ),
  );
  name.focus();
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
