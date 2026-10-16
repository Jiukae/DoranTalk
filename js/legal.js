// 약관 · 개인정보처리방침 공통 정보와 동의 기록
// 내용을 바꾸면 TERMS_VERSION 을 오늘 날짜로 올려 주세요. 회원들이 다음 로그인 때 다시 동의하게 돼요.

export const SERVICE_NAME = '도란톡';
export const SERVICE_URL = 'https://dorantalk.com';
export const PRIVACY_OFFICER = '한지욱';
export const CONTACT_EMAIL = 'admin@dorantalk.com';
export const TERMS_VERSION = '2026-10-14';
export const EFFECTIVE_DATE = '2026년 10월 14일';

// 가입·동의할 때 계정 정보(user_metadata)에 남기는 동의 기록
// child: 만 14세 미만 (보호자가 먼저 동의하고 만든 가입 링크로 가입 — 보호자 동의 기록은 DB guardian_consents)
export function consentRecord({ child = false } = {}) {
  return {
    terms_version: TERMS_VERSION,
    privacy_version: TERMS_VERSION,
    age_over_14: !child,
    ...(child ? { under_14_with_guardian: true } : {}),
    agreed_at: new Date().toISOString(),
  };
}

// 보호자 동의로 가입한 만 14세 미만 회원인지 (화면 안내용 — 실제 제한은 DB가 해요)
export function isChildUser(user) {
  return user?.user_metadata?.under_14_with_guardian === true;
}

// 이 회원이 최신 약관에 동의했는지
export function hasConsented(user) {
  const meta = user?.user_metadata || {};
  return meta.terms_version === TERMS_VERSION && meta.privacy_version === TERMS_VERSION
    && (meta.age_over_14 === true || meta.under_14_with_guardian === true);
}
