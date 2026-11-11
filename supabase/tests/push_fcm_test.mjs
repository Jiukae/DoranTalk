// 알림 서버(supabase/functions/push/index.ts) 시험 — 안드로이드 앱(버전 2) Firebase 알림 + 기본 보안
// 실행: node supabase/tests/push_fcm_test.mjs   (Node 22 이상, 외부 라이브러리 없음)
// 결과: RESULT|번호|분류|PASS/FAIL|내용|자세히 · 하나라도 FAIL 이면 종료 코드 1
import crypto from 'node:crypto';

globalThis.__PUSH_NO_SERVE__ = true;
const fn = await import(new URL('../functions/push/index.ts', import.meta.url));
const BASE = 'https://proj.supabase.co';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln';
const CAT = '알림 서버 (Firebase)';
const results = [];
const rec = (id, title, ok, detail = '') => results.push({ id, title, ok: Boolean(ok), detail: String(detail).replace(/\s+/g, ' ').slice(0, 160) });

// 시험용 열쇠: Firebase 서비스 계정(RSA) · 웹 알림(VAPID)
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const SA = { type: 'service_account', project_id: 'dorantalk-test', client_email: 'fcm@dorantalk-test.iam.gserviceaccount.com', private_key: privateKey };
const ec = crypto.createECDH('prime256v1'); ec.generateKeys();
const vapidPriv = Buffer.concat([Buffer.alloc(32), ec.getPrivateKey()]).subarray(-32);
const ENV = { SUPABASE_URL: BASE, VAPID_PUBLIC_KEY: fn.b64u(ec.getPublicKey()), VAPID_PRIVATE_KEY: fn.b64u(vapidPriv), FCM_SERVICE_ACCOUNT: JSON.stringify(SA), PUSH_DB_KEY: 'k-test' };
const env = (extra = {}) => { const e = { ...ENV, ...extra }; return (n) => e[n] || ''; };

const TOKEN = 'fcmTOKEN_' + 'a'.repeat(140);
const GONE = 'goneTOKEN_' + 'b'.repeat(140);
const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
const webTarget = { endpoint: 'https://fcm.googleapis.com/fcm/send/web1', p256dh: fn.b64u(ua.getPublicKey()), auth: fn.b64u(crypto.randomBytes(16)), title: '우리 가족 · 엄마', body: '저녁 먹었니? 🍚', url: '/#/group/g/chat', tag: 'chat-g', badge: 2, kind: 'web' };
const fcmTarget = (token = TOKEN) => ({ endpoint: `fcm:${token}`, p256dh: null, auth: null, title: '우리 가족 · 엄마', body: '저녁 먹었니? 🍚', url: '/#/group/g/chat', tag: 'chat-g', badge: 3, kind: 'fcm' });

