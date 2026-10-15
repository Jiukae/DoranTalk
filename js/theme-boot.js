// 앱이 그려지기 "전에" 저장해 둔 배경 테마를 먼저 적용해요 (화면이 잠깐 다른 색으로 깜빡이지 않게).
// 일반 스크립트로 <head>에서 바로 실행돼요. 자세한 테마 목록은 js/theme.js 에 있어요.
(function () {
  var colors = { white: '#f2f4f6', black: '#0f0f11', beige: '#ffd6b3', blue: '#cfdcff' };
  var theme = 'beige';
  try {
    var saved = localStorage.getItem('talkfeed.theme');
    if (saved && colors[saved]) theme = saved;
  } catch (e) { /* 저장소를 못 쓰면 기본 테마 */ }
  document.documentElement.setAttribute('data-theme', theme);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', colors[theme]);
})();
