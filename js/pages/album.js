// 사진 탭: 소식 · 채팅에 올린 사진을 달마다 모아 보기 (누구나 무료)
// 가족 프리미엄 그룹은 한 달 사진을 압축 파일 하나로 한 번에 내려받을 수 있어요.
import { sb } from '../supabase.js';
import { go, isStale } from '../router.js';
import { friendlyError } from '../errors.js';
import { el, icon, toast, emptyState, errorCard, skeletonRows, confirmDialog } from '../ui.js';
import { signedUrls } from '../images.js';
import { openLightbox } from '../lightbox.js';
import { isPremium } from '../premium.js';
import { makeZip } from '../zip.js';

const MAX_ITEMS = 600; // 소식 · 채팅 각각 최근 600개까지

function check({ data, error }) {
  if (error) throw error;
  return data;
}

// 그룹의 사진 목록 (최근 것부터): [{ path, at }]
async function fetchGroupPhotos(groupId) {
  const [posts, messages] = await Promise.all([
    sb.from('posts').select('id, created_at, image_paths').eq('group_id', groupId)
      .neq('image_paths', '{}').order('created_at', { ascending: false }).limit(MAX_ITEMS),
    sb.from('messages').select('id, created_at, image_path').eq('group_id', groupId)
      .not('image_path', 'is', null).order('created_at', { ascending: false }).limit(MAX_ITEMS),
  ]);
  const items = [];
  for (const p of check(posts)) for (const path of p.image_paths || []) items.push({ path, at: p.created_at });
  for (const m of check(messages)) items.push({ path: m.image_path, at: m.created_at });
  return items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

const monthKeyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' });
function monthKey(at) {
  const parts = Object.fromEntries(monthKeyFmt.formatToParts(new Date(at)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}`;
}
function monthLabel(key) {
  const [y, m] = key.split('-');
  return `${y}년 ${Number(m)}월`;
}

function groupByMonth(items) {
  const months = [];
  for (const it of items) {
    const key = monthKey(it.at);
    let m = months[months.length - 1];
    if (!m || m.key !== key) months.push(m = { key, items: [] });
    m.items.push(it);
  }
  return months;
}

export async function renderPhotosTab(main, group, token) {
  const body = el('div', {}, skeletonRows(2));
  main.append(body);
  let items;
  try {
    items = await fetchGroupPhotos(group.id);
  } catch (err) {
    if (!isStale(token)) body.replaceChildren(errorCard(friendlyError(err), () => go(`/group/${group.id}/photos`)));
    return undefined;
  }
  if (isStale(token)) return undefined;
  if (!items.length) {
    body.replaceChildren(el('section', { class: 'card' },
      emptyState('image', '아직 사진이 없어요', '소식이나 채팅에 사진을 올리면 여기에 달마다 모여요.')));
    return undefined;
  }

  const premium = isPremium(group);
  const months = groupByMonth(items);
  const sections = months.map((m) => monthSection(m, group, premium));
  body.replaceChildren(
    el('p', { class: 'muted album-intro' }, `사진 ${items.length}장 · 소식과 채팅에 올린 사진이 달마다 모여요`),
    ...sections.map((s) => s.node),
  );

  // 화면 가까이 온 달만 사진 주소를 받아 와요 (사진이 많아도 처음이 빠르게)
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      sections.find((s) => s.node === e.target)?.load();
    }
  }, { rootMargin: '800px 0px' });
  sections.forEach((s) => io.observe(s.node));
  return () => io.disconnect();
}

function monthSection(m, group, premium) {
  const paths = m.items.map((it) => it.path);
  let urls = null;
  const imgs = [];
  const grid = el('div', { class: 'album-grid' },
    ...m.items.map((it, i) => {
      const img = el('img', { alt: '', loading: 'lazy', decoding: 'async' });
      img.addEventListener('error', () => img.classList.add('missing'));
      imgs.push(img);
      return el('button', {
        class: 'album-cell', type: 'button', 'aria-label': `${monthLabel(m.key)} 사진 ${i + 1} 크게 보기`,
        onclick: async () => {
          await load();
          const list = paths.map((p) => urls?.[p]).filter(Boolean);
          if (list.length) openLightbox(list, Math.max(0, list.indexOf(urls[paths[i]])));
        },
      }, img);
    }),
  );

  async function load() {
    if (urls) return;
    try {
      urls = await signedUrls(paths);
      imgs.forEach((img, i) => { if (urls[paths[i]]) img.src = urls[paths[i]]; else img.classList.add('missing'); });
    } catch {
      urls = null;
    }
  }

  const download = el('button', { class: `btn btn-ghost btn-small album-download ${premium ? '' : 'locked'}`, type: 'button' },
    icon(premium ? 'download' : 'lock', { size: 20 }), '한 번에 내려받기');
  download.addEventListener('click', () => (premium ? downloadMonth(m, group, download) : premiumOnly(group)));

  const node = el('section', { class: 'card album-month' },
    el('div', { class: 'album-head' },
      el('h2', {}, monthLabel(m.key), el('span', { class: 'album-count' }, `${m.items.length}장`)),
      download,
    ),
    grid,
  );
  return { node, load };
}

async function premiumOnly(group) {
  const ok = await confirmDialog({
    title: '가족 프리미엄 기능이에요',
    message: '멤버 탭의 "가족 프리미엄"에서 쿠폰을 넣으면 한 달 사진을 한 번에 내려받을 수 있어요. 사진 한 장씩은 크게 본 뒤 길게 눌러 저장할 수 있어요.',
    confirmText: '멤버 탭으로',
    cancelText: '닫기',
  });
  if (ok) go(`/group/${group.id}/members`);
}

// 한 달 사진을 압축 파일(zip) 하나로 (오래된 사진부터 001, 002, …)
async function downloadMonth(m, group, button) {
  const kept = [...button.childNodes];
  button.disabled = true;
  try {
    const list = [...m.items].reverse();
    const urls = await signedUrls(list.map((it) => it.path));
    const files = [];
    for (let i = 0; i < list.length; i++) {
      button.replaceChildren(el('span', { class: 'spinner spinner-sm', 'aria-hidden': 'true' }), ` ${i + 1}/${list.length}`);
      const url = urls[list[i].path];
      if (!url) continue;
      const res = await fetch(url);
      if (!res.ok) continue;
      const ext = (list[i].path.match(/\.(\w+)$/)?.[1] || 'jpg').toLowerCase();
      // 이름은 영어 · 숫자로만 (한글 이름은 휴대폰 · 컴퓨터에 따라 깨지거나 "download" 로 바뀌어요)
      files.push({ name: `dorantalk-${m.key}-${String(i + 1).padStart(3, '0')}.${ext}`, data: new Uint8Array(await res.arrayBuffer()), date: new Date(list[i].at) });
    }
    if (!files.length) throw new Error('사진을 받아 오지 못했어요. 인터넷 연결을 확인하고 다시 해 주세요.');
    const blob = makeZip(files);
    const a = el('a', { href: URL.createObjectURL(blob), download: `dorantalk-${m.key}.zip` });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 30000);
    toast(`사진 ${files.length}장을 압축 파일로 내려받았어요.`);
  } catch (err) {
    toast(friendlyError(err), 4000);
  } finally {
    button.replaceChildren(...kept);
    button.disabled = false;
  }
}
