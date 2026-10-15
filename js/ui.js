// 화면을 그릴 때 쓰는 작은 도우미 함수들.
// 사용자가 쓴 글은 반드시 텍스트로만 넣어서(innerHTML 사용 안 함) 해킹 코드가 실행되지 않게 합니다.
import { icon } from './icons.js';

export { icon };

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
// 화면 아래에 잠깐 뜨는 안내 문구 (아래에서 살짝 올라왔다가 사라져요)
export function toast(message, ms = 2600) {
  document.querySelector('.toast')?.remove();
  clearTimeout(toastTimer);
  const t = el('div', { class: 'toast', role: 'status' }, message);
  document.body.append(t);
  toastTimer = setTimeout(() => {
    t.classList.add('leaving');
    setTimeout(() => t.remove(), 200);
  }, ms);
}

export function brandHeader(subtitle = '우리 가족 소식방') {
  return el('div', { class: 'brand' },
    el('img', { class: 'brand-logo', src: '/icons/icon-192.png', alt: '', width: 52, height: 52 }),
    el('div', {},
      el('p', { class: 'brand-name' }, '도란톡'),
      el('p', { class: 'brand-sub' }, subtitle),
    ),
  );
}

// 로그인·회원가입 화면 맨 위의 큰 로고
export function brandHero(title, subtitle) {
  return el('header', { class: 'hero' },
    el('img', { class: 'hero-logo', src: '/icons/icon-192.png', alt: '도란톡', width: 76, height: 76 }),
    el('h1', { class: 'hero-title' }, title),
    subtitle && el('p', { class: 'hero-sub' }, subtitle),
  );
}

// 홈 위쪽 막대 왼쪽의 작은 로고 + 이름
export function brandMark() {
  return el('span', { class: 'brand-mark' },
    el('img', { src: '/icons/icon-192.png', alt: '', width: 30, height: 30 }),
    el('span', {}, '도란톡'));
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
  return el('button', { class: 'btn btn-ghost btn-small btn-back', type: 'button', onclick: onClick },
    icon('back', { size: 26 }), label);
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
    el('div', { class: 'center muted' }, el('div', { class: 'spinner spinner-brand', style: 'margin:0 auto 14px' }), text));
}

