// 소개 화면(welcome.html) 도우미
// - 홍보 링크의 ?from= 을 기억 (가입할 때 함께 저장)
// - 이미 로그인한 사람에게는 "무료로 시작하기" 대신 "도란톡 열기"
import { captureSource } from './source.js';

captureSource();

function loggedIn() {
  try {
    return Object.keys(localStorage).some((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
  } catch {
    return false;
  }
}

if (loggedIn()) {
  document.querySelectorAll('[data-when-in]').forEach((a) => {
    a.setAttribute('href', a.dataset.whenIn);
    if (a.dataset.textIn) a.textContent = a.dataset.textIn;
  });
  document.querySelectorAll('[data-hide-in]').forEach((a) => { a.hidden = true; });
}
