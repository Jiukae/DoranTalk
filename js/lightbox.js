// 사진을 화면 가득 크게 보기 (옆으로 넘기기, 닫기)
import { el, icon } from './ui.js';

export function openLightbox(urls, start = 0) {
  let index = start;
  const img = el('img', { class: 'lb-img', alt: '' });
  const counter = el('div', { class: 'lb-counter', 'aria-live': 'polite' });
  const prev = el('button', { class: 'lb-nav lb-prev', type: 'button', 'aria-label': '이전 사진' }, icon('back', { size: 30 }));
  const next = el('button', { class: 'lb-nav lb-next', type: 'button', 'aria-label': '다음 사진' }, icon('chevronRight', { size: 30 }));
  const close = el('button', { class: 'lb-close', type: 'button', 'aria-label': '닫기' }, icon('close', { size: 22 }), '닫기');

  const show = () => {
    img.src = urls[index];
    img.alt = `사진 ${index + 1} / ${urls.length}`;
    counter.textContent = urls.length > 1 ? `${index + 1} / ${urls.length}` : '';
    prev.hidden = index === 0;
    next.hidden = index === urls.length - 1;
  };
  const go = (d) => {
    const n = index + d;
    if (n >= 0 && n < urls.length) {
      index = n;
      show();
    }
  };

  // 위쪽 막대(몇 번째 사진 · 닫기) + 사진 칸(사진이 화면 안에 꼭 맞게 들어감)
  const stage = el('div', { class: 'lb-stage' }, img, prev, next);
  const box = el('div', { class: 'lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': '사진 크게 보기' },
    el('div', { class: 'lb-top' }, counter, close),
    stage);

  const onKey = (e) => {
    if (e.key === 'Escape') shut();
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === 'ArrowRight') go(1);
  };
  // 휴대폰에서 손가락으로 옆으로 밀어 넘기기
  let startX = null;
  box.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
  box.addEventListener('touchend', (e) => {
    if (startX == null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
    startX = null;
  });

  function shut() {
    box.remove();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', shut);
    document.body.classList.remove('no-scroll');
  }

  prev.addEventListener('click', () => go(-1));
  next.addEventListener('click', () => go(1));
  close.addEventListener('click', shut);
  // 사진 바깥의 검은 부분을 누르면 닫기
  box.addEventListener('click', (e) => { if (e.target === box || e.target === stage) shut(); });
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', shut);
  document.body.classList.add('no-scroll');
  document.body.append(box);
  show();
  close.focus();
}
