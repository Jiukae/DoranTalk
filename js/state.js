// 앱 전체에서 함께 쓰는 정보: 로그인 상태와 내 닉네임
import { sb } from './supabase.js';

export const state = {
  session: null,
  profile: null, // { id, nickname, created_at }
};

export function isLoggedIn() {
  return Boolean(state.session);
}

// 내 프로필(닉네임) 불러오기
export async function loadProfile() {
  if (!state.session) {
    state.profile = null;
    return null;
  }
  const { data, error } = await sb
    .from('profiles')
    .select('id, nickname, created_at')
    .eq('id', state.session.user.id)
    .maybeSingle();
  if (error) throw error;
  state.profile = data;
  return data;
}
