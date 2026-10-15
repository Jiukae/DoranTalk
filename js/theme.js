// 배경 테마 고르기: 화이트 · 블랙 · 베이지(주황→노랑) · 블루(파랑→보라)
// 고른 테마는 이 휴대폰(브라우저)에 기억돼요.
const KEY = 'talkfeed.theme';

export const THEMES = [
  { key: 'white', label: '화이트', desc: '깔끔한 흰색', preview: '#f2f4f6', accent: '#e35d1b', status: '#f2f4f6' },
  { key: 'black', label: '블랙', desc: '눈이 편한 어두운 화면', preview: '#0f0f11', accent: '#e35d1b', status: '#0f0f11' },
  { key: 'beige', label: '베이지', desc: '주황 → 노랑', preview: 'linear-gradient(170deg, #ffd6b3 0%, #ffe6b8 45%, #fff3d6 100%)', accent: '#e35d1b', status: '#ffd6b3' },
  { key: 'blue', label: '블루', desc: '파랑 → 보라', preview: 'linear-gradient(170deg, #cfdcff 0%, #dcd8ff 45%, #efe2ff 100%)', accent: '#4f46e5', status: '#cfdcff' },
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
