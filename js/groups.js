// 가족 그룹 · 초대 관련 서버 요청 모음
import { sb } from './supabase.js';
import { state } from './state.js';

function check({ data, error }) {
  if (error) throw error;
  return data;
}

// 내가 속한 그룹 목록 (보안 규칙 덕분에 내 그룹만 옵니다)
export async function fetchMyGroups() {
  const rows = check(await sb
    .from('family_groups')
    .select('id, name, created_at, group_members(count)')
    .order('created_at', { ascending: true }));
  return rows.map((g) => ({ ...g, memberCount: g.group_members?.[0]?.count ?? 0 }));
}

export async function fetchGroup(id) {
  return check(await sb.from('family_groups').select('id, name, created_by, created_at').eq('id', id).maybeSingle());
}

export async function createGroup(name) {
  return check(await sb.rpc('create_group', { group_name: name }));
}

// 내가 받은 (대기 중인) 초대
export async function fetchMyInvitations() {
  return check(await sb.rpc('get_my_invitations'));
}

// 수락하면 그룹 ID를 돌려줍니다
export async function respondInvitation(id, accept) {
  return check(await sb.rpc('respond_invitation', { inv_id: id, accept }));
}

export async function fetchMembers(groupId) {
  const rows = check(await sb
    .from('group_members')
    .select('user_id, role, joined_at, profile:profiles(nickname)')
    .eq('group_id', groupId)
    .order('joined_at', { ascending: true }));
  return rows.map((m) => ({ ...m, nickname: m.profile?.nickname ?? '(알 수 없음)' }));
}

// 이 그룹에서 보낸, 아직 대기 중인 초대
export async function fetchPendingInvites(groupId) {
  const rows = check(await sb
    .from('group_invitations')
    .select('id, created_at, invitee:profiles!group_invitations_invitee_id_fkey(nickname), inviter:profiles!group_invitations_inviter_id_fkey(nickname)')
    .eq('group_id', groupId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false }));
  return rows.map((i) => ({
    id: i.id,
    created_at: i.created_at,
    inviteeNickname: i.invitee?.nickname ?? '(알 수 없음)',
    inviterNickname: i.inviter?.nickname ?? '(알 수 없음)',
  }));
}

export async function inviteByNickname(groupId, nickname) {
  return check(await sb.rpc('invite_by_nickname', { gid: groupId, nick: nickname }));
}

export async function cancelInvitation(id) {
  return check(await sb.rpc('cancel_invitation', { inv_id: id }));
}

export async function leaveGroup(groupId) {
  return check(await sb
    .from('group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('user_id', state.session.user.id));
}

// 나에게 초대가 오면 바로 알려 주는 실시간 연결. 돌려준 함수를 부르면 연결을 끊어요.
export function watchMyInvitations(onChange) {
  const uid = state.session.user.id;
  const channel = sb
    .channel(`invites-${uid}-${Date.now()}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'group_invitations', filter: `invitee_id=eq.${uid}` },
      () => onChange())
    .subscribe();
  return () => sb.removeChannel(channel);
}

// 그룹 멤버·초대가 바뀌면 알려 주는 실시간 연결
export function watchGroupMembers(groupId, onChange) {
  const channel = sb
    .channel(`members-${groupId}-${Date.now()}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'group_members', filter: `group_id=eq.${groupId}` },
      () => onChange())
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'group_invitations', filter: `group_id=eq.${groupId}` },
      () => onChange())
    .subscribe();
  return () => sb.removeChannel(channel);
}
