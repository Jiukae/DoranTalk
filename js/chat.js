// 채팅 관련 서버 요청 모음: 메시지, 읽음 표시, 안 읽은 수, 실시간 연결
import { sb } from './supabase.js';
import { state } from './state.js';
import { shrinkImage, uploadImages, removeImages } from './images.js';

export const PAGE_SIZE = 50;
export const MAX_MESSAGE_LENGTH = 2000;

const FIELDS = 'id, group_id, sender_id, content, image_path, created_at, sender:profiles!messages_sender_id_fkey(nickname)';

function check({ data, error }) {
  if (error) throw error;
  return data;
}

export function shapeMessage(m, nicknames = {}) {
  return {
    id: m.id,
    group_id: m.group_id,
    sender_id: m.sender_id,
    content: m.content,
    image_path: m.image_path,
    created_at: m.created_at,
    nickname: m.sender?.nickname ?? nicknames[m.sender_id] ?? '(알 수 없음)',
    isMine: m.sender_id === state.session.user.id,
  };
}

// 최근 메시지 PAGE_SIZE 개 (before 를 주면 그보다 예전, after 를 주면 그 뒤에 온 것 전부)
export async function fetchMessages(groupId, { before = null, after = null } = {}) {
  let q = sb.from('messages').select(FIELDS).eq('group_id', groupId);
  if (after) {
    q = q.gt('created_at', after).order('created_at', { ascending: true }).limit(500);
    return check(await q).map((m) => shapeMessage(m));
  }
  q = q.order('created_at', { ascending: false }).limit(PAGE_SIZE);
  if (before) q = q.lt('created_at', before);
  return check(await q).map((m) => shapeMessage(m)).reverse();
}

export async function sendText(groupId, content) {
  return shapeMessage(check(await sb.from('messages')
    .insert({ group_id: groupId, content })
    .select(FIELDS)
    .single()));
}

// 사진 한 장 보내기: 줄이기 → 올리기 → 메시지 저장 (저장 실패 시 올린 사진 정리)
export async function sendImage(groupId, file) {
  const blob = await shrinkImage(file);
  const [path] = await uploadImages(groupId, 'chat', [blob]);
  try {
    return shapeMessage(check(await sb.from('messages')
      .insert({ group_id: groupId, image_path: path })
      .select(FIELDS)
      .single()));
  } catch (err) {
    await removeImages([path]);
    throw err;
  }
}

// 이 그룹 사람들이 어디까지 읽었는지 { user_id: last_read_at }
export async function fetchReads(groupId) {
  const rows = check(await sb.from('chat_reads').select('user_id, last_read_at').eq('group_id', groupId));
  return Object.fromEntries(rows.map((r) => [r.user_id, r.last_read_at]));
}

export async function markRead(groupId) {
  return check(await sb.rpc('mark_chat_read', { gid: groupId }));
}

// 내 그룹별 안 읽은 메시지 수 { group_id: 숫자 }
export async function fetchUnreadCounts() {
  const rows = check(await sb.rpc('get_unread_counts'));
  return Object.fromEntries(rows.map((r) => [r.group_id, Number(r.unread)]));
}

// 채팅방 실시간 연결: 새 메시지, 읽음 위치 변경, (끊겼다가) 다시 연결됨
export function watchChat(groupId, { onMessage, onRead, onReconnect }) {
  let connectedOnce = false;
  const channel = sb.channel(`chat-${groupId}-${Date.now()}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `group_id=eq.${groupId}` },
      (payload) => onMessage(payload.new))
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'chat_reads', filter: `group_id=eq.${groupId}` },
      (payload) => { if (payload.new?.user_id) onRead(payload.new.user_id, payload.new.last_read_at); })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        // 휴대폰이 잠들었다 깨는 등으로 다시 연결되면, 그동안 놓친 메시지를 가져와요
        if (connectedOnce) onReconnect();
        connectedOnce = true;
      }
    });
  return () => sb.removeChannel(channel);
}

// 내가 속한 모든 그룹의 새 메시지 알림 (홈 화면, 탭의 숫자 표시용)
export function watchNewMessages(onInsert, groupId = null) {
  const filter = groupId ? { filter: `group_id=eq.${groupId}` } : {};
  const channel = sb.channel(`newmsg-${groupId || 'all'}-${Date.now()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', ...filter },
      (payload) => onInsert(payload.new))
    .subscribe();
  return () => sb.removeChannel(channel);
}
