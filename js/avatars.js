// 프로필 사진 · 색
// - avatar(닉네임, 크기, 사용자id) 로 만든 동그라미에 그 사람이 고른 사진 · 색을 입혀요.
// - 한 화면에 여러 사람이 나오면 모아서 한 번에 불러오고, 5분 동안은 다시 안 불러와요.
// - 사진은 사진 창고(family-photos)의 avatars/{내 id}/ 폴더에 256px 정사각형 JPEG 로 올려요.
//   (같은 그룹 가족처럼 내 닉네임을 볼 수 있는 사람만 볼 수 있어요 — 데이터베이스 버전 11)
// - 데이터베이스가 버전 11 전이면 예전처럼 닉네임에 따라 정해진 색만 보여요.
import { sb } from './supabase.js';
import { state } from './state.js';
import { BUCKET, uuid, loadImage, removeImages, signedUrls } from './images.js';
import { el, colorIndex, setAvatarHook } from './ui.js';

export const AVATAR_COLOR_COUNT = 8;
const LOOK_TTL = 5 * 60 * 1000;
const SIDE = 256;
const looks = new Map(); // 사용자id → { color, path, url, until }
const queue = new Map(); // 사용자id → [동그라미, ...] (불러오기를 기다리는 것)
const nicknames = new WeakMap(); // 동그라미 → 닉네임 (자동 색 계산용)
let timer = null;
let unsupported = false; // 데이터베이스 버전 11 전

// 이 계정의 데이터베이스가 프로필 사진을 지원하는지 (내 프로필에 칸이 있으면 버전 11 이상)
export function avatarsSupported() {
  return Boolean(state.profile && 'avatar_color' in state.profile);
}

// 고른 색 번호 (안 골랐으면 닉네임에 따라 자동)
export function lookColor(look, nickname) {
  return Number.isInteger(look?.color) ? look.color : colorIndex(nickname);
}

function paint(node, look) {
  for (const c of [...node.classList]) if (/^av-\d+$/.test(c)) node.classList.remove(c);
  node.classList.add(`av-${lookColor(look, nicknames.get(node) ?? '')}`);
  const current = node.querySelector('img');
  if (!look?.url) {
    current?.remove();
    node.classList.remove('has-photo');
    return;
  }
  if (current?.dataset.path === look.path) return;
  // 사진이 다 받아질 때까지는 색 동그라미 + 첫 글자가 보여요
  const img = el('img', { src: look.url, alt: '', decoding: 'async', 'data-path': look.path });
  img.addEventListener('load', () => node.classList.add('has-photo'));
  img.addEventListener('error', () => { img.remove(); node.classList.remove('has-photo'); });
  current?.remove();
  node.append(img);
}

async function flush() {
  timer = null;
  const batch = new Map(queue);
  queue.clear();
  const ids = [...batch.keys()];
  if (!ids.length || !state.session || unsupported) return;
  try {
    for (let i = 0; i < ids.length; i += 100) {
      const part = ids.slice(i, i + 100);
      const { data, error } = await sb.from('profiles').select('id, avatar_color, avatar_path').in('id', part);
      if (error) {
        if (error.code === '42703') { unsupported = true; return; } // 버전 11 전
        throw error;
      }
      const paths = (data || []).map((r) => r.avatar_path).filter(Boolean);
      const urls = paths.length ? await signedUrls(paths).catch(() => ({})) : {};
      const until = Date.now() + LOOK_TTL;
      for (const id of part) looks.set(id, { color: null, path: null, url: null, until });
      for (const r of data || []) {
        looks.set(r.id, { color: r.avatar_color, path: r.avatar_path, url: r.avatar_path ? urls[r.avatar_path] || null : null, until });
      }
      for (const id of part) for (const node of batch.get(id)) paint(node, looks.get(id));
    }
  } catch (err) {
    console.warn('프로필 사진을 불러오지 못했어요', err);
  }
}

setAvatarHook((node, userId, nickname) => {
  nicknames.set(node, nickname);
  node.dataset.uid = userId;
  if (unsupported) return;
  const look = looks.get(userId);
  if (look) {
    paint(node, look);
    if (look.until > Date.now()) return;
  }
  if (!queue.has(userId)) queue.set(userId, []);
  queue.get(userId).push(node);
  if (!timer) timer = setTimeout(flush, 20);
});

// 로그아웃하면 기억해 둔 사진 · 색을 잊어요
export function forgetAvatars() {
  looks.clear();
  queue.clear();
  unsupported = false;
}

// 닉네임을 바꾼 뒤: 화면에 보이는 내 동그라미의 첫 글자 · 자동 색도 바꿔요
export function renameMyAvatars(nickname) {
  const me = state.session.user.id;
  for (const node of document.querySelectorAll('.avatar[data-uid]')) {
    if (node.dataset.uid !== me) continue;
    nicknames.set(node, nickname);
    const text = [...node.childNodes].find((n) => n.nodeType === Node.TEXT_NODE);
    if (text) text.textContent = (nickname || '?').slice(0, 1);
    paint(node, looks.get(me));
  }
}

// 내 사진 · 색을 바꾼 뒤: 화면에 보이는 내 동그라미를 모두 바로 바꿔요
function showMyLook(look) {
  const me = state.session.user.id;
  looks.set(me, { ...look, until: Date.now() + LOOK_TTL });
  for (const node of document.querySelectorAll('.avatar[data-uid]')) {
    if (node.dataset.uid === me) paint(node, looks.get(me));
  }
}

async function myLook(profile) {
  const path = profile.avatar_path || null;
  const url = path ? (await signedUrls([path]).catch(() => ({})))[path] || null : null;
  return { color: profile.avatar_color ?? null, path, url };
}

async function updateMyProfile(changes) {
  const { data, error } = await sb.from('profiles')
    .update(changes)
    .eq('id', state.session.user.id)
    .select('avatar_color, avatar_path')
    .single();
  if (error) throw error;
  Object.assign(state.profile, data);
  showMyLook(await myLook(state.profile));
  return data;
}

// 사진을 가운데 정사각형으로 잘라 256px JPEG 로 (사진의 회전 정보는 브라우저가 자동 반영)
export async function squareAvatar(file) {
  const { img, url } = await loadImage(file);
  try {
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const out = Math.max(1, Math.min(SIDE, side));
    const canvas = document.createElement('canvas');
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; // 투명한 PNG가 검게 나오지 않도록
    ctx.fillRect(0, 0, out, out);
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, out, out);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    if (!blob) throw new Error('사진을 준비하지 못했어요. 다른 사진으로 해 보세요.');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// 새 프로필 사진 올리기 (예전 사진은 지워요)
export async function saveAvatarPhoto(file) {
  const blob = await squareAvatar(file);
  const old = state.profile.avatar_path;
  const path = `avatars/${state.session.user.id}/${uuid()}.jpg`;
  const { error } = await sb.storage.from(BUCKET).upload(path, blob, {
    contentType: 'image/jpeg',
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) throw error;
  try {
    await updateMyProfile({ avatar_path: path });
  } catch (err) {
    await removeImages([path]);
    throw err;
  }
  if (old && old !== path) removeImages([old]);
}

// 프로필 사진 지우기 (색 동그라미로 돌아가요)
export async function removeAvatarPhoto() {
  const old = state.profile.avatar_path;
  await updateMyProfile({ avatar_path: null });
  if (old) removeImages([old]);
}

// 동그라미 색 고르기 (null = 닉네임에 따라 자동)
export async function saveAvatarColor(color) {
  await updateMyProfile({ avatar_color: color });
}
