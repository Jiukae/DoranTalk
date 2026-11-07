// 가족 달력: 생신 · 기일 · 기념일 · 일정 (양력 / 음력, 매년 / 한 번)
// - 음력 날짜는 해마다 양력 날짜가 바뀌어서, 저장할 때 앞으로의 양력 날짜(next_dates)를 계산해 함께 넣어요.
//   서버는 그 날짜로 "내일 · 오늘" 알림을 보내요. (데이터베이스 버전 14)
import { sb } from './supabase.js';
import { lunarToSolar } from './lunar.js';

export const EVENT_KINDS = {
  birthday: { label: '생신', emoji: '🎂', placeholder: '예: 할머니 생신' },
  memorial: { label: '기일', emoji: '🕯️', placeholder: '예: 할아버지 기일' },
  anniversary: { label: '기념일', emoji: '💐', placeholder: '예: 엄마 아빠 결혼기념일' },
  event: { label: '일정', emoji: '📌', placeholder: '예: 가족 여행' }, // 📅 은 휴대폰에 따라 영어 날짜(JUL 17)가 보여서
};

const FIELDS = 'id, group_id, title, kind, calendar, month, day, leap, year, next_dates, memo, created_by, created_at';

function check({ data, error }) {
  if (error) throw error;
  return data;
}

// 데이터베이스가 버전 14 전이라 달력 표가 없는지
export function isMissingCalendar(error) {
  return ['PGRST205', '42P01', 'PGRST202'].includes(error?.code);
}

const kstFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
// 한국 시간 오늘 'YYYY-MM-DD'
export function kstToday() {
  return kstFmt.format(new Date());
}

const pad = (n) => String(n).padStart(2, '0');
const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// 양력 m월 d일이 있는 날인지 (2월 29일은 매년 일정이면 괜찮아요: 평년엔 28일)
export function isValidSolar(m, d, yearly) {
  if (m === 2 && d === 29) return yearly;
  return d >= 1 && d <= daysInMonth(2024, m) && !(m === 2 && d > 29);
}

// 그 해(양력 일정은 양력 해, 음력 일정은 음력 해)의 날짜 → 'YYYY-MM-DD' 또는 null
function occurrenceIn(ev, y) {
  if (ev.calendar === 'lunar') return lunarToSolar(y, ev.month, ev.day, ev.leap);
  let d = ev.day;
  if (ev.month === 2 && d === 29 && !isLeapYear(y)) d = 28;
  if (d > daysInMonth(y, ev.month)) return null;
  return `${y}-${pad(ev.month)}-${pad(d)}`;
}

// 한 번만 있는 일정의 날짜
function singleDate(ev) {
  return ev.year ? occurrenceIn(ev, ev.year) : null;
}

// 앞으로의 날짜들 (오늘 포함, 오래된 것부터, 최대 26개)
export function computeNextDates(ev, today = kstToday()) {
  if (ev.year) {
    const d = singleDate(ev);
    return d ? [d] : [];
  }
  const y0 = +today.slice(0, 4);
  const out = [];
  for (let y = y0 - 1; y <= y0 + 26; y++) {
    const d = occurrenceIn(ev, y);
    if (d && d >= today && !out.includes(d)) out.push(d);
  }
  return out.sort().slice(0, 26);
}

// 다음 날짜 (지났으면 null)
export function nextDate(ev, today = kstToday()) {
  const stored = (ev.next_dates || []).find((d) => d >= today);
  return stored || computeNextDates(ev, today)[0] || null;
}

// 양력 y년 m월에 있는 날짜들 → { 'YYYY-MM-DD': [일정, ...] }
export function eventsInMonth(events, y, m) {
  const prefix = `${y}-${pad(m)}-`;
  const map = {};
  for (const ev of events) {
    const dates = ev.year ? [singleDate(ev)] : [occurrenceIn(ev, y - 1), occurrenceIn(ev, y), occurrenceIn(ev, y + 1)];
    for (const d of new Set(dates)) {
      if (d && d.startsWith(prefix)) (map[d] ||= []).push(ev);
    }
  }
  return map;
}

export function lunarLabel(ev) {
  return ev.calendar === 'lunar' ? `음력 ${ev.leap ? '윤' : ''}${ev.month}월 ${ev.day}일` : '';
}

// D-day: '오늘' · 'D-1' · 'D-12'
export function ddayLabel(date, today = kstToday()) {
  const n = Math.round((Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10))
    - Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))) / 86400000);
  return n === 0 ? '오늘' : n > 0 ? `D-${n}` : `${-n}일 전`;
}

const dayFmt = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'UTC' });
export function dateLabel(date) {
  return dayFmt.format(new Date(`${date}T00:00:00Z`));
}

export async function fetchEvents(groupId) {
  return check(await sb.from('family_events').select(FIELDS).eq('group_id', groupId).order('created_at'));
}

// 내 모든 그룹의 일정 (홈 "다가오는 가족 일정")
export async function fetchMyEvents() {
  return check(await sb.from('family_events').select(`${FIELDS}, group:family_groups(name)`).limit(300));
}

export async function createEvent(groupId, ev) {
  const row = {
    group_id: groupId,
    title: ev.title.trim(),
    kind: ev.kind,
    calendar: ev.calendar,
    month: ev.month,
    day: ev.day,
    leap: ev.calendar === 'lunar' && Boolean(ev.leap),
    year: ev.year || null,
  };
  row.next_dates = computeNextDates(row);
  return check(await sb.from('family_events').insert(row).select(FIELDS).single());
}

export async function deleteEvent(id) {
  const rows = check(await sb.from('family_events').delete().eq('id', id).select('id'));
  if (!rows.length) throw new Error('일정을 만든 사람이나 방장만 지울 수 있어요.');
}

// 앱을 열었을 때: 내 그룹 일정 중 오늘 · 내일인데 아직 알림을 안 보낸 것 → 알림 서버에 부탁
// (가족 중 누군가 앱을 열면 한 번만 가요. 하루에 한 번만 물어봐요)
export async function sendDueReminders(notify) {
  const key = `talkfeed.reminders.${kstToday()}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch { /* 그래도 한 번은 해 봐요 */ }
  const { data, error } = await sb.rpc('due_event_reminders');
  if (error) return; // 버전 14 전이면 조용히
  for (const id of data || []) notify('event', id);
}
