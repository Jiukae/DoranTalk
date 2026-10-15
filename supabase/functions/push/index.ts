// =====================================================================
//  도란톡 알림 서버 (Supabase Edge Function 이름: push)
// ---------------------------------------------------------------------
//  가족이 채팅 · 글 · 댓글 · 초대를 보내면, 앱이 이 서버에 "알려 줘"라고 부탁해요.
//  이 서버는
//    1) 보낸 사람의 로그인 정보 그대로 DB의 push_targets 함수에 "누구에게 무슨 내용으로?"를 묻고
//       (DB가 본인 확인 · 같은 그룹인지 · 한 번만 보내는지를 모두 검사해요)
//    2) 받는 사람 휴대폰의 알림 서버(구글 · 애플 · 모질라)로 암호화한 알림을 보내요.
//  관리용 비밀 키(service role)는 쓰지 않아요. 필요한 비밀 값은 알림 열쇠(VAPID) 하나뿐이고,
//  Supabase → Edge Functions → Secrets 에만 넣어 둡니다. (코드에는 절대 넣지 않아요)
//
//  필요한 Secrets
//    VAPID_PUBLIC_KEY   공개 열쇠 (앱 #/push-setup 화면에서 만들어요)
//    VAPID_PRIVATE_KEY  비밀 열쇠 (위와 한 쌍)
//    VAPID_SUBJECT      (선택) 연락처. 기본값 mailto:admin@dorantalk.com
//
//  외부 라이브러리 없이 표준 암호 기능(WebCrypto)만 써요.
//    - 알림 내용 암호화: RFC 8291 (aes128gcm)
//    - 보낸 곳 증명(VAPID): RFC 8292
// =====================================================================

const DEFAULT_SUBJECT = 'mailto:admin@dorantalk.com';
const KINDS = ['message', 'post', 'comment', 'invite', 'test'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 휴대폰 회사의 알림 서버로만 보내요 (다른 주소로는 절대 보내지 않음)
const PUSH_HOSTS = [
  /(^|\.)fcm\.googleapis\.com$/, // 안드로이드 · 크롬
  /(^|\.)push\.apple\.com$/, // 아이폰 · 사파리
  /(^|\.)push\.services\.mozilla\.com$/, // 파이어폭스
  /(^|\.)notify\.windows\.com$/, // 윈도우 엣지
];

const enc = new TextEncoder();

type Bytes = Uint8Array<ArrayBuffer>;
type Keys = { privateKey: CryptoKey; publicB64: string };
type Target = { endpoint: string; p256dh: string; auth: string; title: string; body: string; url: string; tag: string; badge: number };
type Env = (name: string) => string;
type Options = { fetch?: typeof fetch; env?: Env };

function corsHeaders(req: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': req.headers.get('access-control-request-headers')
      || 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400',
  };
}

export function b64u(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64u(str: string): Bytes {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

// 알림 내용을 받는 휴대폰만 열어 볼 수 있게 암호화 (RFC 8291 · aes128gcm, 레코드 하나)
export async function encryptPayload(plaintext: string, p256dh: string, authSecretB64: string): Promise<Bytes> {
  const uaPublic = unb64u(p256dh);
  const authSecret = unb64u(authSecretB64);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4 || authSecret.length !== 16) throw new Error('bad subscription keys');

  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));

  const ikm = await hkdf(authSecret, ecdhSecret, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const record = concat(enc.encode(plaintext), new Uint8Array([2])); // 2 = 마지막 레코드 표시
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, record));

  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096); // 레코드 크기
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

// 알림 열쇠(VAPID) 읽기 + 공개 · 비밀 열쇠가 한 쌍인지 확인
export async function loadVapidKeys(publicB64: string, privateB64: string): Promise<Keys> {
  let pub: Bytes;
  let d: Bytes;
  try {
    pub = unb64u(publicB64.trim());
    d = unb64u(privateB64.trim());
  } catch {
    throw new Error('알림 열쇠(VAPID)에 쓸 수 없는 글자가 있어요. 다시 복사해 붙여 넣어 주세요.');
  }
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('공개 열쇠(VAPID_PUBLIC_KEY) 형식이 맞지 않아요.');
  if (d.length !== 32) throw new Error('비밀 열쇠(VAPID_PRIVATE_KEY) 형식이 맞지 않아요.');
  const jwk = { kty: 'EC', crv: 'P-256', x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: b64u(d), ext: true };
  let privateKey: CryptoKey;
  try {
    privateKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  } catch {
    throw new Error('공개 열쇠와 비밀 열쇠가 한 쌍이 아니에요. 같은 때 만든 두 열쇠를 넣어 주세요.');
  }
  const verifyKey = await crypto.subtle.importKey('raw', pub, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const probe = enc.encode('dorantalk');
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, probe);
  if (!(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifyKey, sig, probe))) {
    throw new Error('공개 열쇠와 비밀 열쇠가 한 쌍이 아니에요. 같은 때 만든 두 열쇠를 넣어 주세요.');
  }
  return { privateKey, publicB64: b64u(pub) };
}