// 닉네임마다 늘 같은 색이 나오도록 (이름 글자로 색 번호를 정해요)
export function colorIndex(text = '') {
  let h = 0;
  for (const ch of String(text)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % 8;
}

// 닉네임 첫 글자가 들어간 동그라미
export function avatar(nickname, size = '') {
  return el('div', { class: `avatar ${size} av-${colorIndex(nickname)}`, 'aria-hidden': 'true' },
    (nickname || '?').slice(0, 1));
}

// 둥근 네모 안의 아이콘 (목록 · 안내 상자 앞에)
export function iconTile(name, tone = '') {
  return el('span', { class: `icon-tile ${tone}`, 'aria-hidden': 'true' }, icon(name, { size: 22 }));
}

// 내용이 없을 때 보여 주는 안내
export function emptyState(iconName, title, ...lines) {
  return el('div', { class: 'empty' },
    el('div', { class: 'empty-icon', 'aria-hidden': 'true' }, icon(iconName, { size: 34 })),
    el('p', { class: 'empty-title' }, title),
    ...lines.map((line) => el('p', { class: 'muted' }, line)),
  );
}

// 설정 화면 같은 목록 한 줄: 아이콘 · 글자 · 오른쪽 화살표
export function listRow({ icon: iconName, label, sub = '', href, onClick, tone = '', danger = false, external = false }) {
  const tag = href ? 'a' : 'button';
  return el(tag, {
    class: `list-row${danger ? ' danger' : ''}`,
    href: href || false,
    type: href ? false : 'button',
    onclick: onClick || false,
    target: external ? '_blank' : false,
    rel: external ? 'noopener' : false,
  },
    iconTile(iconName, danger ? 'tone-danger' : tone),
    el('span', { class: 'list-text' },
      el('span', { class: 'list-label' }, label),
      sub && el('span', { class: 'list-sub' }, sub)),
    icon('chevronRight', { size: 20, className: 'list-chevron' }),
  );
}

// 불러오는 동안 보여 주는 회색 틀 (글 카드 모양)
export function skeletonPosts(count = 2) {
  return el('div', { class: 'skeleton-list', 'aria-busy': 'true', 'aria-label': '불러오는 중' },
    ...Array.from({ length: count }, (_, i) => el('div', { class: 'card skeleton-card', 'aria-hidden': 'true' },
      el('div', { class: 'sk-row' }, el('span', { class: 'sk sk-circle' }),
        el('span', { class: 'sk-col' }, el('span', { class: 'sk sk-line w40' }), el('span', { class: 'sk sk-line w25' }))),
      el('span', { class: 'sk sk-line w90' }),
      el('span', { class: 'sk sk-line w70' }),
      i === 0 && el('span', { class: 'sk sk-block' }),
    )));
}

// 불러오는 동안 보여 주는 회색 틀 (목록 모양)
export function skeletonRows(count = 2) {
  return el('div', { class: 'skeleton-list', 'aria-busy': 'true', 'aria-label': '불러오는 중' },
    ...Array.from({ length: count }, () => el('div', { class: 'card skeleton-card sk-row', 'aria-hidden': 'true' },
      el('span', { class: 'sk sk-square' }),
      el('span', { class: 'sk-col' }, el('span', { class: 'sk sk-line w50' }), el('span', { class: 'sk sk-line w25' })))));
}

// ------------------------------------------------------------------
// 확인 창 · 아래에서 올라오는 메뉴 (브라우저 기본 창 대신 앱 모양으로)
// ------------------------------------------------------------------
function openOverlay(box, position, onDismiss) {
  const overlay = el('div', { class: `overlay overlay-${position}` }, box);
  const prevFocus = document.activeElement;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', onNav);
    overlay.classList.add('closing');
    setTimeout(() => overlay.remove(), 180);
    if (prevFocus && typeof prevFocus.focus === 'function' && document.contains(prevFocus)) prevFocus.focus();
  };
  const dismiss = () => { close(); onDismiss(); };
  const onKey = (e) => {
    if (e.key === 'Escape') dismiss();
    if (e.key === 'Tab') {
      // 창 안에서만 이동
      const items = [...box.querySelectorAll('button, a[href]')];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  const onNav = () => dismiss();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', onNav);
  document.body.append(overlay);
  return close;
}

// const ok = await confirmDialog({ title: '삭제할까요?', message: '되돌릴 수 없어요.', confirmText: '삭제', danger: true })
export function confirmDialog({ title, message = '', confirmText = '확인', cancelText = '취소', danger = false } = {}) {
  return new Promise((resolve) => {
    let close = () => {};
    const done = (result) => { close(); resolve(result); };
    const ok = el('button', { class: `btn ${danger ? 'btn-danger' : ''} dialog-confirm`, type: 'button', onclick: () => done(true) }, confirmText);
    const cancel = el('button', { class: 'btn btn-secondary dialog-cancel', type: 'button', onclick: () => done(false) }, cancelText);
    const box = el('div', {
      class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'dialog-title',
      'aria-describedby': message ? 'dialog-msg' : false,
    },
      el('h2', { class: 'dialog-title', id: 'dialog-title' }, title),
      message && el('p', { class: 'dialog-msg', id: 'dialog-msg' }, message),
      el('div', { class: 'dialog-actions' }, cancel, ok),
    );
    close = openOverlay(box, 'center', () => resolve(false));
    // 지우기처럼 되돌릴 수 없는 일은 "취소"에 먼저 손이 가도록
    (danger ? cancel : ok).focus();
  });
}

// actionSheet({ title: '내 글', actions: [{ label: '글 수정', icon: 'edit', onSelect }, { label: '글 삭제', icon: 'trash', danger: true, onSelect }] })
export function actionSheet({ title = '', actions = [] }) {
  let close = () => {};
  const items = actions.map((a) => el('button', {
    class: `sheet-item${a.danger ? ' danger' : ''}`, type: 'button',
    onclick: () => { close(); a.onSelect(); },
  }, a.icon && icon(a.icon, { size: 24 }), a.label));
  const cancel = el('button', { class: 'btn btn-secondary btn-block sheet-cancel', type: 'button', onclick: () => close() }, '닫기');
  const box = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || '메뉴' },
    el('span', { class: 'sheet-handle', 'aria-hidden': 'true' }),
    title && el('p', { class: 'sheet-title' }, title),
    el('div', { class: 'sheet-items' }, ...items),
    cancel,
  );
  close = openOverlay(box, 'bottom', () => {});
  items[0]?.focus();
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

// 아직 가입하지 않은 가족에게 도란톡 주소 보내기 (휴대폰: 공유 창 → 카카오톡 등 / 컴퓨터: 복사)
export async function shareAppLink() {
  const url = `${location.origin}/`;
  const text = '우리 가족 소식방 도란톡에 초대할게요! 😊\n'
    + '① 아래 링크를 눌러 회원가입해 주세요\n'
    + '② 가입할 때 정한 닉네임을 저에게 알려 주세요';
  if (navigator.share) {
    try {
      await navigator.share({ title: '도란톡', text, url });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return; // 사용자가 공유 창을 닫음
    }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast('초대 문구와 링크를 복사했어요. 카카오톡 대화방에 붙여넣어 보내 주세요.', 4500);
  } catch {
    toast(`이 주소를 가족에게 보내 주세요: ${url}`, 6000);
  }
}
