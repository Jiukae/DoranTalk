// 서버가 영어로 돌려주는 오류를 부모님도 이해할 수 있는 한국어로 바꿉니다.

const AUTH_CODES = {
  invalid_credentials: '이메일 또는 비밀번호가 맞지 않아요. 다시 확인해 주세요.',
  user_already_exists: '이미 가입된 이메일이에요. 로그인 화면에서 로그인해 주세요.',
  email_exists: '이미 가입된 이메일이에요. 로그인 화면에서 로그인해 주세요.',
  email_not_confirmed: '이메일 인증이 아직 안 됐어요. 메일함에서 인증 메일의 링크를 눌러 주세요.',
  weak_password: '비밀번호가 너무 쉬워요. 6자 이상으로, 숫자와 글자를 섞어 주세요.',
  same_password: '지금 쓰는 비밀번호와 달라야 해요.',
  email_address_invalid: '이메일 주소 모양이 올바르지 않아요.',
  validation_failed: '입력한 내용을 다시 확인해 주세요.',
  email_address_not_authorized: '지금은 비밀번호 찾기 메일을 보낼 수 없어요. 가족 중 앱 관리자에게 비밀번호 초기화를 부탁해 주세요.',
  over_email_send_rate_limit: '메일을 너무 자주 보냈어요. 1시간쯤 뒤에 다시 시도해 주세요.',
  over_request_rate_limit: '너무 많이 시도했어요. 잠시 후에 다시 해 주세요.',
  signup_disabled: '지금은 회원가입이 막혀 있어요. 관리자에게 문의해 주세요.',
  session_expired: '로그인이 만료되었어요. 다시 로그인해 주세요.',
  otp_expired: '링크가 만료되었어요. 처음부터 다시 시도해 주세요.',
  unexpected_failure: '가입 중 문제가 생겼어요. 아이디가 방금 다른 사람에게 사용됐을 수 있어요. 다른 아이디로 해 보세요.',
};

export function friendlyError(error) {
  if (!error) return '알 수 없는 문제가 생겼어요.';
  const code = error.code || '';
  const msg = String(error.message || '');

  if (AUTH_CODES[code]) return AUTH_CODES[code];

  // 데이터베이스 오류 코드
  if (code === 'PGRST202' || code === 'PGRST205') {
    return '서버(데이터베이스)가 예전 버전이라 이 기능을 쓸 수 없어요. 운영자가 데이터베이스를 최신으로 업데이트해야 해요. (운영자: #/check 에서 확인)';
  }
  if (code === '23505') return '이미 다른 사람이 쓰고 있는 아이디예요. 다른 아이디를 골라 주세요.';
  if (code === '23514') return '입력한 내용이 규칙에 맞지 않아요.';
  if (code === '42501') return '이 작업을 할 수 있는 권한이 없어요.';

  // 코드가 없을 때 문장으로 판단
  if (/invalid login credentials/i.test(msg)) return AUTH_CODES.invalid_credentials;
  if (/already registered/i.test(msg)) return AUTH_CODES.user_already_exists;
  if (/email not confirmed/i.test(msg)) return AUTH_CODES.email_not_confirmed;
  if (/password should be at least/i.test(msg)) return '비밀번호는 6자 이상이어야 해요.';
  if (/database error saving new user/i.test(msg)) return AUTH_CODES.unexpected_failure;
  if (/email address not authorized/i.test(msg)) return AUTH_CODES.email_address_not_authorized;
  if (/rate limit/i.test(msg)) return AUTH_CODES.over_request_rate_limit;
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
    return '인터넷 연결을 확인해 주세요. 연결이 되어 있다면 잠시 후 다시 시도해 주세요.';
  }
  // 서버 함수에서 한국어로 직접 보낸 문장은 그대로 보여 줌
  if (/[가-힣]/.test(msg)) return msg;
  return `문제가 생겼어요. 잠시 후 다시 시도해 주세요. (${code || msg || '알 수 없음'})`;
}
