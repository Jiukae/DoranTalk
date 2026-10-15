// 로그인한 뒤 보이는 화면: 홈(받은 초대 + 내 가족 그룹), 새 그룹 만들기, 내 정보
import { sb } from '../supabase.js';
import { state } from '../state.js';
import { go, navToken, isStale } from '../router.js';
import { friendlyError } from '../errors.js';
import {
  el, render, appBar, backButton, field, messageBox, setBusy, toast, avatar, emptyState, errorCard,
  icon, iconTile, brandMark, listRow, skeletonRows, colorIndex, confirmDialog,
} from '../ui.js';
import { nicknameFormatError, checkNicknameAvailable, NICKNAME_HINT } from './auth.js';
import {
  fetchMyGroups, fetchMyInvitations, respondInvitation, createGroup, watchMyInvitations,
} from '../groups.js';
import { timeAgo } from '../format.js';
import { fetchUnreadCounts, watchNewMessages } from '../chat.js';
import { APP_VERSION } from '../version.js';
import { installBanner, inAppBrowserNotice } from '../install.js';
import { THEMES, getTheme, setTheme } from '../theme.js';
import { CONTACT_EMAIL } from '../legal.js';
import {
  pushStatus, pushServerInfo, isPushOn, enablePush, disablePush, sendTestPush, setAppBadge,
  shouldPromptPush, dismissPushPrompt, forgetThisDevice,
} from '../push.js';
import { platform } from '../install.js';

function meButton() {
  return el('button', { class: 'btn btn-ghost btn-small me-btn', type: 'button', onclick: () => go('/me') },
    avatar(state.profile?.nickname, 'avatar-sm'), '내 정보');
}

// 그룹 이름 첫 글자가 들어간 둥근 네모 (그룹마다 다른 색)
export function groupIcon(name) {
  return el('div', { class: `group-icon av-${colorIndex(name)}`, 'aria-hidden': 'true' }, (name || '?').slice(0, 1));
}

