// 채팅 화면 (그룹 화면의 "채팅" 탭)
// - 새 메시지는 새로고침 없이 바로 보여요 (Supabase 실시간)
// - 메시지 옆 숫자 = 아직 안 읽은 가족 수 (카카오톡의 "1"처럼)
import { state } from '../state.js';
import { isStale } from '../router.js';
import { friendlyError } from '../errors.js';
import { el, avatar, toast, setBusy, errorCard, emptyState, icon } from '../ui.js';
import { timeOnly } from '../format.js';
import { fetchMembers } from '../groups.js';
import { signedUrls, pickImages } from '../images.js';
import { openLightbox } from '../lightbox.js';
import {
  fetchMessages, sendText, sendImage, fetchReads, markRead, watchChat, shapeMessage,
  PAGE_SIZE, MAX_MESSAGE_LENGTH,
} from '../chat.js';

const dayFmt = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
const GROUP_GAP_MS = 3 * 60 * 1000; // 같은 사람이 3분 안에 이어 보낸 메시지는 이름을 한 번만

function sameDay(a, b) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

export async function renderChatTab(main, group, token) {
  const me = state.session.user.id;
  const messages = []; // 오래된 것 → 최신 순
  const byId = new Map(); // id → { msg, row, unreadEl }
  let members = {}; // user_id → { nickname, joined_at }
  let reads = {}; // user_id → last_read_at
  let hasOlder = false;
  let markTimer = null;

  main.classList.add('page-chat');
  const moreBtn = el('button', { class: 'btn btn-ghost btn-block', type: 'button', hidden: true }, '이전 대화 더 보기');
  const list = el('div', { class: 'chat-list', role: 'log', 'aria-live': 'polite', 'aria-label': '채팅 메시지' });
  const newPill = el('button', { class: 'new-pill chat-new-pill', type: 'button', hidden: true }, icon('arrowDown', { size: 20 }), '새 메시지');
  main.append(moreBtn, list);
  const composer = buildComposer();
  document.body.append(composer.root, newPill);

  // ---------- 처음 불러오기 ----------
  try {
    const [first, memberList, readMap] = await Promise.all([
      fetchMessages(group.id), fetchMembers(group.id), fetchReads(group.id),
    ]);
    if (isStale(token)) return cleanupDom;
    members = Object.fromEntries(memberList.map((m) => [m.user_id, m]));
    reads = readMap;
    messages.push(...first);
    hasOlder = first.length === PAGE_SIZE;
  } catch (err) {
    if (!isStale(token)) main.replaceChildren(errorCard(friendlyError(err), () => location.reload()));
    return cleanupDom;
  }

  await rebuild();
  scrollToBottom();
  markSeen();

  // ---------- 실시간 ----------
  const stopWatching = watchChat(group.id, {
    onMessage: (raw) => {
      if (byId.has(raw.id)) return;
      const nicknames = Object.fromEntries(Object.entries(members).map(([id, m]) => [id, m.nickname]));
      const msg = shapeMessage(raw, nicknames);
      // 내가 방금 보낸 메시지는 보내기 결과로 처리되니, 잠깐 기다렸다가 없을 때만 추가
      if (msg.isMine && composer.pending > 0) {
        setTimeout(() => { if (!byId.has(msg.id)) addMessage(msg); }, 1500);
        return;
      }
      if (!members[msg.sender_id]) refreshMembers();
      addMessage(msg);
    },
    onRead: (userId, at) => {
      reads[userId] = at;
      updateUnread();
    },
    onReconnect: () => catchUp(),
  });

  const onVisible = () => {
    if (document.visibilityState === 'visible') {
      catchUp();
      markSeen();
    }
  };
  document.addEventListener('visibilitychange', onVisible);
  const onScroll = () => { if (nearBottom()) newPill.hidden = true; };
  window.addEventListener('scroll', onScroll, { passive: true });

  moreBtn.addEventListener('click', async () => {
    setBusy(moreBtn, true, '불러오는 중…');
    try {
      const older = await fetchMessages(group.id, { before: messages[0]?.created_at });
      hasOlder = older.length === PAGE_SIZE;
      const keepFromBottom = document.documentElement.scrollHeight - window.scrollY;
      messages.unshift(...older.filter((m) => !byId.has(m.id)));
      await rebuild();
      window.scrollTo(0, document.documentElement.scrollHeight - keepFromBottom);
    } catch (err) {
      toast(friendlyError(err), 4000);
    } finally {
      setBusy(moreBtn, false);
    }
  });
  newPill.addEventListener('click', () => {
    scrollToBottom(true);
    newPill.hidden = true;
  });

  return () => {
    stopWatching();
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('scroll', onScroll);
    cleanupDom();
  };

  function cleanupDom() {
    composer.root.remove();
    newPill.remove();
    document.body.classList.remove('typing');
  }

  // ---------- 그리기 ----------
  async function rebuild() {
    const urls = await signedUrls(messages.filter((m) => m.image_path).map((m) => m.image_path)).catch(() => ({}));
    byId.clear();
    const nodes = [];
    messages.forEach((m, i) => {
      const prev = messages[i - 1];
      if (!prev || !sameDay(prev.created_at, m.created_at)) nodes.push(daySeparator(m.created_at));
      nodes.push(messageRow(m, prev, urls[m.image_path]));
    });
    list.replaceChildren(...nodes);
    moreBtn.hidden = !hasOlder;
    if (!messages.length) {
      list.replaceChildren(el('div', { class: 'card chat-empty' },
        emptyState('chat', '가족 채팅방이에요', '아래 칸에 첫 인사를 남겨 보세요!')));
    }
    updateUnread();
  }

  async function addMessage(msg) {
    if (byId.has(msg.id)) return;
    const wasNearBottom = nearBottom();
    const last = messages[messages.length - 1];
    // 순서가 뒤바뀌어 도착한 경우(드묾)에는 전체를 다시 그림
    if (last && msg.created_at < last.created_at) {
      messages.push(msg);
      messages.sort((a, b) => a.created_at.localeCompare(b.created_at));
      await rebuild();
    } else {
      if (!messages.length) list.replaceChildren();
      messages.push(msg);
      const url = msg.image_path ? (await signedUrls([msg.image_path]).catch(() => ({})))[msg.image_path] : null;
      if (!last || !sameDay(last.created_at, msg.created_at)) list.append(daySeparator(msg.created_at));
      list.append(messageRow(msg, last, url));
      updateUnread();
    }
    if (msg.isMine || wasNearBottom) scrollToBottom(true);
    else newPill.hidden = false;
    if (!msg.isMine) markSeen();
  }

  function daySeparator(at) {
    return el('div', { class: 'chat-day' }, el('span', {}, dayFmt.format(new Date(at))));
  }

  function messageRow(m, prev, url) {
    const continued = prev && prev.sender_id === m.sender_id && sameDay(prev.created_at, m.created_at)
      && new Date(m.created_at) - new Date(prev.created_at) < GROUP_GAP_MS;
    const unreadEl = el('span', { class: 'chat-unread', 'aria-label': '' });
    const meta = el('div', { class: 'chat-meta' }, unreadEl, el('span', { class: 'chat-time' }, timeOnly(m.created_at)));

    let bubble;
    if (m.image_path) {
      bubble = el('button', {
        class: 'chat-photo', type: 'button', 'aria-label': '사진 크게 보기',
        onclick: () => { if (url) openLightbox([url], 0); },
      }, url
        ? el('img', {
          src: url, alt: '보낸 사진', loading: 'lazy',
          onload: () => { if (nearBottom(400)) scrollToBottom(); },
          onerror: (e) => e.target.replaceWith(el('span', { class: 'photo-missing' }, '사진을 불러올 수 없어요')),
        })
        : el('span', { class: 'photo-missing' }, '사진을 불러올 수 없어요'));
    } else {
      bubble = el('div', { class: 'chat-bubble' }, m.content);
    }

    const row = el('div', { class: `chat-row ${m.isMine ? 'mine' : 'theirs'} ${continued ? 'continued' : ''}` },
      !m.isMine && (continued ? el('div', { class: 'chat-avatar-space' }) : avatar(m.nickname, 'avatar-sm')),
      el('div', { class: 'chat-col' },
        !m.isMine && !continued && el('p', { class: 'chat-name' }, m.nickname),
        el('div', { class: 'chat-line' }, bubble, meta),
      ),
    );
    byId.set(m.id, { msg: m, row, unreadEl });
    return row;
  }

  // 메시지마다 "아직 안 읽은 가족 수" (보낸 사람 제외)
  function updateUnread() {
    const memberIds = Object.keys(members);
    for (const { msg, unreadEl } of byId.values()) {
      const n = memberIds.filter((uid) => {
        if (uid === msg.sender_id) return false;
        const readAt = reads[uid] || members[uid]?.joined_at;
        return !readAt || readAt < msg.created_at;
      }).length;
      unreadEl.textContent = n > 0 ? String(n) : '';
      unreadEl.setAttribute('aria-label', n > 0 ? `안 읽은 가족 ${n}명` : '');
    }
  }

  // 화면을 보고 있으면 "여기까지 읽음"으로 표시
  function markSeen() {
    if (document.visibilityState !== 'visible') return;
    const latest = messages[messages.length - 1]?.created_at;
    if (latest && (!reads[me] || reads[me] < latest)) {
      reads[me] = latest; // 내 화면에서는 바로 반영
      updateUnread();
    }
    clearTimeout(markTimer);
    markTimer = setTimeout(() => markRead(group.id).catch(() => {}), 600);
  }

  // 연결이 끊겼던 동안 놓친 메시지 가져오기
  async function catchUp() {
    const after = messages[messages.length - 1]?.created_at;
    try {
      const [missed, readMap] = await Promise.all([
        after ? fetchMessages(group.id, { after }) : fetchMessages(group.id),
        fetchReads(group.id),
      ]);
      if (isStale(token)) return;
      reads = { ...reads, ...readMap };
      for (const m of missed) await addMessage(m);
      updateUnread();
    } catch { /* 다음 기회에 */ }
  }

  async function refreshMembers() {
    const memberList = await fetchMembers(group.id).catch(() => null);
    if (memberList) {
      members = Object.fromEntries(memberList.map((m) => [m.user_id, m]));
      updateUnread();
    }
  }

  function nearBottom(margin = 160) {
    return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - margin;
  }

  function scrollToBottom(smooth = false) {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }

  // ---------- 입력칸 ----------
  function buildComposer() {
    const box = el('textarea', {
      class: 'input textarea composer-input', rows: 1, maxlength: MAX_MESSAGE_LENGTH,
      placeholder: '메시지 입력', 'aria-label': '메시지 입력', enterkeyhint: 'send',
    });
    const photoBtn = el('button', { class: 'composer-photo', type: 'button', 'aria-label': '사진 보내기' }, icon('camera', { size: 24 }));
    const send = el('button', { class: 'btn composer-send', type: 'button' }, '보내기');
    const api = { pending: 0 };

    const resize = () => {
      box.style.height = 'auto';
      box.style.height = `${Math.min(box.scrollHeight, 140)}px`;
    };
    box.addEventListener('input', resize);
    // 컴퓨터에서는 Enter = 보내기, Shift+Enter = 줄바꿈 / 휴대폰에서는 Enter = 줄바꿈
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    box.addEventListener('keydown', (e) => {
      if (!coarse && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        sendCurrent();
      }
    });
    // 휴대폰에서 글자를 입력하는 동안에는 키보드 공간을 위해 아래쪽 탭을 잠깐 숨겨요
    box.addEventListener('focus', () => { if (coarse) document.body.classList.add('typing'); });
    box.addEventListener('blur', () => setTimeout(() => {
      if (document.activeElement !== box) document.body.classList.remove('typing');
    }, 150));

    send.addEventListener('click', () => {
      sendCurrent();
      box.focus();
    });
    photoBtn.addEventListener('click', async () => {
      const files = await pickImages();
      for (const file of files.slice(0, 10)) sendWithPending({ file });
      if (files.length > 10) toast('사진은 한 번에 10장까지 보낼 수 있어요.', 3500);
    });

    function sendCurrent() {
      const text = box.value.trim();
      if (!text) return;
      box.value = '';
      resize();
      sendWithPending({ text });
    }

    // 보내는 동안 "보내는 중" 말풍선을 먼저 보여 주고, 끝나면 진짜 메시지로 바꿔요
    async function sendWithPending({ text, file }) {
      api.pending += 1;
      const preview = file ? URL.createObjectURL(file) : null;
      const status = el('span', { class: 'chat-status' }, '보내는 중…');
      const bubble = file
        ? el('div', { class: 'chat-photo pending' }, el('img', { src: preview, alt: '보내는 사진' }))
        : el('div', { class: 'chat-bubble' }, text);
      const row = el('div', { class: 'chat-row mine pending' },
        el('div', { class: 'chat-col' }, el('div', { class: 'chat-line' }, bubble, el('div', { class: 'chat-meta' }, status))));
      if (!messages.length) list.replaceChildren();
      list.append(row);
      scrollToBottom(true);

      try {
        const msg = file ? await sendImage(group.id, file) : await sendText(group.id, text);
        row.remove();
        await addMessage(msg);
        markSeen();
      } catch (err) {
        status.textContent = '';
        status.append(
          el('span', { class: 'chat-failed' }, '전송 실패'),
          el('button', {
            class: 'link-btn', type: 'button',
            onclick: () => { row.remove(); sendWithPending({ text, file }); },
          }, '다시 보내기'),
          el('button', { class: 'link-btn danger', type: 'button', onclick: () => row.remove() }, '지우기'),
        );
        toast(friendlyError(err), 4000);
      } finally {
        api.pending -= 1;
        if (preview) setTimeout(() => URL.revokeObjectURL(preview), 5000);
      }
    }

    api.root = el('div', { class: 'composer chat-composer' },
      el('div', { class: 'composer-inner' }, photoBtn, box, send));
    return api;
  }
}
