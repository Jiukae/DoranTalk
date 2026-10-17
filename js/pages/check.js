// 연결 점검 화면 (#/check)
// Supabase 연결과 보안 규칙이 제대로 되어 있는지 확인합니다. 문제가 생겼을 때 진단용.
import { sb, checkConfig, createGuestClient } from '../supabase.js';
import { el, render, brandHeader } from '../ui.js';
import { APP_VERSION } from '../version.js';

// 앱이 기대하는 schema.sql 버전. SQL 파일 맨 위 "버전 N" 과 같아야 해요.
export const REQUIRED_SCHEMA_VERSION = 10;

const CHECKS = [
  { id: 'config', title: '설정 파일', run: checkConfigStep },
  { id: 'server', title: '서버 연결 + 데이터베이스 설치', run: checkServerStep },
  { id: 'version', title: '데이터베이스 최신 버전', run: checkVersionStep },
  { id: 'security', title: '보안 규칙(RLS)', run: checkSecurityStep },
  { id: 'realtime', title: '실시간 연결 (채팅)', run: checkRealtimeStep },
  { id: 'push', title: '휴대폰 알림 서버 (선택)', run: checkPushStep, optional: true },
  { id: 'mail', title: '초대 · 승인 요청 메일 (선택)', run: checkMailStep, optional: true },
];

// 초대 메일을 보낼 준비가 됐는지 (pg_net + Vault 의 Resend 열쇠) — 없어도 앱은 잘 돼요 (메일만 안 감)
async function checkMailStep() {
  const guest = createGuestClient();
  const { data, error } = await guest.rpc('mail_ready');
  if (error) return { status: 'warn', detail: '데이터베이스를 버전 9로 업데이트하면 확인할 수 있어요.' };
  if (data === true) return { status: 'ok', detail: '초대받은 사람과 보호자에게 이메일로 알려 드려요.' };
  return { status: 'warn', detail: '아직 설정 전이에요. 메일로도 알리려면 안내서 12단계를 따라 주세요. (앱 안 초대는 그대로 돼요)' };
}

// 알림 서버(Edge Function "push")가 준비됐는지 — 없어도 앱은 잘 돼요 (알림만 안 감)
async function checkPushStep() {
  const guest = createGuestClient();
  const { data, error } = await guest.functions.invoke('push', { method: 'GET' });
  if (error) {
    const status = error.context?.status;
    if (status === 404) return { status: 'warn', detail: '아직 설정 전이에요. 알림을 쓰려면 안내서 9단계를 따라 주세요.' };
    if (status === 401) return { status: 'warn', detail: '알림 서버의 "Verify JWT" 설정을 꺼 주세요. (안내서 9단계)' };
    return { status: 'warn', detail: '아직 설정 전이거나 알림 서버에 연결하지 못했어요. 알림을 쓰려면 안내서 9단계를 따라 주세요.' };
  }
  if (data?.ready) return { status: 'ok', detail: '알림 서버가 준비됐어요. 내 정보 → 알림에서 켤 수 있어요.' };
  return { status: 'warn', detail: data?.error || '알림 열쇠(VAPID)를 Secrets 에 넣어 주세요. (앱 주소 뒤에 #/push-setup)' };
}

// 실시간 서버에 연결되는지 (채팅이 새로고침 없이 오려면 필요)
async function checkRealtimeStep() {
  const guest = createGuestClient();
  const status = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve('TIMED_OUT'), 10000);
    const channel = guest.channel(`check-${Date.now()}`).subscribe((s) => {
      if (s === 'SUBSCRIBED' || s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
        clearTimeout(timer);
        guest.removeChannel(channel);
        resolve(s);
      }
    });
  });
  if (status === 'SUBSCRIBED') return { status: 'ok', detail: '새 메시지를 새로고침 없이 바로 받을 수 있어요.' };
  return {
    status: 'fail',
    detail: '실시간 서버에 연결하지 못했어요. 와이파이/데이터 연결을 확인하고 다시 확인해 주세요. (회사·학교 와이파이는 막혀 있을 수 있어요)',
  };
}

async function checkVersionStep() {
  const { data, error } = await sb.rpc('talkfeed_schema_version');
  const outdated = (found) => ({
    status: 'fail',
    detail: found === REQUIRED_SCHEMA_VERSION - 1
      ? `데이터베이스가 예전 버전(${found})이에요. supabase/updates/v${found}_to_v${REQUIRED_SCHEMA_VERSION}.sql 을 SQL Editor에서 실행해 주세요.`
      : `데이터베이스가 예전 버전${found ? `(${found})` : ''}이에요. 최신 schema.sql(버전 ${REQUIRED_SCHEMA_VERSION})을 SQL Editor에서 다시 실행해 주세요.`,
  });
  if (error && error.code === 'PGRST202') return outdated(null);
  if (error) return { status: 'fail', detail: explainError(error) };
  if (data < REQUIRED_SCHEMA_VERSION) return outdated(data);
  return { status: 'ok', detail: `최신 버전(${data})이에요.` };
}

