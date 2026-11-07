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

// 동영상: 사진 창고에 함께 넣어요 (한 개 50MB 까지 · mp4 · mov · webm, 한 사람이 하루 10개까지)
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const VIDEO_TYPES = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };
const VIDEO_MIME = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };

export function isVideoPath(path) {
  return /\.(mp4|mov|webm)$/i.test(String(path || ''));
}

export function isVideoFile(file) {
  return String(file?.type || '').startsWith('video/') || /\.(mp4|mov|webm|m4v)$/i.test(file?.name || '');
}

// 올릴 준비: 사진은 줄이고(JPEG), 동영상은 그대로 (크기 · 형식만 확인)
// → { blob, ext, type, video }
export async function prepareMedia(file, photoOptions = {}) {
  if (!isVideoFile(file)) {
    return { blob: await shrinkImage(file, photoOptions), ext: 'jpg', type: 'image/jpeg', video: false };
  }
  const ext = VIDEO_TYPES[file.type] || (file.name.match(/\.(mp4|mov|webm)$/i)?.[1] || (/\.m4v$/i.test(file.name) ? 'mp4' : '')).toLowerCase();
  if (!ext) throw new Error('이 동영상 형식은 올릴 수 없어요. 휴대폰 카메라로 찍은 mp4 · mov 동영상을 골라 주세요.');
  if (file.size > VIDEO_MAX_BYTES) {
    throw new Error(`동영상이 너무 커요 (${Math.round(file.size / 1024 / 1024)}MB). 50MB 이하만 올릴 수 있어요. 보통 1분 정도 길이예요. 휴대폰 사진 앱에서 앞뒤를 잘라 주세요.`);
  }
  // 휴대폰마다 동영상 형식 이름이 비어 있기도 해서, 형식을 정확히 붙인 복사본으로 올려요
  const blob = new Blob([await file.arrayBuffer()], { type: VIDEO_MIME[ext] });
  return { blob, ext, type: VIDEO_MIME[ext], video: true };
}

// 사진 고르기 창 열기 (휴대폰에서는 앨범/카메라 선택). video: true 면 동영상도 고를 수 있어요
export function pickImages({ multiple = true, video = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = video ? 'image/*,video/*' : 'image/*';
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
// 가족 프리미엄 그룹은 { maxSide: 4096, quality: 0.9 } 로 원본에 가깝게 (premium.js)
export async function shrinkImage(file, { maxSide = MAX_SIDE, quality = QUALITY } = {}) {
  const { img, url } = await loadImage(file);
  try {
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; // 투명한 PNG가 검게 나오지 않도록
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('사진을 준비하지 못했어요. 다른 사진으로 해 보세요.');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// 여러 장을 차례로 올리고, 저장된 경로 목록을 돌려줍니다.
// folder: 'posts' 또는 'chat'. items: 사진 Blob(JPEG) 또는 prepareMedia() 결과 { blob, ext, type }
// 중간에 실패하면 이미 올린 것은 지우고 오류를 던집니다.
export async function uploadImages(groupId, folder, items, onProgress = () => {}) {
  const done = [];
  try {
    for (let i = 0; i < items.length; i++) {
      onProgress(i + 1, items.length);
      const it = items[i] instanceof Blob ? { blob: items[i], ext: 'jpg', type: 'image/jpeg' } : items[i];
      const path = `${groupId}/${folder}/${uuid()}.${it.ext}`;
      const { error } = await sb.storage.from(BUCKET).upload(path, it.blob, {
        contentType: it.type,
        cacheControl: '31536000',
        upsert: false,
      });
      if (error) {
        // 하루 한도를 넘으면 보안 규칙이 막아요 (동영상 10개 · 사진 300장 · 모두 합쳐 500MB, 버전 15)
        if (/row-level security|policy|403|Unauthorized/i.test(String(error.message || error.statusCode || ''))) {
          throw new Error(it.type?.startsWith('video/')
            ? '동영상은 한 사람이 하루에 10개까지 올릴 수 있어요. 내일 다시 올려 주세요.'
            : '오늘은 더 올릴 수 없어요. 한 사람이 하루에 사진 300장 · 모두 합쳐 500MB까지 올릴 수 있어요. 내일 다시 올려 주세요.');
        }
        throw error;
      }
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
