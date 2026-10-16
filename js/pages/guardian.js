// 만 14세 미만 자녀 계정 (보호자용)
//  #/me/children          자녀 계정 목록 · 아직 안 쓴 가입 링크 · 동의 철회(자녀 계정 삭제)
//  #/me/children/consent  보호자 동의 → 비밀번호 다시 확인 → 자녀 가입 링크 만들기
// 실제 규칙(비밀번호 확인 10분 안, 링크 7일 · 한 번, 보호자만 삭제)은 DB 함수가 지켜요.
import { sb } from '../supabase.js';
import { state } from '../state.js';
import { go } from '../router.js';
import { friendlyError } from '../errors.js';
import {
  el, render, appBar, backButton, field, passwordInput, messageBox, setBusy, toast, icon, iconTile,
  avatar, confirmDialog, skeletonRows, errorCard,
} from '../ui.js';
import { BUCKET } from '../images.js';
import { TERMS_VERSION, CONTACT_EMAIL } from '../legal.js';

const childLink = (token) => `${location.origin}/#/signup/child/${token}`;
const day = (iso) => new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });

async function sendLink(token) {
  const url = childLink(token);
  const text = `${state.profile?.nickname || '보호자'}님이 도란톡 가입을 허락했어요 😊\n아래 링크를 눌러 가입해 주세요. (7일 안에 한 번만 쓸 수 있어요)`;
  if (navigator.share) {
    try {
      await navigator.share({ title: '도란톡 자녀 가입 링크', text, url });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast('가입 링크를 복사했어요. 카카오톡 등에 붙여넣어 자녀에게 보내 주세요.', 4500);
  } catch {
    toast(`이 주소를 자녀에게 보내 주세요: ${url}`, 8000);
  }
}

// ------------------------------------------------------------------
// 자녀 계정 목록
// ------------------------------------------------------------------
export async function renderChildren() {
  const list = el('div', {}, skeletonRows(2));
  render(
    appBar('자녀 계정', { left: backButton(() => go('/me')) }),
    el('main', { class: 'page' },
      el('section', { class: 'card stack' },
        el('h1', {}, '만 14세 미만 자녀 가입'),
        el('p', { class: 'muted' }, '만 14세 미만 자녀는 보호자(부모 등 법정대리인)가 먼저 동의해야 가입할 수 있어요. 동의하면 자녀에게 보낼 가입 링크가 만들어져요.'),
        el('ol', { class: 'steps' },
          el('li', {}, '아래 버튼으로 동의하고 가입 링크 만들기'),
          el('li', {}, '링크를 자녀에게 보내기 (카카오톡 등)'),
          el('li', {}, '자녀가 링크를 열어 가입 (이미 가입한 자녀는 자기 계정에 연결)'),
          el('li', {}, '그룹의 멤버 탭에서 자녀의 아이디로 초대'),
        ),
        el('a', { href: '#/me/children/consent', class: 'btn btn-block' }, icon('shield', { size: 22 }), '동의하고 가입 링크 만들기'),
      ),
      list,
      el('p', { class: 'muted small center' },
        '자녀 계정은 보호자가 들어 있는 그룹에만 초대받을 수 있어요(보호자가 있으면 누가 초대해도 자녀가 수락할 수 있어요). 자녀가 그룹을 만들려면 보호자 승인이 필요하고, 승인하면 보호자도 그 그룹의 멤버가 돼요.'),
    ),
  );

  const [kids, links, reqs] = await Promise.all([
    sb.rpc('my_children'), sb.rpc('my_guardian_links'),
    sb.rpc('children_group_requests').then((r) => (r.error ? { data: [] } : r)), // 예전 DB면 건너뜀
  ]);
  const error = kids.error || links.error;
  if (error) {
    list.replaceChildren(errorCard(friendlyError(error), renderChildren));
    return;
  }

  const kidRows = (kids.data || []).map((k) => el('div', { class: 'child-row' },
    avatar(k.nickname),
    el('div', { class: 'child-info' },
      el('p', { class: 'child-name' }, k.nickname),
      el('p', { class: 'muted small' }, k.handle ? `아이디 ${k.handle} · ` : '', `${day(k.joined_at)} 가입`, k.email_confirmed ? '' : ' · 이메일 확인 전'),
    ),
    el('button', {
      class: 'btn btn-ghost btn-small btn-danger-text', type: 'button',
      onclick: (e) => deleteChild(k, e.currentTarget),
    }, '계정 삭제'),
  ));
  const linkRows = (links.data || []).map((l) => el('div', { class: 'child-row' },
    iconTile('share'),
    el('div', { class: 'child-info' },
      el('p', { class: 'child-name' }, '자녀 가입 링크'),
      el('p', { class: 'muted small' }, `${day(l.expires_at)}까지 · 한 번만 쓸 수 있어요`),
    ),
    el('div', { class: 'child-actions' },
      el('button', { class: 'btn btn-tonal btn-small', type: 'button', onclick: () => sendLink(l.token) }, '보내기'),
      el('button', {
        class: 'btn btn-ghost btn-small', type: 'button',
        onclick: async (e) => {
          const b = e.currentTarget;
          if (!(await confirmDialog({ title: '이 링크를 취소할까요?', message: '취소하면 이 링크로는 가입할 수 없어요.', confirmText: '링크 취소' }))) return;
          setBusy(b, true, '');
          const { error: err } = await sb.rpc('cancel_guardian_link', { p_id: l.id });
          if (err) { setBusy(b, false); return toast(friendlyError(err)); }
          toast('링크를 취소했어요.');
          renderChildren();
        },
      }, '취소'),
    ),
  ));

  // 자녀의 그룹 만들기 요청: 승인하면 그룹이 생기고(자녀가 방장) 보호자도 멤버가 돼요
  const reqRows = (reqs.data || []).map((r) => {
    const approve = el('button', { class: 'btn btn-small', type: 'button' }, '승인');
    const decline = el('button', { class: 'btn btn-ghost btn-small', type: 'button' }, '거절');
    const decide = async (yes, button) => {
      const ok = await confirmDialog(yes
        ? { title: `'${r.name}' 그룹을 만들까요?`, message: `${r.child_nickname}님이 방장이 되고, 보호자님도 이 그룹의 멤버가 돼요.`, confirmText: '승인' }
        : { title: '요청을 거절할까요?', message: `${r.child_nickname}님에게 거절했다고 보여요.`, confirmText: '거절' });
      if (!ok) return;
      setBusy(button, true, '');
      const { error: err } = await sb.rpc('decide_group_request', { p_id: r.id, p_approve: yes });
      if (err) { setBusy(button, false); return toast(friendlyError(err), 4500); }
      toast(yes ? `'${r.name}' 그룹을 만들었어요. 홈에서 볼 수 있어요.` : '요청을 거절했어요.', 3500);
      renderChildren();
    };
    approve.addEventListener('click', () => decide(true, approve));
    decline.addEventListener('click', () => decide(false, decline));
    return el('div', { class: 'child-row' },
      iconTile('family'),
      el('div', { class: 'child-info' },
        el('p', { class: 'child-name' }, r.name),
        el('p', { class: 'muted small' }, `${r.child_nickname}(${r.child_handle})님의 요청 · ${day(r.created_at)}`),
      ),
      el('div', { class: 'child-actions' }, approve, decline),
    );
  });

  list.replaceChildren(...[
    reqRows.length && el('h2', { class: 'section-title' }, '그룹 만들기 요청 ', el('span', { class: 'count' }, String(reqRows.length))),
    reqRows.length && el('section', { class: 'card list-card' }, ...reqRows),
    el('h2', { class: 'section-title' }, '내 자녀 계정 ', el('span', { class: 'count' }, String(kidRows.length))),
    el('section', { class: 'card list-card' },
      ...(kidRows.length ? kidRows : [el('p', { class: 'muted child-empty' }, '아직 가입한 자녀가 없어요.')])),
    linkRows.length && el('h2', { class: 'section-title' }, '아직 쓰지 않은 가입 링크'),
    linkRows.length && el('section', { class: 'card list-card' }, ...linkRows),
  ].filter(Boolean));
}

// 동의 철회 = 자녀 계정 삭제: ① 자녀가 올린 사진 파일 → ② 계정(글·댓글·하트·채팅이 함께 삭제)
async function deleteChild(kid, button) {
  const ok = await confirmDialog({
    title: `${kid.nickname} 계정을 지울까요?`,
    message: '보호자 동의를 철회하면 자녀의 계정과 글·사진·채팅이 모두 지워지고 되돌릴 수 없어요.',
    confirmText: '계정 지우기', danger: true,
  });
  if (!ok) return;
  setBusy(button, true, '지우는 중…');
  try {
    const { data, error } = await sb.rpc('child_photo_paths', { p_child: kid.child_id });
    if (error) throw error;
    const paths = data || [];
    for (let i = 0; i < paths.length; i += 100) {
      const { error: removeError } = await sb.storage.from(BUCKET).remove(paths.slice(i, i + 100));
      if (removeError) throw removeError;
    }
    const { error: delError } = await sb.rpc('delete_child_account', { p_child: kid.child_id });
    if (delError) throw delError;
  } catch (err) {
    setBusy(button, false);
    toast(`${friendlyError(err)} 문제가 계속되면 ${CONTACT_EMAIL} 으로 알려 주세요.`, 6000);
    return;
  }
  toast(`${kid.nickname} 계정을 지웠어요.`);
  renderChildren();
}

// ------------------------------------------------------------------
// 보호자 동의 → 자녀 가입 링크 만들기
// ------------------------------------------------------------------
export function renderGuardianConsent() {
  const items = [
    { key: 'guardian', label: '[필수] 저는 가입할 자녀의 부모 등 법정대리인이에요' },
    { key: 'terms', label: '[필수] 자녀의 도란톡 이용약관에 동의해요', link: '#/terms' },
    {
      key: 'privacy', label: '[필수] 자녀의 개인정보 수집·이용에 동의해요', link: '#/privacy',
      summary: [
        '수집 항목: 자녀의 이메일, 비밀번호, 아이디, 닉네임 (가입할 때 자녀가 입력)',
        '쓰는 목적: 회원 확인, 그룹 소식·채팅 서비스 제공, 초대 알림, 비밀번호 찾기',
        '보유 기간: 자녀가 탈퇴하거나 보호자가 자녀 계정을 지울 때까지',
        '자녀 보호: 보호자가 들어 있는 그룹에만 초대받을 수 있고, 그룹은 보호자가 승인해야 만들 수 있어요',
        '동의하지 않을 수 있지만, 그러면 자녀가 가입할 수 없어요. 동의는 언제든 철회할 수 있어요(자녀 계정 삭제).',
      ],
    },
  ];
  const boxes = {};
  const all = el('input', { type: 'checkbox', class: 'check-input', id: 'gc-all' });
  const rows = items.map((it) => {
    const box = el('input', { type: 'checkbox', class: 'check-input', id: `gc-${it.key}` });
    boxes[it.key] = box;
    box.addEventListener('change', () => { all.checked = Object.values(boxes).every((x) => x.checked); });
    return el('div', { class: 'consent-row' },
      el('label', { class: 'consent-label', for: box.id }, box, el('span', {}, it.label)),
      it.link && el('a', { href: it.link, target: '_blank', rel: 'noopener', class: 'consent-view' }, '보기'),
      it.summary && el('ul', { class: 'consent-summary' }, ...it.summary.map((t) => el('li', {}, t))),
    );
  });
  all.addEventListener('change', () => { Object.values(boxes).forEach((x) => { x.checked = all.checked; }); });

  const pw = passwordInput({ autocomplete: 'current-password', placeholder: '내 비밀번호' });
  const msg = messageBox();
  const submit = el('button', { class: 'btn btn-block', type: 'submit' }, '동의하고 가입 링크 만들기');

  const form = el('form', {
    class: 'card', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      msg.clear();
      if (!Object.values(boxes).every((x) => x.checked)) return msg.show('필수 항목에 모두 동의해 주세요.');
      if (!pw.input.value) return msg.show('보호자 확인을 위해 내 비밀번호를 입력해 주세요.');
      setBusy(submit, true, '확인하는 중…');
      try {
        // 보호자 본인 확인: 비밀번호로 다시 로그인 (DB는 10분 안에 비밀번호로 로그인했는지 확인해요)
        const email = state.session?.user?.email;
        const { error: authError } = await sb.auth.signInWithPassword({ email, password: pw.input.value });
        if (authError) {
          throw (/invalid login credentials/i.test(authError.message || '') || authError.code === 'invalid_credentials')
            ? new Error('비밀번호가 맞지 않아요. 다시 확인해 주세요.') : authError;
        }
        const { data, error } = await sb.rpc('create_guardian_link', { p_terms_version: TERMS_VERSION });
        if (error) throw error;
        renderLinkReady(data?.[0]);
      } catch (err) {
        setBusy(submit, false);
        msg.show(friendlyError(err));
      }
    },
  },
    el('h1', {}, '보호자 동의'),
    el('p', { class: 'muted' }, '가입할 자녀를 위해 아래 내용을 읽고 동의해 주세요. 동의 기록(보호자 계정, 동의 시각)은 자녀 계정이 있는 동안 보관돼요.'),
    el('div', { class: 'consent' },
      el('label', { class: 'consent-label consent-all', for: all.id }, all, el('span', {}, '모두 동의해요')),
      ...rows,
    ),
    field('보호자 확인: 내 비밀번호', pw, '자녀가 보호자의 휴대폰으로 대신 동의하지 못하도록, 비밀번호를 한 번 더 확인해요.'),
    msg,
    submit,
  );

  render(
    appBar('보호자 동의', { left: backButton(() => go('/me/children')) }),
    el('main', { class: 'page' }, form),
  );
}

