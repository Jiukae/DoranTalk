// 배경 테마 고르기: 화이트 · 블랙 · 베이지(주황→노랑) · 블루(파랑→보라)
// 고른 테마는 이 휴대폰(브라우저)에 기억돼요.
const KEY = 'talkfeed.theme';

export const THEMES = [
  { key: 'white', label: '화이트', desc: '깔끔한 흰색', preview: '#f4f4f6', accent: '#c9581f', status: '#ffffff' },
  { key: 'black', label: '블랙', desc: '눈이 편한 어두운 화면', preview: '#121212', accent: '#ff9a5c', status: '#121212' },
  { key: 'beige', label: '베이지', desc: '주황 → 노랑', preview: 'linear-gradient(165deg, #ffd6b3 0%, #ffe6b8 50%, #fff1bf 100%)', accent: '#c9581f', status: '#ffd6b3' },
  { key: 'blue', label: '블루', desc: '파랑 → 보라', preview: 'linear-gradient(165deg, #cfdcff 0%, #dcd8ff 50%, #ead6ff 100%)', accent: '#4f46e5', status: '#cfdcff' },
];
export const DEFAULT_THEME = 'beige';

export function getTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  return THEMES.some((t) => t.key === current) ? current : DEFAULT_THEME;
}

export function setTheme(key) {
  const theme = THEMES.find((t) => t.key === key);
  if (!theme) return;
  document.documentElement.setAttribute('data-theme', key);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.status);
  try {
    localStorage.setItem(KEY, key);
  } catch { /* 저장 못 해도 지금 화면에는 적용 */ }
}
