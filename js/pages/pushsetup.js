// 알림 열쇠 만들기 (관리자용, #/push-setup)
// - 알림 서버(Supabase Edge Function "push")에 넣을 열쇠 한 쌍(VAPID)을 이 기기 안에서 만들어요.
// - 만든 열쇠는 어디에도 저장하거나 보내지 않아요. 화면을 닫으면 사라져요.
// - 공개 열쇠는 알려져도 괜찮지만, 비밀 열쇠는 Supabase Secrets 에만 붙여 넣어 주세요.
import { createGuestClient } from '../supabase.js';
import { isLoggedIn } from '../state.js';
import { go } from '../router.js';
import { el, render, appBar, backButton, iconTile, icon, toast, setBusy } from '../ui.js';

function b64u(buf) {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function makeVapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = b64u(await crypto.subtle.exportKey('raw', pair.publicKey));
  const { d } = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { publicKey, privateKey: d };
}

function keyField(name, value, note) {
  const box = el('textarea', { class: 'input textarea key-value', rows: 3, readonly: true, spellcheck: 'false', 'aria-label': name });
  box.value = value;
  const copy = el('button', {
    class: 'btn btn-secondary btn-small', type: 'button',
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(value);
        toast(`${name} 를 복사했어요.`);
      } catch {
        box.select();
        toast('글자를 길게 눌러 복사해 주세요.');
      }
    },
  }, icon('copy', { size: 20 }), '복사');
  return el('div', { class: 'field' },
    el('div', { class: 'key-head' }, el('span', { class: 'label', style: 'margin:0' }, name), copy),
    box,
    note && el('p', { class: 'hint' }, note));
}

// 알림 서버 상태 확인 (로그인 없이)
async function checkServer() {
  const guest = createGuestClient();
  const { data, error } = await guest.functions.invoke('push', { method: 'GET' });
  if (error) {
    const status = error.context?.status;
    if (status === 404) return { ok: false, text: '알림 서버(push)를 아직 찾을 수 없어요. 안내서 B 단계(Edge Function 만들기)를 해 주세요.' };
    if (status === 401) return { ok: false, text: '알림 서버의 "Verify JWT" 설정을 꺼 주세요. (안내서 B-4)' };
    return { ok: false, text: '알림 서버를 찾지 못했어요. 안내서 B 단계(Edge Function 만들기 · Deploy)를 마쳤는지, 이름이 push 인지 확인해 주세요.' };
  }
  if (data?.ready) return { ok: true, text: '알림 서버가 준비됐어요! 이제 내 정보 → 알림에서 "알림 켜기"를 눌러 보세요.' };
  if (data?.error) return { ok: false, text: data.error };
  return { ok: false, text: '알림 서버는 있지만 열쇠(VAPID)가 아직 없어요. 위에서 만든 열쇠를 Secrets 에 넣어 주세요.' };
}

export function renderPushSetup() {
  const keysBox = el('div', {});
  const make = el('button', { class: 'btn btn-block', type: 'button' }, '열쇠 만들기');
  make.addEventListener('click', async () => {
    setBusy(make, true, '만드는 중…');
    try {
      const { publicKey, privateKey } = await makeVapidKeys();
      keysBox.replaceChildren(
        keyField('VAPID_PUBLIC_KEY', publicKey, '공개 열쇠 — 알려져도 괜찮아요.'),
        keyField('VAPID_PRIVATE_KEY', privateKey, '비밀 열쇠 — Supabase Secrets 에만 붙여 넣고, 다른 곳(카톡 · 메모 · 코드)에는 두지 마세요.'),
        keyField('VAPID_SUBJECT', 'mailto:admin@dorantalk.com', '연락처 (그대로 쓰면 돼요)'),
        el('p', { class: 'form-msg info' }, '세 개를 모두 넣고 "Save" 를 누른 뒤, 아래 "알림 서버 확인"을 눌러 보세요.'),
      );
      make.textContent = '다시 만들기';
    } catch (err) {
      toast(`열쇠를 만들지 못했어요: ${err.message}`, 5000);
    } finally {
      setBusy(make, false);
    }
  });

  const result = el('p', { class: 'form-msg info', hidden: true });
  const check = el('button', { class: 'btn btn-secondary btn-block', type: 'button' }, '알림 서버 확인');
  check.addEventListener('click', async () => {
    setBusy(check, true, '확인하는 중…');
    const r = await checkServer().catch((err) => ({ ok: false, text: err.message }));
    setBusy(check, false);
    result.hidden = false;
    result.className = `form-msg ${r.ok ? 'success' : 'error'}`;
    result.textContent = r.text;
  });

  render(
    appBar('알림 열쇠 만들기', { left: backButton(() => go(isLoggedIn() ? '/me' : '/login')) }),
    el('main', { class: 'page' },
      el('section', { class: 'card' },
        el('div', { class: 'card-head' }, iconTile('key'),
          el('div', {}, el('h2', {}, '알림 열쇠 (관리자용)'), el('p', { class: 'muted' }, '처음 한 번만 하면 돼요'))),
        el('p', {}, '알림 서버가 "도란톡이 보낸 알림"임을 증명할 때 쓰는 열쇠 한 쌍을 만들어요.'),
        el('ul', { class: 'bullets' },
          el('li', {}, '열쇠는 ', el('strong', {}, '이 기기 안에서만'), ' 만들어지고, 어디에도 저장 · 전송되지 않아요.'),
          el('li', {}, 'Supabase → Edge Functions → ', el('strong', {}, 'Secrets'), ' 에 이름과 값을 그대로 붙여 넣어 주세요.'),
          el('li', {}, '열쇠를 다시 만들어 바꾸면, 회원들이 알림을 한 번씩 다시 켜야 해요.'),
        ),
        make,
        keysBox,
      ),
      el('section', { class: 'card' },
        el('h2', {}, '알림 서버 확인'),
        result,
        check,
      ),
    ),
  );
}
