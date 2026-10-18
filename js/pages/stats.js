// 운영자 화면: 광고 · 가입 성과 (#/stats)
// 숫자만 보여요. 이름 · 이메일 · 글 · 사진 · 채팅 내용은 데이터베이스가 돌려주지 않아요. (DB 버전 12의 admin_stats)
import { sb } from '../supabase.js';
import { go, navToken, isStale } from '../router.js';
import { friendlyError } from '../errors.js';
import { el, render, appBar, backButton, iconTile, errorCard, skeletonRows } from '../ui.js';

// 홍보 주소 끝의 ?from= 값 → 알아보기 쉬운 이름 (marketing/promo-texts.md 의 채널별 주소)
const SOURCE_LABELS = {
  insta: '인스타그램',
  insta_ad: '인스타 · 페이스북 광고',
  youtube: '유튜브',
  google_ad: '구글 · 유튜브 광고',
  blog: '네이버 블로그',
  naver_ad: '네이버 검색 광고',
  cafe: '카페 · 커뮤니티',
  daangn: '당근',
  family: '가족이 보낸 링크',
  app: '안드로이드 앱',
  playstore: 'Play 스토어',
};

export function sourceLabel(code) {
  if (!code) return '직접 · 기타';
  return SOURCE_LABELS[code] || code;
}

const num = (n) => Number(n || 0).toLocaleString('ko-KR');
const dayName = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'UTC' });
const dayLabel = (day) => dayName.format(new Date(`${day}T00:00:00Z`));

function tile(label, value, sub) {
  return el('div', { class: 'stat-tile' },
    el('p', { class: 'stat-label' }, label),
    el('p', { class: 'stat-value' }, value),
    sub && el('p', { class: 'stat-sub' }, sub),
  );
}

function sourcesCard(sources) {
  return el('section', { class: 'card' },
    el('div', { class: 'card-head' },
      iconTile('activity'),
      el('div', {}, el('h2', {}, '가입 경로별'), el('p', { class: 'muted' }, '홍보 주소의 ?from= 으로 구분해요')),
    ),
    sources.length
      ? el('ul', { class: 'stat-list' }, ...sources.map((s) => el('li', { class: 'stat-row' },
        el('div', { class: 'stat-row-text' },
          el('p', { class: 'stat-row-name' }, sourceLabel(s.source), s.source && el('span', { class: 'stat-code' }, s.source)),
          el('p', { class: 'stat-row-sub' }, `오늘 ${num(s.today)} · 7일 ${num(s.last7)} · 가족과 연결 ${num(s.with_family)}`),
        ),
        el('p', { class: 'stat-row-num' }, `${num(s.total)}명`),
      )))
      : el('p', { class: 'muted' }, '아직 가입한 사람이 없어요.'),
    el('p', { class: 'muted small stat-note' },
      '가족과 연결 = 가입한 뒤 다른 사람이 있는 그룹에 들어간 사람이에요. 광고로 온 사람이 실제로 가족과 쓰는지 볼 수 있어요.'),
  );
}

function dailyCard(daily) {
  return el('section', { class: 'card' },
    el('div', { class: 'card-head' },
      iconTile('user', 'tone-green'),
      el('div', {}, el('h2', {}, '날짜별 가입'), el('p', { class: 'muted' }, '최근 14일 · 한국 시간')),
    ),
    el('ul', { class: 'stat-list' }, ...daily.map((d) => el('li', { class: 'stat-row compact' },
      el('p', { class: 'stat-row-name' }, dayLabel(d.day)),
      el('p', { class: `stat-row-num ${d.signups ? '' : 'zero'}` }, `${num(d.signups)}명`),
    ))),
  );
}

function weeklyCard(weekly) {
  return el('section', { class: 'card' },
    el('div', { class: 'card-head' },
      iconTile('family', 'tone-violet'),
      el('div', {}, el('h2', {}, '주마다 가족 활동'), el('p', { class: 'muted' }, '글이나 채팅이 있었던 가족 수 · 최근 8주')),
    ),
    el('ul', { class: 'stat-list' }, ...weekly.map((w, i) => el('li', { class: 'stat-row' },
      el('div', { class: 'stat-row-text' },
        el('p', { class: 'stat-row-name' }, i === 0 ? `이번 주 (${dayLabel(w.week)}부터)` : `${dayLabel(w.week)} 주`),
        el('p', { class: 'stat-row-sub' }, `새로 만든 가족 ${num(w.new_groups)}`),
      ),
      el('p', { class: 'stat-row-num' }, `${num(w.active_groups)}가족`),
    ))),
  );
}

export async function renderStats() {
  const token = navToken();
  const body = el('div', { class: 'stack' }, skeletonRows(3));
  const refresh = el('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: () => renderStats() }, '새로고침');
  render(
    appBar('광고 성과', { left: backButton(() => go('/me')), right: refresh }),
    el('main', { class: 'page' },
      el('p', { class: 'muted stat-intro' }, '숫자만 보여요. 이름 · 이메일 · 글 · 사진 · 채팅 내용은 보지 않아요.'),
      body,
    ),
  );

  const { data, error } = await sb.rpc('admin_stats');
  if (isStale(token)) return;
  if (error) {
    // 데이터베이스가 버전 12 전이면 함수가 없어요
    const message = error.code === 'PGRST202'
      ? '데이터베이스를 버전 12로 올리면 볼 수 있어요. supabase/updates/v11_to_v12.sql 을 SQL Editor에서 실행해 주세요.'
      : friendlyError(error);
    body.replaceChildren(errorCard(message, () => renderStats()));
    return;
  }

  const t = data.totals || {};
  body.replaceChildren(
    el('section', { class: 'stat-grid' },
      tile('오늘 가입', `${num(t.users_today)}명`),
      tile('최근 7일 가입', `${num(t.users_7d)}명`),
      tile('전체 회원', `${num(t.users)}명`),
      tile('가족 그룹', `${num(t.groups)}개`, `소식 ${num(t.posts)} · 채팅 ${num(t.messages)}`),
    ),
    sourcesCard(data.sources || []),
    dailyCard(data.daily || []),
    weeklyCard(data.weekly || []),
    el('p', { class: 'muted small center' }, '보는 방법 · 광고 시작하기: 안내서 17단계 (docs/step17-ads.md)'),
  );
}
