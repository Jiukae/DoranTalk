// 가족 프리미엄 (베타)
// - 가족 그룹마다 프리미엄 기간이 있어요. 지금은 결제가 없어서, 운영자가 드린 쿠폰을 넣으면 켜져요.
// - 기본 기능(소식 · 채팅 · 알림 · 사진 · 사진 탭)은 언제나 무료예요. 프리미엄은 "더 좋게"만.
import { sb } from './supabase.js';

export const PREMIUM_PERKS = [
  { icon: 'image', title: '사진 원본 화질', desc: '사진을 작게 줄이지 않고 선명하게 올려요' },
  { icon: 'download', title: '한 달 사진 한 번에 내려받기', desc: '사진 탭에서 그 달 사진을 파일 하나로 받아요' },
];

export function isPremium(group) {
  return Boolean(group?.premium_until) && new Date(group.premium_until) > new Date();
}

// 프리미엄 그룹은 긴 쪽 4096px · 화질 0.9 (보통은 1600px · 0.82)
export function photoOptions(group) {
  return isPremium(group) ? { maxSide: 4096, quality: 0.9 } : {};
}

export async function redeemPremiumCode(groupId, code) {
  const { data, error } = await sb.rpc('redeem_premium_code', { p_group: groupId, p_code: code });
  if (error) throw error;
  return data; // 새 프리미엄 끝나는 날
}

export async function registerPremiumInterest(groupId) {
  const { error } = await sb.rpc('register_premium_interest', { p_group: groupId });
  if (error) throw error;
}

export async function hasPremiumInterest() {
  const { data, error } = await sb.rpc('has_premium_interest');
  return error ? false : Boolean(data);
}
