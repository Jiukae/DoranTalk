// 그룹 · 초대 관련 서버 요청 모음
import { sb } from './supabase.js';
import { state, isMissingHandle } from './state.js';

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

// 아이디 칸이 없는 예전 데이터베이스(버전 9 전)면 아이디 없이 다시 물어봐요
async function withHandle(run) {
  const res = await run(', handle');
  return res.error && isMissingHandle(res.error) ? run('') : res;
}

export async function fetchMembers(groupId) {
  const rows = check(await withHandle((h) => sb
    .from('group_members')
    .select(`user_id, role, joined_at, profile:profiles!group_members_user_id_fkey(nickname${h})`)
    .eq('group_id', groupId)
    .order('joined_at', { ascending: true })));
  return rows.map((m) => ({ ...m, nickname: m.profile?.nickname ?? '(알 수 없음)', handle: m.profile?.handle ?? '' }));
}

// 이 그룹에서 보낸, 아직 대기 중인 초대
export async function fetchPendingInvites(groupId) {
  const rows = check(await withHandle((h) => sb
    .from('group_invitations')
    .select(`id, created_at, invitee_id, invitee:profiles!group_invitations_invitee_id_fkey(nickname${h}), inviter:profiles!group_invitations_inviter_id_fkey(nickname)`)
    .eq('group_id', groupId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })));
  return rows.map((i) => ({
    id: i.id,
    created_at: i.created_at,
    inviteeId: i.invitee_id,
    inviteeNickname: i.invitee?.nickname ?? '(알 수 없음)',
    inviteeHandle: i.invitee?.handle ?? '',
    inviterNickname: i.inviter?.nickname ?? '(알 수 없음)',
  }));
}

// 아이디로 초대 (초대받은 사람에게는 앱 알림 · 이메일로도 알려요)
export async function inviteByHandle(groupId, handle) {
  const res = await sb.rpc('invite_by_handle', { gid: groupId, p_handle: handle });
  // 예전 데이터베이스(버전 9 전): 닉네임으로 찾던 함수로
  if (res.error?.code === 'PGRST202') return check(await sb.rpc('invite_by_nickname', { gid: groupId, nick: handle }));
  return check(res);
}

// 만 14세 미만: 보호자에게 그룹 만들기 승인 요청
export async function requestGroup(name) {
  return check(await sb.rpc('request_group', { p_name: name }));
}

export async function fetchMyGroupRequests() {
  return check(await sb.rpc('my_group_requests'));
}

export async function cancelGroupRequest(id) {
  return check(await sb.rpc('cancel_group_request', { p_id: id }));
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
    // 내가 그룹에 들어가게 되면(예: 보호자가 자녀의 그룹 만들기를 승인) 홈을 바로 새로
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'group_members', filter: `user_id=eq.${uid}` },
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
