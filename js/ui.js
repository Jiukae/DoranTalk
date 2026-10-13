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

// 화면 위쪽 막대. left/right 에 버튼을 넣을 수 있어요.
export function appBar(title, { left = null, right = null } = {}) {
  return el('header', { class: 'appbar' },
    el('div', { class: 'appbar-inner' },
      el('div', { class: 'appbar-side' }, left),
      el('h1', { class: 'appbar-title' }, title),
      el('div', { class: 'appbar-side appbar-right' }, right),
    ),
  );
}

export function backButton(onClick, label = '뒤로') {
  return el('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: onClick },
    el('span', { 'aria-hidden': 'true' }, '‹ '), label);
}

let fieldSeq = 0;
// 이름표 + 입력칸 + 도움말을 한 묶음으로. control 은 입력칸 또는 passwordInput() 결과
export function field(labelText, control, hintText) {
  const input = control.input || control;
  input.id = input.id || `f${++fieldSeq}`;
  const hint = hintText ? el('p', { class: 'hint', id: `${input.id}-hint` }, hintText) : null;
  if (hint) input.setAttribute('aria-describedby', hint.id);
  return el('div', { class: 'field' }, el('label', { class: 'label', for: input.id }, labelText), control, hint);
}

// 비밀번호 칸 + "보기" 버튼. 돌려준 묶음의 .input 이 실제 입력칸이에요.
export function passwordInput(attrs = {}) {
  const input = el('input', { class: 'input', type: 'password', minlength: 6, required: true, ...attrs });
  const toggle = el('button', {
    class: 'pw-toggle', type: 'button', 'aria-label': '비밀번호 보기',
    onclick: () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.textContent = show ? '숨기기' : '보기';
      toggle.setAttribute('aria-label', show ? '비밀번호 숨기기' : '비밀번호 보기');
    },
  }, '보기');
  const wrap = el('div', { class: 'pw-wrap' }, input, toggle);
  wrap.input = input;
  return wrap;
}

// 폼 안에 보여 주는 안내/오류 상자
export function messageBox() {
  const box = el('div', { class: 'form-msg', role: 'alert', hidden: true });
  box.show = (text, kind = 'error') => {
    box.className = `form-msg ${kind}`;
    box.textContent = text;
    box.hidden = false;
  };
  box.clear = () => { box.hidden = true; box.textContent = ''; };
  return box;
}

// 버튼을 "처리 중" 상태로 바꿨다가 되돌리기
export function setBusy(button, busy, busyText = '잠시만요…') {
  if (busy) {
    button.dataset.label = button.textContent;
    button.disabled = true;
    button.replaceChildren(el('span', { class: 'spinner spinner-sm', 'aria-hidden': 'true' }), busyText);
  } else {
    button.disabled = false;
    button.textContent = button.dataset.label || button.textContent;
  }
}

export function loadingScreen(text = '불러오는 중…') {
  return el('div', { class: 'splash' },
    el('div', { class: 'center muted' }, el('div', { class: 'spinner', style: 'margin:0 auto 12px' }), text));
}

// 닉네임 첫 글자가 들어간 동그라미
export function avatar(nickname, size = '') {
  return el('div', { class: `avatar ${size}`, 'aria-hidden': 'true' }, (nickname || '?').slice(0, 1));
}

// 내용이 없을 때 보여 주는 안내
export function emptyState(emoji, title, ...lines) {
  return el('div', { class: 'empty' },
    el('div', { class: 'big-emoji', 'aria-hidden': 'true' }, emoji),
    el('p', { class: 'empty-title' }, title),
    ...lines.map((line) => el('p', { class: 'muted' }, line)),
  );
}

export function errorCard(message, onRetry) {
  return el('section', { class: 'card stack' },
    el('p', { class: 'form-msg error', style: 'margin:0' }, message),
    onRetry && el('button', { class: 'btn btn-secondary btn-block', type: 'button', onclick: onRetry }, '다시 시도'),
  );
}

// 휴대폰 키보드가 올라오면 아래쪽 입력칸(댓글·채팅)이 키보드 바로 위에 붙도록
// 키보드 높이를 CSS 변수 --kb 로 알려 줘요. (아이폰 Safari 대응)
export function trackKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => {
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    document.documentElement.style.setProperty('--kb', `${kb}px`);
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}
