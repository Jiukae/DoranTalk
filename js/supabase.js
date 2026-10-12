// Supabase 연결 객체를 만들고, 설정값이 올바른지 검사합니다.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// 설정값 검사. 문제가 있으면 { ok:false, message } 를 돌려줍니다.
export function checkConfig() {
  const url = (SUPABASE_URL || '').trim();
  const key = (SUPABASE_ANON_KEY || '').trim();

  if (!url || url.startsWith('PASTE_') || !key || key.startsWith('PASTE_')) {
    return { ok: false, message: 'js/config.js 에 Supabase 주소와 공개 키가 아직 들어가지 않았어요.' };
  }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)) {
    return { ok: false, message: '주소 모양이 이상해요. https://xxxx.supabase.co 형태여야 해요.' };
  }
  if (isSecretKey(key)) {
    return {
      ok: false,
      danger: true,
      message: '비밀 키(secret / service_role)가 들어가 있어요! 바로 지우고 공개 키(publishable / anon)로 바꿔 주세요.',
    };
  }
  if (!key.startsWith('sb_publishable_') && jwtRole(key) !== 'anon') {
    return { ok: false, message: '공개 키 모양이 아니에요. sb_publishable_ 로 시작하는 키나 anon 키를 넣어 주세요.' };
  }
  return { ok: true };
}

function isSecretKey(key) {
  return key.startsWith('sb_secret_') || jwtRole(key) === 'service_role';
}

// 예전 방식 키(eyJ...)는 안에 role 정보가 들어 있어서 꺼내 볼 수 있습니다.
function jwtRole(key) {
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json).role || null;
  } catch {
    return null;
  }
}

const config = checkConfig();

export const sb = config.ok
  ? window.supabase.createClient(SUPABASE_URL.trim().replace(/\/$/, ''), SUPABASE_ANON_KEY.trim(), {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
