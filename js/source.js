// 가입 경로: 홍보 링크(예: dorantalk.com/welcome?from=insta)로 들어온 사람이 가입하면
// 어느 홍보를 보고 왔는지 계정 정보에 함께 남겨요. (광고 효과 확인용, 다른 곳에 보내지 않아요)
const KEY = 'talkfeed.from';
const VALID = /^[a-z0-9_-]{1,30}$/i;
const KEEP_DAYS = 30;

// 주소의 ?from= 을 기억하고, 주소창에서는 지워요 (처음 들어온 경로를 30일 동안 기억)
export function captureSource() {
  const params = new URLSearchParams(location.search);
  const from = params.get('from');
  if (from && VALID.test(from)) {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!saved || Date.now() - saved.at > KEEP_DAYS * 86400000) {
        localStorage.setItem(KEY, JSON.stringify({ from: from.toLowerCase(), at: Date.now() }));
      }
    } catch { /* 기억 못 해도 괜찮아요 */ }
  }
  if (params.has('from')) {
    params.delete('from');
    const rest = params.toString();
    history.replaceState(history.state, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
  }
}

// 회원가입할 때 함께 보낼 값 (없으면 null)
export function signupSource() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && VALID.test(saved.from) && Date.now() - saved.at <= KEEP_DAYS * 86400000) return saved.from;
  } catch { /* 없음 */ }
  return null;
}
