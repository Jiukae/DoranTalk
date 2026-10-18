// 사진 고르기 · 줄이기 · 올리기 · 보여 주기
// - 휴대폰 사진(보통 3~10MB)을 긴 쪽 1600px JPEG로 줄여서 올립니다 (보통 300~600KB).
// - 사진 창고는 비공개라서, 볼 때마다 1시간짜리 임시 주소(서명된 URL)를 받아 씁니다.
import { sb } from './supabase.js';

export const BUCKET = 'family-photos';
const MAX_SIDE = 1600;
const QUALITY = 0.82;
const URL_TTL = 60 * 60; // 1시간
const urlCache = new Map(); // 경로 → { url, until }

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// 사진 고르기 창 열기 (휴대폰에서는 앨범/카메라 선택)
export function pickImages({ multiple = true } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = multiple;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve([...(input.files || [])]);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

export function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이 사진은 열 수 없는 형식이에요. 다른 사진을 골라 주세요.'));
    };
    img.src = url;
  });
}

// 사진을 적당한 크기의 JPEG로 줄이기 (사진의 회전 정보는 브라우저가 자동 반영)
export async function shrinkImage(file) {
  const { img, url } = await loadImage(file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; // 투명한 PNG가 검게 나오지 않도록
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    if (!blob) throw new Error('사진을 준비하지 못했어요. 다른 사진으로 해 보세요.');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// 여러 장을 차례로 올리고, 저장된 경로 목록을 돌려줍니다.
// folder: 'posts' 또는 'chat'. 중간에 실패하면 이미 올린 사진은 지우고 오류를 던집니다.
export async function uploadImages(groupId, folder, blobs, onProgress = () => {}) {
  const done = [];
  try {
    for (let i = 0; i < blobs.length; i++) {
      onProgress(i + 1, blobs.length);
      const path = `${groupId}/${folder}/${uuid()}.jpg`;
      const { error } = await sb.storage.from(BUCKET).upload(path, blobs[i], {
        contentType: 'image/jpeg',
        cacheControl: '31536000',
        upsert: false,
      });
      if (error) throw error;
      done.push(path);
    }
    return done;
  } catch (err) {
    if (done.length) await removeImages(done);
    throw err;
  }
}

export async function removeImages(paths) {
  if (!paths?.length) return;
  const { error } = await sb.storage.from(BUCKET).remove(paths);
  if (error) console.warn('사진 정리 실패', error);
}

// 경로 목록 → { 경로: 임시주소 } (한 번에 받아 오고 50분 동안 재사용)
export async function signedUrls(paths) {
  const now = Date.now();
  const need = [...new Set(paths)].filter((p) => !(urlCache.get(p)?.until > now));
  if (need.length) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(need, URL_TTL);
    if (error) throw error;
    for (const row of data || []) {
      if (row.signedUrl && !row.error) {
        urlCache.set(row.path, { url: row.signedUrl, until: now + (URL_TTL - 600) * 1000 });
      }
    }
  }
  const result = {};
  for (const p of paths) result[p] = urlCache.get(p)?.url || null;
  return result;
}