// "도란톡이 보낸 알림"이라는 증명 (RFC 8292)
export async function vapidAuthorization(endpoint: string, keys: Keys, subject: string): Promise<string> {
  const aud = new URL(endpoint).origin;
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, enc.encode(`${head}.${claims}`)));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${keys.publicB64}`;
}

export function allowedEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

function defaultEnv(name: string): string {
  // deno-lint-ignore no-explicit-any
  const g = globalThis as any;
  return (g.Deno ? g.Deno.env.get(name) : g.process?.env?.[name]) || '';
}

// 서버 본체. 시험할 때는 fetch · env 를 바꿔 끼울 수 있어요.
export function createHandler({ fetch: fetchFn = fetch, env = defaultEnv }: Options = {}) {
  let cached: { pub: string; priv: string; keys: Keys } | null = null;
  async function vapidKeys(): Promise<Keys | null> {
    const pub = env('VAPID_PUBLIC_KEY');
    const priv = env('VAPID_PRIVATE_KEY');
    if (!pub || !priv) return null;
    if (!cached || cached.pub !== pub || cached.priv !== priv) {
      cached = { pub, priv, keys: await loadVapidKeys(pub, priv) };
    }
    return cached.keys;
  }

  return async function handle(req: Request): Promise<Response> {
    const cors = corsHeaders(req);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
    });

    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

    // 준비 상태 + 공개 열쇠 (앱이 "알림 켜기" 할 때 씀)
    if (req.method === 'GET') {
      try {
        const keys = await vapidKeys();
        return json({ ready: Boolean(keys), publicKey: keys ? keys.publicB64 : null });
      } catch (err) {
        return json({ ready: false, publicKey: null, error: (err as Error).message });
      }
    }
    if (req.method !== 'POST') return json({ error: 'GET 또는 POST 만 돼요.' }, 405);

    let keys: Keys | null;
    try {
      keys = await vapidKeys();
    } catch (err) {
      return json({ error: (err as Error).message }, 500);
    }
    if (!keys) return json({ error: '알림 열쇠(VAPID)가 아직 설정되지 않았어요.' }, 503);

    const authorization = req.headers.get('authorization') || '';
    if (!/^Bearer\s+[\w-]+\.[\w-]+\.[\w-]+$/.test(authorization)) return json({ error: '로그인이 필요해요.' }, 401);

    let input: { kind?: string; id?: string } | null;
    try {
      input = await req.json();
    } catch {
      return json({ error: '요청 형식이 맞지 않아요.' }, 400);
    }
    const kind = input?.kind;
    const id = input?.id ?? null;
    if (!kind || !KINDS.includes(kind) || (kind !== 'test' && !UUID.test(String(id)))) {
      return json({ error: '요청 형식이 맞지 않아요.' }, 400);
    }

    const base = env('SUPABASE_URL').replace(/\/$/, '');
    const apikey = req.headers.get('apikey') || env('SUPABASE_ANON_KEY');
    // 보낸 사람의 로그인 정보 그대로 DB에 물어봐요 (DB 보안 규칙이 그대로 적용)
    const rpc = (name: string, args: unknown) => fetchFn(`${base}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authorization, ...(apikey ? { apikey } : {}) },
      body: JSON.stringify(args),
    });

    const res = await rpc('push_targets', { p_kind: kind, p_id: kind === 'test' ? null : id });
    if (!res.ok) {
      return json({ error: '받을 사람을 찾지 못했어요.', status: res.status }, res.status === 401 ? 401 : 502);
    }
    const targets: Target[] = await res.json();
    const vapid = keys;

    const subject = env('VAPID_SUBJECT') || DEFAULT_SUBJECT;
    const urgency = kind === 'message' || kind === 'invite' || kind === 'test' ? 'high' : 'normal';
    const gone: string[] = [];
    let sent = 0;
    let failed = 0;
    await Promise.all(targets.map(async (t) => {
      if (!allowedEndpoint(t.endpoint)) {
        failed += 1;
        return;
      }
      const payload = JSON.stringify({ kind, title: t.title, body: t.body, url: t.url, tag: t.tag, badge: t.badge });
      try {
        const body = await encryptPayload(payload, t.p256dh, t.auth);
        const r = await fetchFn(t.endpoint, {
          method: 'POST',
          headers: {
            Authorization: await vapidAuthorization(t.endpoint, vapid, subject),
            'Content-Encoding': 'aes128gcm',
            'Content-Type': 'application/octet-stream',
            TTL: String(24 * 3600), // 휴대폰이 꺼져 있으면 하루 동안 기다렸다가 전달
            Urgency: urgency,
          },
          body,
        });
        if (r.status >= 200 && r.status < 300) sent += 1;
        else {
          failed += 1;
          // 앱을 지웠거나 알림을 막은 기기 → 목록에서 지워요
          if (r.status === 404 || r.status === 410) gone.push(t.endpoint);
        }
      } catch {
        failed += 1;
      }
    }));
    if (gone.length) await rpc('push_forget', { p_endpoints: gone }).catch(() => null);
    return json({ sent, failed, removed: gone.length });
  };
}

// Supabase 에서 실행될 때 서버 시작 (시험에서 불러 쓸 때는 __PUSH_NO_SERVE__ 로 끔)
// deno-lint-ignore no-explicit-any
const runtime = globalThis as any;
if (runtime.Deno?.serve && !runtime.__PUSH_NO_SERVE__) runtime.Deno.serve(createHandler());