function fakeFetch(targets, { tokenStatus = 200 } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.startsWith(`${BASE}/rest/v1/rpc/push_targets`)) return new Response(JSON.stringify(targets), { status: 200 });
    if (u.startsWith(`${BASE}/rest/v1/rpc/push_forget`)) return new Response(null, { status: 204 });
    if (u === 'https://oauth2.googleapis.com/token') {
      if (tokenStatus !== 200) return new Response('{"error":"invalid_grant"}', { status: tokenStatus });
      return new Response(JSON.stringify({ access_token: 'ya29.test-access', expires_in: 3599, token_type: 'Bearer' }), { status: 200 });
    }
    if (u.startsWith('https://fcm.googleapis.com/v1/')) {
      const body = JSON.parse(init.body);
      if (body.message.token === GONE) return new Response(JSON.stringify({ error: { code: 404, status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }), { status: 404 });
      return new Response(JSON.stringify({ name: 'projects/dorantalk-test/messages/1' }), { status: 200 });
    }
    return new Response(null, { status: 201 }); // 웹 알림 서버
  };
  f.calls = calls;
  return f;
}
const post = (body) => new Request('https://fn.example/push', {
  method: 'POST', headers: { Authorization: `Bearer ${JWT}`, apikey: 'sb_publishable_test', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const msg = { kind: 'message', id: crypto.randomUUID() };
const sends = (f) => f.calls.filter((c) => c.url.startsWith('https://fcm.googleapis.com/v1/'));
const tokenCalls = (f) => f.calls.filter((c) => c.url === 'https://oauth2.googleapis.com/token');

// 1) 준비 상태
{
  const h = fn.createHandler({ fetch: fakeFetch([]), env: env() });
  const a = await (await h(new Request('https://fn.example/push'))).json();
  const h2 = fn.createHandler({ fetch: fakeFetch([]), env: env({ FCM_SERVICE_ACCOUNT: '' }) });
  const b = await (await h2(new Request('https://fn.example/push'))).json();
  const h3 = fn.createHandler({ fetch: fakeFetch([]), env: env({ PUSH_DB_KEY: '' }) });
  const c = await (await h3(new Request('https://fn.example/push'))).json();
  rec('FCM-01', '준비 상태에 "앱 알림 준비됨"이 서비스 계정과 전용 열쇠가 둘 다 있을 때만 켜져요',
    a.fcm === true && b.fcm === false && c.fcm === false && !JSON.stringify(a).includes('PRIVATE'), JSON.stringify({ a: a.fcm, b: b.fcm, c: c.fcm }));
}

// 2) 정상 발송: 구글 접근 토큰 → Firebase HTTP v1
{
  const f = fakeFetch([fcmTarget(), webTarget]);
  const h = fn.createHandler({ fetch: f, env: env() });
  const res = await h(post(msg));
  const out = await res.json();
  const s = sends(f);
  rec('FCM-02', 'Firebase 주소로 정확히 한 번, 서비스 계정의 프로젝트 주소로만 보내요',
    s.length === 1 && s[0].url === 'https://fcm.googleapis.com/v1/projects/dorantalk-test/messages:send' && out.sent === 2, `${s.length}번 · ${JSON.stringify(out)}`);
  const t = tokenCalls(f)[0];
  const assertion = t ? new URLSearchParams(t.init.body).get('assertion') : '';
  const [hh, cc, sig] = assertion.split('.');
  const valid = Boolean(sig) && crypto.verify('RSA-SHA256', Buffer.from(`${hh}.${cc}`), publicKey, Buffer.from(sig, 'base64url'));
  const claims = cc ? JSON.parse(Buffer.from(cc, 'base64url')) : {};
  rec('FCM-03', '구글에 보내는 증명(JWT)이 서비스 계정 열쇠로 올바르게 서명되고 내용(발급자 · 권한 · 받는 곳 · 1시간)이 맞아요',
    valid && JSON.parse(Buffer.from(hh, 'base64url')).alg === 'RS256' && claims.iss === SA.client_email
      && claims.scope === 'https://www.googleapis.com/auth/firebase.messaging' && claims.aud === 'https://oauth2.googleapis.com/token' && claims.exp - claims.iat === 3600,
    `서명 ${valid} · ${claims.scope}`);
  const body = s[0] ? JSON.parse(s[0].init.body) : {};
  const data = body.message?.data || {};
  rec('FCM-04', '보내는 내용: 받을 휴대폰 주소 · 알림 글자 · 열 화면이 맞고, 모든 값이 글자예요 (Firebase 규칙)',
    body.message?.token === TOKEN && data.title === '우리 가족 · 엄마' && data.url === '/#/group/g/chat' && data.badge === '3'
      && Object.values(data).every((v) => typeof v === 'string'), JSON.stringify(data).slice(0, 120));
  rec('FCM-05', '채팅 알림은 "높음" 우선순위 · 하루 동안 기다렸다 전달',
    body.message?.android?.priority === 'HIGH' && body.message?.android?.ttl === '86400s', JSON.stringify(body.message?.android));
  rec('FCM-06', 'Firebase 에는 구글 접근 토큰을 Bearer 로 붙여 보내요 (서비스 계정 열쇠 자체는 보내지 않음)',
    s[0]?.init.headers.Authorization === 'Bearer ya29.test-access' && !String(s[0]?.init.body).includes('PRIVATE KEY'), s[0]?.init.headers.Authorization);
  await h(post({ kind: 'message', id: crypto.randomUUID() }));
  rec('FCM-07', '구글 접근 토큰은 한 시간 동안 다시 써요 (알림마다 새로 받지 않음)', tokenCalls(f).length === 1, `토큰 요청 ${tokenCalls(f).length}번`);
  rec('FCM-08', '알림 서버의 답에는 개수만 있어요 (휴대폰 주소 · 열쇠 없음)', JSON.stringify(Object.keys(out).sort()) === '["failed","removed","sent"]', JSON.stringify(out));
}

// 3) 설정이 없거나 깨졌을 때
{
  const f = fakeFetch([fcmTarget(), webTarget]);
  const out = await (await fn.createHandler({ fetch: f, env: env({ FCM_SERVICE_ACCOUNT: '' }) })(post(msg))).json();
  rec('FCM-09', 'Firebase 열쇠가 없으면 앱 알림만 실패로 세고, 웹 알림은 그대로 가요',
    out.sent === 1 && out.failed === 1 && tokenCalls(f).length === 0 && sends(f).length === 0, JSON.stringify(out));
  const f2 = fakeFetch([fcmTarget()]);
  const r2 = await fn.createHandler({ fetch: f2, env: env({ FCM_SERVICE_ACCOUNT: '{"project_id": "x", "private_key": "nope"' }) })(post(msg));
  const t2 = await r2.text();
  rec('FCM-10', '깨진 서비스 계정 값이어도 서버가 멈추지 않고, 답에 비밀 값이 섞이지 않아요', r2.status === 200 && !t2.includes('nope') && JSON.parse(t2).failed === 1, t2);
  const f3 = fakeFetch([fcmTarget()], { tokenStatus: 500 });
  const r3 = await fn.createHandler({ fetch: f3, env: env() })(post(msg));
  const o3 = await r3.json();
  rec('FCM-11', '구글 토큰 서버가 실패해도 서버가 멈추지 않고 실패로만 세요', r3.status === 200 && o3.failed === 1 && sends(f3).length === 0, JSON.stringify(o3));
  const escaped = JSON.stringify({ ...SA, private_key: SA.private_key.replace(/\n/g, '\\n') });
  const f4 = fakeFetch([fcmTarget()]);
  const o4 = await (await fn.createHandler({ fetch: f4, env: env({ FCM_SERVICE_ACCOUNT: escaped }) })(post(msg))).json();
  rec('FCM-12', '서비스 계정 열쇠의 줄바꿈이 \\n 글자로 붙여 넣어져도 동작해요', o4.sent === 1, JSON.stringify(o4));
}

// 4) 사라진 휴대폰 정리 · 이상한 주소
{
  const f = fakeFetch([fcmTarget(GONE)]);
  const out = await (await fn.createHandler({ fetch: f, env: env() })(post(msg))).json();
  const forget = f.calls.find((c) => c.url.includes('/rpc/push_forget'));
  rec('FCM-13', '앱을 지운 휴대폰(Firebase 404 UNREGISTERED)은 보낸 사람 로그인 정보 + 전용 열쇠로 정리를 부탁해요',
    out.removed === 1 && forget && JSON.parse(forget.init.body).p_endpoints[0] === `fcm:${GONE}`
      && forget.init.headers.Authorization === `Bearer ${JWT}` && forget.init.headers['x-push-key'] === 'k-test', JSON.stringify(out));
  const bad = ['fcm:short', 'fcm:../../projects/evil/messages:send', 'fcm:tok en' + 'x'.repeat(30), 'https://evil.example/x'];
  const f2 = fakeFetch(bad.map((e) => ({ ...fcmTarget(), endpoint: e })));
  const o2 = await (await fn.createHandler({ fetch: f2, env: env() })(post(msg))).json();
  rec('FCM-14', '모양이 이상한 Firebase 주소(경로 조작 · 다른 사이트)로는 아무 데도 보내지 않아요',
    sends(f2).length === 0 && o2.failed === bad.length && !f2.calls.some((c) => c.url.includes('evil')), JSON.stringify(o2));
}

// 5) 기본 보안 (예전 시험과 같은 것 몇 가지)
{
  const f = fakeFetch([fcmTarget()]);
  const h = fn.createHandler({ fetch: f, env: env() });
  const r1 = await h(new Request('https://fn.example/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"kind":"test"}' }));
  rec('FCM-15', '로그인 정보 없이는 401, 구글 · Firebase 에도 요청하지 않아요', r1.status === 401 && f.calls.length === 0, r1.status);
  const r2 = await h(post({ kind: 'message', id: "1' or '1'='1" }));
  rec('FCM-16', '알림 대상 번호가 UUID 가 아니면 400', r2.status === 400 && f.calls.length === 0, r2.status);
  const f3 = fakeFetch(['https://169.254.169.254/latest', 'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com.evil.example/x'].map((e) => ({ ...webTarget, endpoint: e })));
  await fn.createHandler({ fetch: f3, env: env() })(post(msg));
  rec('FCM-17', '웹 알림 주소도 휴대폰 회사 알림 서버로만 보내요 (내부 주소 · 닮은 가짜 주소 막기)',
    !f3.calls.some((c) => !c.url.startsWith(BASE)), f3.calls.map((c) => c.url).join(' ').slice(0, 120));
}

for (const x of results) console.log(`RESULT|${x.id}|${CAT}|${x.ok ? 'PASS' : 'FAIL'}|${x.title}|${x.detail}`);
const failed = results.filter((x) => !x.ok);
console.log(`SUMMARY|${results.length}|${results.length - failed.length}|${failed.length}`);
process.exit(failed.length ? 1 : 0);
