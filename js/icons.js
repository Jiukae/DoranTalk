// 선 아이콘 모음 (이모지 대신 앱 전체에서 같은 모양으로)
// 모양은 Lucide 아이콘(ISC 라이선스, icons/LICENSE-lucide.txt)을 바탕으로 했어요.
// innerHTML 을 쓰지 않고 SVG 요소를 하나씩 만들어요.

const SVG_NS = 'http://www.w3.org/2000/svg';

const p = (d) => ['path', { d }];
const c = (cx, cy, r) => ['circle', { cx, cy, r }];
const r = (x, y, width, height, rx) => ['rect', { x, y, width, height, rx }];

const ICONS = {
  back: [p('m15 18-6-6 6-6')],
  chevronRight: [p('m9 18 6-6-6-6')],
  home: [
    p('M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8'),
    p('M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'),
  ],
  feed: [
    p('M15 18h-5'), p('M18 14h-8'),
    p('M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0v-9a2 2 0 0 1 2-2h2'),
    r(10, 6, 8, 4, 1),
  ],
  chat: [p('M7.9 20A9 9 0 1 0 4 16.1L2 22Z')],
  comment: [p('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z')],
  family: [
    p('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'), c(9, 7, 4),
    p('M22 21v-2a4 4 0 0 0-3-3.87'), p('M16 3.13a4 4 0 0 1 0 7.75'),
  ],
  heart: [p('M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z')],
  more: [c(12, 12, 1), c(19, 12, 1), c(5, 12, 1)],
  camera: [
    p('M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z'), c(12, 13, 3),
  ],
  image: [r(3, 3, 18, 18, 2), c(9, 9, 2), p('m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21')],
  plus: [p('M5 12h14'), p('M12 5v14')],
  edit: [
    p('M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z'),
    p('m15 5 4 4'),
  ],
  trash: [p('M3 6h18'), p('M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6'), p('M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2')],
  logout: [p('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4'), p('m16 17 5-5-5-5'), p('M21 12H9')],
  mail: [r(2, 4, 20, 16, 2), p('m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7')],
  share: [p('M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8'), p('m16 6-4-4-4 4'), p('M12 2v13')],
  help: [c(12, 12, 10), p('M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3'), p('M12 17h.01')],
  shield: [
    p('M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z'),
    p('m9 12 2 2 4-4'),
  ],
  document: [
    p('M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z'), p('M14 2v4a2 2 0 0 0 2 2h4'),
    p('M10 9H8'), p('M16 13H8'), p('M16 17H8'),
  ],
  palette: [
    p('M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z'),
    c(13.5, 6.5, 0.5), c(17.5, 10.5, 0.5), c(8.5, 7.5, 0.5), c(6.5, 12.5, 0.5),
  ],
  user: [p('M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2'), c(12, 7, 4)],
  userPlus: [p('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'), c(9, 7, 4), p('M19 8v6'), p('M22 11h-6')],
  download: [p('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'), p('m7 10 5 5 5-5'), p('M12 15V3')],
  phone: [r(5, 2, 14, 20, 2), p('M12 18h.01')],
  check: [p('M20 6 9 17l-5-5')],
  close: [p('M18 6 6 18'), p('m6 6 12 12')],
  lock: [r(3, 11, 18, 11, 2), p('M7 11V7a5 5 0 0 1 10 0v4')],
  search: [c(11, 11, 8), p('m21 21-4.3-4.3')],
  activity: [p('M22 12h-4l-3 9L9 3l-3 9H2')],
  key: [
    p('M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z'),
    c(16.5, 7.5, 0.5),
  ],
  wrench: [p('M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z')],
  sparkles: [
    p('M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z'),
    p('M20 3v4'), p('M22 5h-4'),
  ],
  arrowUp: [p('m5 12 7-7 7 7'), p('M12 19V5')],
  arrowDown: [p('M12 5v14'), p('m19 12-7 7-7-7')],
  send: [
    p('M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z'),
    p('m21.854 2.147-10.94 10.939'),
  ],
};

// icon('heart', { size: 22, filled: true, label: '하트' })
// label 이 없으면 화면 읽기 프로그램에서 건너뛰어요(옆에 글자가 있으니까).
export function icon(name, { size = 24, filled = false, label = '', className = '' } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const attrs = {
    viewBox: '0 0 24 24', width: size, height: size, fill: filled ? 'currentColor' : 'none',
    stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    class: `icon icon-${name}${filled ? ' icon-filled' : ''}${className ? ` ${className}` : ''}`,
    focusable: 'false',
  };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, String(v));
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  for (const [tag, shapeAttrs] of ICONS[name] || []) {
    const shape = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(shapeAttrs)) shape.setAttribute(k, String(v));
    svg.append(shape);
  }
  return svg;
}
