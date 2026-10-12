// 연결 점검 화면 (#/check)
// Supabase 연결과 보안 규칙이 제대로 되어 있는지 확인합니다. 문제가 생겼을 때 진단용.
import { sb, checkConfig } from '../supabase.js';
import { el, render, brandHeader } from '../ui.js';

const CHECKS = [
  { id: 'config', title: '설정 파일', run: checkConfigStep },
  { id: 'server', title: '서버 연결 + 데이터베이스 설치', run: checkServerStep },
  { id: 'security', title: '보안 규칙(RLS)', run: checkSecurityStep },
];

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
  // 로그인하지 않은 상태로 가족 글을 읽어 봅니다. "거절"당해야 정상입니다.
  const { data, error } = await sb.from('posts').select('id').limit(1);
  if (error && (error.code === '42501' || /permission denied/i.test(error.message))) {
    return { status: 'ok', detail: '로그인하지 않은 사람은 가족 글을 볼 수 없어요. (정상)' };
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
  const retry = el('button', { class: 'btn btn-secondary btn-block', onclick: renderCheck }, '다시 확인하기');

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
  ));

  for (let i = 0; i < CHECKS.length; i++) {
    try {
      states[i] = await CHECKS[i].run();
    } catch (e) {
      states[i] = { status: 'fail', detail: explainError(e) };
    }
    paint();
    if (states[i].status !== 'ok') {
      for (let j = i + 1; j < CHECKS.length; j++) {
        states[j] = { status: 'wait', detail: '앞 단계가 해결되면 확인할게요.' };
      }
      paint();
      break;
    }
  }

  const allOk = states.every((s) => s.status === 'ok');
  banner.className = `banner ${allOk ? 'ok' : 'fail'}`;
  banner.textContent = allOk
    ? '🎉 모두 정상이에요!'
    : '아래에서 빨간 ! 표시된 항목을 확인해 주세요.';
}