function renderLinkReady(link) {
  if (!link?.token) return renderChildren();
  const url = childLink(link.token);
  const input = el('input', { class: 'input link-input', type: 'text', readonly: true, value: url, 'aria-label': '자녀 가입 링크' });
  input.addEventListener('focus', () => input.select());
  render(
    appBar('보호자 동의', { left: backButton(() => go('/me/children')) }),
    el('main', { class: 'page' },
      el('section', { class: 'card center stack' },
        el('div', { class: 'empty-icon', 'aria-hidden': 'true' }, icon('check', { size: 34 })),
        el('h1', {}, '가입 링크가 만들어졌어요'),
        el('p', {}, '이 링크를 자녀에게 보내 주세요. ', el('strong', {}, `${day(link.expires_at)}까지, 한 번만`), ' 쓸 수 있어요.'),
        input,
        el('button', { class: 'btn btn-block', type: 'button', onclick: () => sendLink(link.token) }, icon('share', { size: 22 }), '자녀에게 보내기'),
        el('button', {
          class: 'btn btn-secondary btn-block', type: 'button',
          onclick: async () => {
            try { await navigator.clipboard.writeText(url); toast('링크를 복사했어요.'); } catch { input.focus(); }
          },
        }, icon('copy', { size: 22 }), '링크 복사'),
        el('p', { class: 'muted small' }, '자녀의 휴대폰에서 열어 주세요. 이 휴대폰에서 열면 보호자님은 로그아웃돼요.'),
        el('p', { class: 'muted small' }, '자녀가 이미 도란톡 계정이 있다면, 자녀의 휴대폰(자녀 계정으로 로그인된 상태)에서 링크를 열고 "이 계정에 보호자 동의 연결하기"를 누르면 돼요.'),
        el('p', { class: 'muted small' }, '자녀가 가입하면, 그룹의 멤버 탭에서 자녀의 아이디로 초대해 주세요. (자녀 계정 화면에서 아이디를 볼 수 있어요)'),
        el('a', { href: '#/me/children', class: 'btn btn-ghost btn-block' }, '자녀 계정으로 돌아가기'),
      ),
    ),
  );
}
