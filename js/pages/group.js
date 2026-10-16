// 그룹 화면: 아래쪽 탭(소식 · 채팅 · 멤버)으로 이동합니다.
// 소식 탭은 pages/feed.js, 채팅 탭은 pages/chat.js 에 있어요.
import { sb } from '../supabase.js';
import { state } from '../state.js';
import { go, navToken, isStale } from '../router.js';
import { friendlyError } from '../errors.js';
import {
  el, render, appBar, backButton, field, messageBox, setBusy, toast, avatar, emptyState, errorCard,
  shareAppLink, icon, iconTile, confirmDialog, skeletonPosts,
} from '../ui.js';
import {
  fetchGroup, fetchMembers, fetchPendingInvites, inviteByHandle, cancelInvitation, leaveGroup,
  watchGroupMembers,
} from '../groups.js';
import { handleFormatError } from './auth.js';
import { timeAgo } from '../format.js';
import { renderFeedTab } from './feed.js';
import { renderChatTab } from './chat.js';
import { fetchUnreadCounts, watchNewMessages } from '../chat.js';
import { notifyFamily, setAppBadge } from '../push.js';

const TABS = [
  { key: 'feed', label: '소식', icon: 'feed' },
  { key: 'chat', label: '채팅', icon: 'chat' },
  { key: 'members', label: '멤버', icon: 'family' },
];

function tabBar(groupId, active) {
  return el('nav', { class: 'tabbar', 'aria-label': '그룹 메뉴' },
    el('div', { class: 'tabbar-inner' },
      ...TABS.map((t) => el('a', {
        href: `#/group/${groupId}/${t.key}`,
        class: `tab ${t.key === active ? 'active' : ''}`,
        'aria-current': t.key === active ? 'page' : false,
        // 지금 보고 있는 탭을 다시 누르면 새로 불러오기
        onclick: (e) => {
          if (t.key !== active) return;
          e.preventDefault();
          window.scrollTo(0, 0);
          go(`/group/${groupId}/${t.key}`);
        },
      },
        icon(t.icon, { size: 27 }),
        el('span', { class: 'tab-label' }, t.label),
        t.key === 'chat' && el('span', { class: 'tab-badge', hidden: true }),
      )),
    ),
  );
}

export async function renderGroup({ id, tab }) {
  if (!TABS.some((t) => t.key === tab)) return go(`/group/${id}/feed`, { replace: true });

  const token = navToken();
  render(appBar('', { left: backButton(() => go('/home'), '목록') }), el('main', { class: 'page' }, skeletonPosts(2)));

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
          emptyState('lock', '이 그룹을 볼 수 없어요', '그룹 멤버만 볼 수 있어요. 초대를 받았다면 홈에서 먼저 수락해 주세요.'),
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

  if (tab === 'chat') return renderChatTab(main, group, token);

  // 소식·멤버 탭에서는 채팅 탭에 안 읽은 메시지 수를 표시
  const stopBadge = chatBadge(group.id);
  const stopTab = tab === 'feed'
    ? await renderFeedTab(main, group, token)
    : await renderMembersTab(main, group, token);
  return () => {
    stopBadge();
    if (typeof stopTab === 'function') stopTab();
  };
}

function chatBadge(groupId) {
  const badge = document.querySelector('.tab-badge');
  const refresh = async () => {
    const counts = await fetchUnreadCounts().catch(() => null);
    if (!counts || !badge) return;
    setAppBadge(Object.values(counts).reduce((a, b) => a + b, 0));
    const n = counts[groupId] || 0;
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.hidden = n === 0;
    badge.setAttribute('aria-label', `안 읽은 메시지 ${n}개`);
  };
  refresh();
  const stop = watchNewMessages((msg) => {
    if (msg.sender_id !== state.session.user.id) refresh();
  }, groupId);
  const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    stop();
    document.removeEventListener('visibilitychange', onVisible);
  };
}

// ------------------------------------------------------------------
// 멤버 탭: 초대하기, 대기 중인 초대, 멤버 목록, 그룹 이름 바꾸기, 나가기
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
    class: 'input', type: 'text', maxlength: 20, autocapitalize: 'off', spellcheck: 'false',
    placeholder: '초대할 사람의 아이디',
  });
  const msg = messageBox();
  const submit = el('button', { class: 'btn btn-block', type: 'submit' }, '초대 보내기');

  return el('form', {
    class: 'card', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      msg.clear();
      const value = nick.value.trim();
      const formatError = handleFormatError(value);
      if (formatError) return msg.show(formatError);
      setBusy(submit, true, '보내는 중…');
      try {
        await inviteByHandle(group.id, value);
        notifyFamily('invite', group.id); // 초대받은 사람 휴대폰으로 알림 (이메일은 서버가 보내요)
        msg.show(`아이디 ${value}에게 초대를 보냈어요. 상대방이 도란톡 홈 화면이나 이메일에서 확인하고 수락하면 그룹에 들어와요.`, 'success');
        nick.value = '';
        onInvited();
      } catch (err) {
        msg.show(friendlyError(err));
      } finally {
        setBusy(submit, false);
      }
    },
  },
    el('div', { class: 'card-head' },
      iconTile('userPlus'),
      el('div', {}, el('h2', {}, '멤버 초대하기'), el('p', { class: 'muted' }, '아이디로 초대해요')),
    ),
    field('초대할 사람의 아이디', nick, '상대방의 내 정보 화면에 있는 아이디를 정확히 입력해 주세요. 초대하면 그 사람의 이메일로도 알려 드려요.'),
    msg,
    submit,
    el('div', { class: 'share-hint' },
      el('p', { class: 'muted small' }, '아직 가입하지 않은 사람이 있나요? 링크를 보내 가입을 부탁하고, 아이디를 알려 달라고 해 보세요.'),
      el('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: shareAppLink },
        icon('share', { size: 22 }), '도란톡 가입 링크 보내기'),
    ),
  );
}

function pendingCard(pending, refresh) {
  return el('div', { class: 'card' },
    el('h2', {}, `수락을 기다리는 초대 ${pending.length}개`),
    el('ul', { class: 'people' },
      ...pending.map((p) => {
        const cancel = el('button', { class: 'btn btn-ghost btn-small', type: 'button' }, '취소');
        cancel.addEventListener('click', async () => {
          if (!(await confirmDialog({ title: '초대를 취소할까요?', message: `${p.inviteeNickname}님에게 보낸 초대가 사라져요.`, confirmText: '초대 취소' }))) return;
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
            el('p', { class: 'person-name' }, p.inviteeNickname, p.inviteeHandle && el('span', { class: 'person-handle' }, `@${p.inviteeHandle}`)),
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
    el('h2', {}, `멤버 ${members.length}명`),
    el('ul', { class: 'people' },
      ...members.map((m) => el('li', { class: 'person' },
        avatar(m.nickname),
        el('div', { class: 'person-text' },
          el('p', { class: 'person-name' },
            m.nickname,
            m.user_id === myId && el('span', { class: 'badge' }, '나'),
            m.role === 'owner' && el('span', { class: 'badge badge-owner' }, '방장'),
          ),
          el('p', { class: 'muted small', style: 'margin:0' }, m.handle ? `@${m.handle} · ${timeAgo(m.joined_at)} 참여` : `${timeAgo(m.joined_at)} 참여`),
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
    const ok = await confirmDialog({
      title: `'${group.name}' 그룹에서 나갈까요?`,
      message: '나가면 이 그룹의 글과 채팅을 볼 수 없고, 다시 들어오려면 멤버에게 초대받아야 해요.',
      confirmText: '나가기', danger: true,
    });
    if (!ok) return;
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