// ------------------------------------------------------------------
// 홈: 받은 초대 + 내 가족 그룹 목록
// ------------------------------------------------------------------
export async function renderHome() {
  const token = navToken();
  const content = el('main', { class: 'page' }, skeletonRows(2));
  render(appBar('', { left: brandMark(), right: meButton() }), content);

  async function load() {
    let groups;
    let invites;
    let unread;
    try {
      [groups, invites, unread] = await Promise.all([
        fetchMyGroups(), fetchMyInvitations(), fetchUnreadCounts().catch(() => ({})),
      ]);
    } catch (err) {
      if (!isStale(token)) content.replaceChildren(errorCard(friendlyError(err), load));
      return;
    }
    if (isStale(token)) return;

    // 앱을 처음 열었을 때 그룹이 하나뿐이면 바로 그 그룹으로
    if (state.autoOpen) {
      state.autoOpen = false;
      if (groups.length === 1 && invites.length === 0) {
        go(`/group/${groups[0].id}/${unread[groups[0].id] > 0 ? 'chat' : 'feed'}`, { replace: true });
        return;
      }
    }

    setAppBadge(Object.values(unread).reduce((a, b) => a + b, 0));
    content.replaceChildren(
      ...[inAppBrowserNotice() || installBanner()].filter(Boolean),
      ...(invites.length > 0 ? [invitationsSection(invites, load)] : []),
      groupsSection(groups, unread),
    );
    // 가족 그룹이 있고 아직 알림을 묻지 않았다면 "알림 켜기" 안내 (알림 서버가 준비된 경우만)
    if (groups.length > 0 && shouldPromptPush()) {
      pushServerInfo().then((info) => {
        if (info.ready && !isStale(token) && shouldPromptPush() && content.isConnected && !content.querySelector('.push-prompt')) {
          content.prepend(pushPrompt());
        }
      });
    }
  }

  await load();

  // 초대가 새로 오면 바로 보여 주기 + 앱으로 돌아왔을 때 새로고침
  const stopWatching = watchMyInvitations(load);
  // 가족이 채팅을 보내면 그룹 옆 숫자를 새로
  let timer = null;
  const stopMessages = watchNewMessages((msg) => {
    if (msg.sender_id === state.session.user.id) return;
    clearTimeout(timer);
    timer = setTimeout(load, 500);
  });
  const onVisible = () => { if (document.visibilityState === 'visible') load(); };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    stopWatching();
    stopMessages();
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

// 홈 맨 위의 "알림 켜기" 안내
function pushPrompt() {
  const box = el('div', { class: 'notice notice-install push-prompt' });
  const on = el('button', { class: 'btn', type: 'button' }, '알림 켜기');
  const later = el('button', {
    class: 'btn btn-ghost btn-small', type: 'button',
    onclick: () => { dismissPushPrompt(); box.remove(); },
  }, '나중에');
  on.addEventListener('click', async () => {
    setBusy(on, true, '켜는 중…');
    try {
      await enablePush();
      box.remove();
      toast('알림을 켰어요! 가족이 채팅을 보내면 알려 드릴게요. 🔔', 3500);
    } catch (err) {
      setBusy(on, false);
      dismissPushPrompt();
      toast(pushErrorText(err), 5000);
      if (err.code === 'denied') box.remove();
    }
  });
  box.append(
    el('div', { class: 'notice-head' }, iconTile('bell'), el('p', { class: 'notice-title' }, '새 채팅이 오면 알려 드릴까요?')),
    el('p', {}, '앱을 닫아 두어도 카카오톡처럼 휴대폰에 알림이 와요.'),
    el('div', { class: 'btn-row' }, on, later),
  );
  return box;
}

function pushErrorText(err) {
  if (err?.code === 'denied' || err?.message === 'denied') return '알림이 막혀 있어요. 내 정보 → 알림에서 허용하는 방법을 확인해 주세요.';
  if (err?.code === 'default' || err?.message === 'dismissed') return '알림을 켜려면 휴대폰이 묻는 창에서 "허용"을 눌러 주세요.';
  if (err?.message === 'server-not-ready') return '알림 서버가 아직 준비되지 않았어요.';
  return friendlyError(err);
}

function invitationsSection(invites, reload) {
  return el('section', { class: 'invites' },
    el('h2', { class: 'section-title' }, '받은 초대 ', el('span', { class: 'count' }, String(invites.length))),
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
    const ok = await confirmDialog({
      title: '초대를 거절할까요?', message: `'${inv.group_name}' 그룹에 들어가지 않아요.`, confirmText: '거절하기',
    });
    if (!ok) return;
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
    el('div', { class: 'invite-head' },
      groupIcon(inv.group_name),
      el('div', {},
        el('p', { class: 'invite-from' }, `${inv.inviter_nickname || '가족'}님이 초대했어요 · ${timeAgo(inv.created_at)}`),
        el('p', { class: 'invite-group' }, inv.group_name),
      ),
    ),
    el('p', { class: 'muted small', style: 'margin:0 0 16px' }, '수락하면 이 그룹의 글과 채팅을 함께 볼 수 있어요.'),
    msg,
    el('div', { class: 'btn-row' }, accept, decline),
  );
}

function groupsSection(groups, unread = {}) {
  const createBtn = el('a', { href: '#/groups/new', class: `btn btn-block ${groups.length ? 'btn-tonal' : ''}` },
    icon('plus'), '새 가족 그룹 만들기');

  if (groups.length === 0) {
    return el('section', {},
      el('h2', { class: 'section-title' }, '우리 가족 그룹'),
      el('div', { class: 'card' },
        emptyState('home', '아직 가족 그룹이 없어요',
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
        // 안 읽은 채팅이 있으면 바로 채팅방으로
        el('a', { href: `#/group/${g.id}/${unread[g.id] > 0 ? 'chat' : 'feed'}`, class: 'group-item' },
          groupIcon(g.name),
          el('div', { class: 'group-text' },
            el('p', { class: 'group-name' }, g.name),
            el('p', { class: 'group-sub' }, unread[g.id] > 0 ? `새 채팅 ${unread[g.id]}개 · 가족 ${g.memberCount}명` : `가족 ${g.memberCount}명`),
          ),
          unread[g.id] > 0 && el('span', { class: 'unread-badge', 'aria-label': `안 읽은 메시지 ${unread[g.id]}개` },
            unread[g.id] > 99 ? '99+' : String(unread[g.id])),
          icon('chevronRight', { size: 22, className: 'chevron' }),
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
        headerAvatar.className = `avatar avatar-lg av-${colorIndex(data.nickname)}`;
        msg.show('닉네임을 바꿨어요. 이제 가족들은 새 닉네임으로 나를 찾을 수 있어요.', 'success');
      } catch (err) {
        msg.show(friendlyError(err));
      } finally {
        setBusy(save, false);
      }
    },
  },
    el('h2', {}, '닉네임 바꾸기'),
    field('내 닉네임', nick, NICKNAME_HINT),
    msg,
    save,
  );

  const logout = el('button', {
    class: 'btn btn-secondary btn-block', type: 'button',
    onclick: async () => {
      if (!(await confirmDialog({ title: '로그아웃할까요?', message: '다시 들어올 때 이메일과 비밀번호가 필요해요.', confirmText: '로그아웃' }))) return;
      setBusy(logout, true, '로그아웃하는 중…');
      await forgetThisDevice();
      const { error } = await sb.auth.signOut();
      setBusy(logout, false);
      if (error) return toast(friendlyError(error));
      // 로그아웃되면 app.js 가 로그인 화면으로 보냅니다
    },
  }, icon('logout', { size: 22 }), '로그아웃');

  render(
    appBar('내 정보', { left: backButton(() => go('/home')) }),
    el('main', { class: 'page' },
      el('section', { class: 'card profile-card' },
        headerAvatar,
        el('div', { style: 'min-width:0' },
          headerName,
          el('p', { class: 'muted' }, state.session?.user?.email || ''),
        ),
      ),
      pushCard(),
      nickForm,
      themePicker(),
      el('h2', { class: 'section-title' }, '도움말 · 안내'),
      el('section', { class: 'card list-card' },
        listRow({ icon: 'help', label: '사용 방법', sub: '홈 화면에 추가, 글 쓰기, 채팅', href: '#/help', tone: 'blue' }),
        listRow({ icon: 'activity', label: '연결 점검', sub: '잘 안 될 때 확인해 보세요', href: '#/check', tone: 'green' }),
        listRow({ icon: 'mail', label: '문의하기', sub: CONTACT_EMAIL, href: `mailto:${CONTACT_EMAIL}`, tone: 'violet' }),
        listRow({ icon: 'document', label: '이용약관', href: '#/terms', tone: 'gray' }),
        listRow({ icon: 'shield', label: '개인정보처리방침', href: '#/privacy', tone: 'gray' }),
      ),
      el('h2', { class: 'section-title' }, '계정'),
      el('section', { class: 'card' },
        el('p', { class: 'muted' }, '이 기기에서는 로그아웃하기 전까지 계속 로그인되어 있어요.'),
        logout,
        el('a', { href: '#/me/delete', class: 'btn btn-ghost btn-block btn-danger-text', style: 'margin-top:8px' }, '회원 탈퇴'),
      ),
      el('p', { class: 'app-version' }, `앱 버전: ${APP_VERSION}`),
    ),
  );
}

// ------------------------------------------------------------------
// 알림 켜기 · 끄기 (내 정보 화면)
// ------------------------------------------------------------------
function deniedHelp() {
  const p = platform();
  const steps = p === 'ios'
    ? '아이폰 설정 → 알림 → 도란톡 → "알림 허용"을 켜 주세요.'
    : p === 'android'
      ? '크롬 주소창 왼쪽 아이콘(또는 ⋮ → 설정) → 사이트 설정 → 알림 → dorantalk.com 을 "허용"으로 바꿔 주세요. 홈 화면 앱이라면: 휴대폰 설정 → 애플리케이션 → 도란톡 → 알림 켜기.'
      : '주소창 왼쪽 자물쇠(또는 설정) 아이콘 → 알림 → "허용"으로 바꿔 주세요.';
  return [
    el('p', { class: 'form-msg error' }, '이 기기에서 알림이 막혀 있어요.'),
    el('p', { class: 'muted' }, steps, ' 그다음 이 화면을 새로고침해 주세요.'),
  ];
}

function pushCard() {
  const box = el('section', { class: 'card push-card' });
  const head = el('div', { class: 'card-head' },
    iconTile('bell'),
    el('div', {}, el('h2', {}, '알림'), el('p', { class: 'muted' }, '채팅 · 새 소식 · 댓글 · 초대')),
  );
  const msg = messageBox();

  async function paint() {
    const status = pushStatus();
    let body;
    if (status === 'ios-install') {
      body = [
        el('p', {}, '아이폰은 ', el('strong', {}, '홈 화면에 추가한 도란톡 앱'), '에서 알림을 받을 수 있어요. (iOS 16.4 이상)'),
        el('a', { href: '#/help', class: 'btn btn-secondary btn-block' }, '홈 화면에 추가하는 방법'),
      ];
    } else if (status === 'unsupported') {
      body = [el('p', { class: 'muted' }, '이 브라우저는 알림을 지원하지 않아요. 안드로이드는 크롬, 아이폰은 홈 화면에 추가한 앱에서 켜 주세요.')];
    } else if (status === 'denied') {
      body = deniedHelp();
    } else if (await isPushOn()) {
      const test = el('button', { class: 'btn btn-secondary btn-block', type: 'button' }, '시험 알림 보내기');
      const off = el('button', { class: 'btn btn-ghost btn-block btn-danger-text', type: 'button', style: 'margin-top:8px' }, '이 기기에서 알림 끄기');
      test.addEventListener('click', async () => {
        msg.clear();
        setBusy(test, true, '보내는 중…');
        try {
          const r = await sendTestPush();
          if (r?.sent > 0) msg.show('시험 알림을 보냈어요. 몇 초 안에 휴대폰 알림이 와요.', 'success');
          else msg.show('30초 뒤에 다시 눌러 주세요.', 'info');
        } catch (err) {
          msg.show(friendlyError(err));
        } finally {
          setBusy(test, false);
        }
      });
      off.addEventListener('click', async () => {
        setBusy(off, true, '끄는 중…');
        await disablePush().catch(() => {});
        toast('이 기기에서 알림을 껐어요.');
        paint();
      });
      body = [el('p', { class: 'form-msg success' }, '✓ 이 기기에서 알림을 받고 있어요'), msg, test, off];
    } else {
      const info = await pushServerInfo();
      if (!info.ready) {
        body = [el('p', { class: 'muted' }, '알림 서버가 아직 준비되지 않았어요. (관리자: 안내서 9단계)')];
      } else {
        const on = el('button', { class: 'btn btn-block', type: 'button' }, icon('bell', { size: 22 }), '알림 켜기');
        on.addEventListener('click', async () => {
          msg.clear();
          setBusy(on, true, '켜는 중…');
          try {
            await enablePush();
            toast('알림을 켰어요! 🔔');
            await paint();
          } catch (err) {
            setBusy(on, false);
            if (err.code === 'denied') return paint();
            msg.show(pushErrorText(err));
          }
        });
        body = [
          el('p', {}, '가족이 채팅을 보내면 앱을 닫아 두어도 휴대폰에 알림이 와요.'),
          msg,
          on,
        ];
      }
    }
    box.replaceChildren(head, ...body);
  }
  box.append(head, el('p', { class: 'muted' }, '확인하는 중…'));
  paint();
  return box;
}

// ------------------------------------------------------------------
// 배경 테마 고르기 (내 정보 화면)
// ------------------------------------------------------------------
function themePicker() {
  const buttons = [];
  const paint = () => {
    const current = getTheme();
    buttons.forEach((btn) => {
      const on = btn.dataset.theme === current;
      btn.classList.toggle('selected', on);
      btn.setAttribute('aria-checked', String(on));
    });
  };
  for (const t of THEMES) {
    const btn = el('button', {
      class: 'theme-option', type: 'button', role: 'radio', 'data-theme': t.key,
      'aria-label': `${t.label} 테마 (${t.desc})`,
      onclick: () => {
        setTheme(t.key);
        paint();
        toast(`${t.label} 테마로 바꿨어요.`);
      },
    },
      // 작은 미리보기: 배경 + 흰 카드 + 강조색 버튼
      el('span', { class: 'theme-swatch', 'aria-hidden': 'true' },
        el('span', { class: 'theme-swatch-card' },
          el('span', { class: 'theme-swatch-line' }),
          el('span', { class: 'theme-swatch-btn' }),
        ),
      ),
      el('span', { class: 'theme-name' }, t.label),
      el('span', { class: 'theme-desc' }, t.desc),
      el('span', { class: 'theme-check', 'aria-hidden': 'true' }, icon('check', { size: 18 })),
    );
    btn.style.setProperty('--swatch-bg', t.preview);
    btn.style.setProperty('--swatch-accent', t.accent);
    if (t.key === 'black') btn.classList.add('theme-dark');
    buttons.push(btn);
  }
  paint();
  return el('section', { class: 'card' },
    el('div', { class: 'card-head' },
      iconTile('palette'),
      el('div', {}, el('h2', {}, '배경 테마'), el('p', { class: 'muted' }, '이 휴대폰에 기억돼요')),
    ),
    el('div', { class: 'theme-grid', role: 'radiogroup', 'aria-label': '배경 테마' }, ...buttons),
  );
}
