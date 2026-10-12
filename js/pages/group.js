// 가족 그룹 화면: 아래쪽 탭(피드 · 채팅 · 가족)으로 이동합니다.
// 3단계에서는 "가족" 탭(멤버 보기, 초대하기)이 동작하고, 피드·채팅은 4·5단계에서 채워집니다.
import { sb } from '../supabase.js';
import { state } from '../state.js';
import { go, navToken, isStale } from '../router.js';
import { friendlyError } from '../errors.js';
import {
  el, render, appBar, backButton, field, messageBox, setBusy, toast, avatar, emptyState, errorCard,
  loadingScreen,
} from '../ui.js';
import {
  fetchGroup, fetchMembers, fetchPendingInvites, inviteByNickname, cancelInvitation, leaveGroup,
  watchGroupMembers,
} from '../groups.js';
import { nicknameFormatError } from './auth.js';
import { timeAgo } from '../format.js';

const TABS = [
  { key: 'feed', label: '소식', icon: '📰' },
  { key: 'chat', label: '채팅', icon: '💬' },
  { key: 'members', label: '가족', icon: '👨‍👩‍👧' },
];

function tabBar(groupId, active) {
  return el('nav', { class: 'tabbar', 'aria-label': '그룹 메뉴' },
    el('div', { class: 'tabbar-inner' },
      ...TABS.map((t) => el('a', {
        href: `#/group/${groupId}/${t.key}`,
        class: `tab ${t.key === active ? 'active' : ''}`,
        'aria-current': t.key === active ? 'page' : false,
      },
        el('span', { class: 'tab-icon', 'aria-hidden': 'true' }, t.icon),
        el('span', { class: 'tab-label' }, t.label),
      )),
    ),
  );
}

export async function renderGroup({ id, tab }) {
  if (!TABS.some((t) => t.key === tab)) return go(`/group/${id}/feed`, { replace: true });

  const token = navToken();
  render(appBar('', { left: backButton(() => go('/home'), '목록') }), loadingScreen());

  let group;
  try {
    group = await fetchGroup(id);
  } catch (err) {
    if (isStale(token)) return undefined;
    render(
      appBar('', { left: backButton(() => go('/home'), '목록') }),
      el('main', { class: 'page' }, errorCard(friendlyError(err), () => renderGroup({ id, tab }))),
    );
    return undefined;
  }
  if (isStale(token)) return undefined;

  // 멤버가 아니면(초대 수락 전이거나 나간 그룹) 보안 규칙 때문에 그룹이 안 보여요
  if (!group) {
    render(
      appBar('', { left: backButton(() => go('/home'), '목록') }),
      el('main', { class: 'page' },
        el('section', { class: 'card' },
          emptyState('🔒', '이 그룹을 볼 수 없어요', '그룹 멤버만 볼 수 있어요. 초대를 받았다면 홈에서 먼저 수락해 주세요.'),
          el('a', { href: '#/home', class: 'btn btn-block' }, '홈으로'),
        ),
      ),
    );
    return undefined;
  }

  const main = el('main', { class: 'page page-with-tabs' });
  render(
    appBar(group.name, { left: backButton(() => go('/home'), '목록') }),
    main,
    tabBar(group.id, tab),
  );

  if (tab === 'feed') {
    main.append(el('section', { class: 'card' },
      emptyState('📰', '가족 소식은 곧 생겨요', '글과 사진 올리기, 댓글, 하트는 4단계에서 여기에 만들어져요.')));
    return undefined;
  }
  if (tab === 'chat') {
    main.append(el('section', { class: 'card' },
      emptyState('💬', '가족 채팅방은 곧 생겨요', '실시간 채팅은 5단계에서 여기에 만들어져요.')));
    return undefined;
  }
  return renderMembersTab(main, group, token);
}

// ------------------------------------------------------------------
// 가족 탭: 초대하기, 대기 중인 초대, 멤버 목록, 그룹 이름 바꾸기, 나가기
// ------------------------------------------------------------------
async function renderMembersTab(main, group, token) {
  const myId = state.session.user.id;
  const isOwner = group.created_by === myId;

  const inviteSection = inviteForm(group, () => refresh());
  const pendingBox = el('section', {});
  const membersBox = el('section', {});

  main.append(inviteSection, pendingBox, membersBox);
  if (isOwner) main.append(renameForm(group));
  main.append(leaveSection(group));

  async function refresh() {
    try {
      const [members, pending] = await Promise.all([fetchMembers(group.id), fetchPendingInvites(group.id)]);
      if (isStale(token)) return;
      pendingBox.replaceChildren(...(pending.length ? [pendingCard(pending, refresh)] : []));
      membersBox.replaceChildren(membersCard(members, myId));
    } catch (err) {
      if (!isStale(token)) membersBox.replaceChildren(errorCard(friendlyError(err), refresh));
    }
  }

  await refresh();
  // 누가 초대를 수락하거나 나가면 바로 반영
  return watchGroupMembers(group.id, refresh);
}