async function checkConfigStep() {
  const result = checkConfig();
  if (!result.ok) return { status: 'fail', detail: result.message };
  return { status: 'ok', detail: '주소와 공개 키가 잘 들어가 있어요.' };
}

async function checkServerStep() {
  const { data, error } = await sb.rpc('is_nickname_available', { nick: '연결확인' });
  if (error) return { status: 'fail', detail: explainError(error) };
  if (typeof data !== 'boolean') return { status: 'fail', detail: '서버 응답이 예상과 달라요.' };
  return { status: 'ok', detail: 'Supabase 서버와 연결됐고, 테이블과 기능이 설치되어 있어요.' };
}

async function checkSecurityStep() {
  // 로그인하지 않은 사람인 척 가족 글을 읽어 봅니다. "거절"당해야 정상입니다.
  // (지금 로그인되어 있어도 영향을 받지 않도록 로그인 정보가 없는 별도 연결을 씁니다)
  const guest = createGuestClient();
  const { data, error } = await guest.from('posts').select('id').limit(1);
  if (error && (error.code === '42501' || /permission denied/i.test(error.message))) {
    return { status: 'ok', detail: '로그인하지 않은 사람은 그룹 글을 볼 수 없어요. (정상)' };
  }
  if (error) return { status: 'fail', detail: explainError(error) };
  return {
    status: 'fail',
    detail: `로그인 없이 글 목록이 열렸어요(${data.length}건). schema.sql을 다시 실행해 주세요.`,
  };
}

function explainError(error) {
  const msg = `${error.message || ''} ${error.details || ''}`;
  if (error.code === 'PGRST202' || error.code === 'PGRST205' || error.code === '42P01') {
    return '데이터베이스 설정(schema.sql)이 아직 실행되지 않았어요. 안내서의 "SQL 실행하기"를 해 주세요.';
  }
  if (/invalid api key|no api key|jwt/i.test(msg)) {
    return '공개 키가 틀린 것 같아요. 키를 처음부터 끝까지 다시 복사해 주세요.';
  }
  if (/failed to fetch|network|load failed/i.test(msg)) {
    return '서버에 연결할 수 없어요. 주소가 맞는지, 인터넷이 되는지, Supabase 프로젝트가 일시정지(Paused)되지 않았는지 확인해 주세요.';
  }
  return `알 수 없는 오류: ${error.message || error.code || '응답 없음'}`;
}

const ICON = { wait: '…', ok: '✓', fail: '!', warn: '?' };

function checkRow(check, state) {
  return el('li', { class: `check ${state.status}` },
    el('div', { class: 'check-icon', 'aria-hidden': 'true' }, ICON[state.status]),
    el('div', {},
      el('p', { class: 'check-title' }, check.title),
      el('p', { class: 'check-detail' }, state.detail),
    ),
  );
}

export async function renderCheck() {
  const states = CHECKS.map(() => ({ status: 'wait', detail: '확인하는 중…' }));
  const banner = el('div', { class: 'banner wait', role: 'status' }, '연결 상태를 확인하고 있어요…');
  const list = el('ul', { class: 'checklist' });
  // 페이지를 새로 받아서 다시 점검 (예전에 열어 둔 창이어도 항상 최신 앱으로 확인)
  const retry = el('button', { class: 'btn btn-secondary btn-block', onclick: () => location.reload() }, '다시 확인하기');

  const paint = () => list.replaceChildren(...CHECKS.map((c, i) => checkRow(c, states[i])));
  paint();

  render(el('main', { class: 'page' },
    brandHeader('연결 점검'),
    banner,
    el('section', { class: 'card' },
      el('h2', {}, 'Supabase 연결 확인'),
      list,
    ),
    retry,
    el('a', { href: '#/home', class: 'btn btn-ghost btn-block', style: 'margin-top:8px' }, '‹ 앱으로 돌아가기'),
    el('p', { class: 'muted small center', style: 'margin-top:12px' }, `앱 버전: ${APP_VERSION}`),
  ));

  for (let i = 0; i < CHECKS.length; i++) {
    try {
      states[i] = await CHECKS[i].run();
    } catch (e) {
      states[i] = { status: 'fail', detail: explainError(e) };
    }
    paint();
    if (states[i].status !== 'ok' && !CHECKS[i].optional) {
      for (let j = i + 1; j < CHECKS.length; j++) {
        states[j] = { status: 'wait', detail: '앞 단계가 해결되면 확인할게요.' };
      }
      paint();
      break;
    }
  }

  const allOk = states.every((s, i) => s.status === 'ok' || (CHECKS[i].optional && s.status === 'warn'));
  banner.className = `banner ${allOk ? 'ok' : 'fail'}`;
  banner.textContent = allOk
    ? '🎉 모두 정상이에요!'
    : '아래에서 빨간 ! 표시된 항목을 확인해 주세요.';
}

