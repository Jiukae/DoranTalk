// 가입 경로: 홍보 링크(예: dorantalk.com/welcome?from=insta)로 들어온 사람이 가입하면
// 어느 홍보를 보고 왔는지 계정 정보에 함께 남겨요. (광고 효과 확인용, 다른 곳에 보내지 않아요)
const KEY = 'talkfeed.from';
const VALID = /^[a-z0-9_-]{1,30}$/i;
const KEEP_DAYS = 30;

// 카카오톡 · 인스타 · 페이스북 · 네이버 앱 같은 "앱 안의 브라우저" (install.js 도 같이 써요)
export const KAKAO_UA = /KAKAOTALK/i;
export const IN_APP_UA = /NAVER\(inapp|; NAVER|Instagram|FBAN|FBAV|Line\/|DaumApps|everytimeApp|BAND\//i;

function inAppBrowser() {
  return KAKAO_UA.test(navigator.userAgent) || IN_APP_UA.test(navigator.userAgent);
}

function savedSource() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && VALID.test(saved.from) && Date.now() - saved.at <= KEEP_DAYS * 86400000) return saved.from;
  } catch { /* 없음 */ }
  return null;
}

// 주소의 ?from= 을 기억하고, 주소창에서는 지워요 (처음 들어온 경로를 30일 동안 기억)
// 단, 앱 안의 브라우저에서는 ?from= 을 주소에 남겨 둬요.
// 가입하려면 크롬/사파리로 옮겨 열어야 하는데, 그때 주소가 그대로 넘어가야 가입 경로(예: 인스타 광고)가 이어져요.
export function captureSource() {
  const params = new URLSearchParams(location.search);
  const from = params.get('from');
  const valid = Boolean(from && VALID.test(from));
  if (valid && !savedSource()) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ from: from.toLowerCase(), at: Date.now() }));
    } catch { /* 기억 못 해도 괜찮아요 */ }
  }
  let keep = null;
  if (inAppBrowser()) keep = savedSource() || (valid ? from.toLowerCase() : null);
  if (keep) params.set('from', keep);
  else params.delete('from');
  const query = params.toString();
  if (query !== location.search.replace(/^\?/, '')) {
    history.replaceState(history.state, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
  }
}

// 회원가입할 때 함께 보낼 값 (없으면 null)
export function signupSource() {
  return savedSource();
}