function inviteForm(group, onInvited) {
  const nick = el('input', {
    class: 'input', type: 'text', maxlength: 12, autocapitalize: 'off', spellcheck: 'false',
    placeholder: '가족의 닉네임',
  });
  const msg = messageBox();
  const submit = el('button', { class: 'btn btn-block', type: 'submit' }, '초대 보내기');

  return el('form', {
    class: 'card', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      msg.clear();
      const value = nick.value.trim();
      const formatError = nicknameFormatError(value);
      if (formatError) return msg.show(formatError);
      setBusy(submit, true, '보내는 중…');
      try {
        await inviteByNickname(group.id, value);
        msg.show(`${value}님에게 초대를 보냈어요. ${value}님이 앱에서 수락하면 그룹에 들어와요.`, 'success');
        nick.value = '';
        onInvited();
      } catch (err) {
        msg.show(friendlyError(err));
      } finally {
        setBusy(submit, false);
      }
    },
  },
    el('h2', {}, '가족 초대하기'),
    field('초대할 가족의 닉네임', nick, '가족이 TalkFeed에 가입할 때 정한 닉네임을 정확히 입력해 주세요.'),
    msg,
    submit,
  );
}

function pendingCard(pending, refresh) {
  return el('div', { class: 'card' },
    el('h2', {}, `수락을 기다리는 초대 ${pending.length}개`),
    el('ul', { class: 'people' },
      ...pending.map((p) => {
        const cancel = el('button', { class: 'btn btn-ghost btn-small', type: 'button' }, '취소');
        cancel.addEventListener('click', async () => {
          if (!confirm(`${p.inviteeNickname}님에게 보낸 초대를 취소할까요?`)) return;
          setBusy(cancel, true, '');
          try {
            await cancelInvitation(p.id);
            toast('초대를 취소했어요.');
          } catch (err) {
            toast(friendlyError(err), 4000);
          }
          refresh();
        });
        return el('li', { class: 'person' },
          avatar(p.inviteeNickname),
          el('div', { class: 'person-text' },
            el('p', { class: 'person-name' }, p.inviteeNickname),
            el('p', { class: 'muted small', style: 'margin:0' }, `${p.inviterNickname}님이 초대 · ${timeAgo(p.created_at)}`),
          ),
          cancel,
        );
      }),
    ),
  );
}

function membersCard(members, myId) {
  return el('div', { class: 'card' },
    el('h2', {}, `우리 가족 ${members.length}명`),
    el('ul', { class: 'people' },
      ...members.map((m) => el('li', { class: 'person' },
        avatar(m.nickname),
        el('div', { class: 'person-text' },
          el('p', { class: 'person-name' },
            m.nickname,
            m.user_id === myId && el('span', { class: 'badge' }, '나'),
            m.role === 'owner' && el('span', { class: 'badge badge-owner' }, '방장'),
          ),
          el('p', { class: 'muted small', style: 'margin:0' }, `${timeAgo(m.joined_at)} 참여`),
        ),
      )),
    ),
  );
}

function renameForm(group) {
  const name = el('input', { class: 'input', type: 'text', maxlength: 30, value: group.name });
  const msg = messageBox();
  const submit = el('button', { class: 'btn btn-secondary btn-block', type: 'submit' }, '이름 저장');
  return el('form', {
    class: 'card', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      msg.clear();
      const value = name.value.trim();
      if (!value) return msg.show('그룹 이름을 입력해 주세요.');
      if (value === group.name) return msg.show('지금 이름과 같아요.', 'info');
      setBusy(submit, true, '저장하는 중…');
      const { error } = await sb.from('family_groups').update({ name: value }).eq('id', group.id);
      setBusy(submit, false);
      if (error) return msg.show(friendlyError(error));
      group.name = value;
      document.querySelector('.appbar-title').textContent = value;
      msg.show('그룹 이름을 바꿨어요.', 'success');
    },
  },
    el('h2', {}, '그룹 이름 바꾸기'),
    field('그룹 이름', name, '방장만 바꿀 수 있어요.'),
    msg,
    submit,
  );
}

function leaveSection(group) {
  const leave = el('button', { class: 'btn btn-ghost btn-block btn-danger-text', type: 'button' }, '이 그룹에서 나가기');
  leave.addEventListener('click', async () => {
    if (!confirm(`'${group.name}' 그룹에서 나갈까요?\n나가면 이 그룹의 글과 채팅을 볼 수 없고, 다시 들어오려면 가족에게 초대받아야 해요.`)) return;
    setBusy(leave, true, '나가는 중…');
    try {
      await leaveGroup(group.id);
      toast('그룹에서 나왔어요.');
      go('/home', { replace: true });
    } catch (err) {
      setBusy(leave, false);
      toast(friendlyError(err), 4000);
    }
  });
  return el('div', { style: 'margin-top:8px' }, leave);
}
