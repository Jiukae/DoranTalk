// 앱 전체에서 함께 쓰는 정보: 로그인 상태와 내 닉네임
import { sb } from './supabase.js';

export const state = {
  session: null,
  profile: null, // { id, nickname, handle, created_at }
};

// 데이터베이스가 버전 9 전이라 아이디(handle) 칸이 없다는 오류인지
export function isMissingHandle(error) {
  return error?.code === '42703' || /handle/.test(String(error?.message || ''));
}

export function isLoggedIn() {
  return Boolean(state.session);
}

// 내 프로필(닉네임) 불러오기
export async function loadProfile() {
  if (!state.session) {
    state.profile = null;
    return null;
  }
  const query = (fields) => sb.from('profiles').select(fields).eq('id', state.session.user.id).maybeSingle();
  let { data, error } = await query('id, nickname, handle, created_at');
  // 데이터베이스를 아직 버전 9로 올리기 전(아이디 칸이 없음)에도 앱이 열리도록
  if (error && isMissingHandle(error)) ({ data, error } = await query('id, nickname, created_at'));
  if (error) throw error;
  state.profile = data;
  return data;
}
