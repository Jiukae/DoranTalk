// 화면을 그릴 때 쓰는 작은 도우미 함수들.
// 사용자가 쓴 글은 반드시 텍스트로만 넣어서(innerHTML 사용 안 함) 해킹 코드가 실행되지 않게 합니다.

// el('div', { class: 'card', onclick: fn }, '글자', 다른요소...)
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs || {})) {
    if (value === false || value == null) continue;
    if (name.startsWith('on') && typeof value === 'function') {
      node.addEventListener(name.slice(2).toLowerCase(), value);
    } else if (name === 'class') {
      node.className = value;
    } else if (value === true) {
      node.setAttribute(name, '');
    } else {
      node.setAttribute(name, String(value));
    }
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

// #app 영역을 새 화면으로 바꿉니다.
export function render(...nodes) {
  const app = document.getElementById('app');
  app.replaceChildren(...nodes);
  window.scrollTo(0, 0);
}

let toastTimer;
// 화면 아래에 잠깐 뜨는 안내 문구
export function toast(message, ms = 2600) {
  document.querySelector('.toast')?.remove();
  clearTimeout(toastTimer);
  const t = el('div', { class: 'toast', role: 'status' }, message);
  document.body.append(t);
  toastTimer = setTimeout(() => t.remove(), ms);
}

export function brandHeader(subtitle = '우리 가족 소식방') {
  return el('div', { class: 'brand' },
    el('div', { class: 'brand-logo', 'aria-hidden': 'true' }, '🏡'),
    el('div', {},
      el('p', { class: 'brand-name' }, 'TalkFeed'),
      el('p', { class: 'brand-sub' }, subtitle),
    ),
  );
}
