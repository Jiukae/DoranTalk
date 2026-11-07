// 달력 탭: 가족 생신 · 기일 · 기념일 · 일정 (음력도), 하루 전 · 당일에 가족에게 알림
import { state } from '../state.js';
import { isStale } from '../router.js';
import { friendlyError } from '../errors.js';
import { el, icon, iconTile, toast, emptyState, errorCard, skeletonRows, actionSheet, confirmDialog, messageBox, setBusy } from '../ui.js';
import { solarToLunar } from '../lunar.js';
import {
  EVENT_KINDS, fetchEvents, createEvent, deleteEvent, eventsInMonth, nextDate, computeNextDates,
  lunarLabel, ddayLabel, dateLabel, kstToday, daysInMonth, isMissingCalendar,
} from '../events.js';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const UPCOMING_DAYS = 90;
const pad = (n) => String(n).padStart(2, '0');

export async function renderCalendarTab(main, group, token) {
  const body = el('div', { class: 'stack' }, skeletonRows(2));
  main.append(body);
  const today = kstToday();
  let viewY = +today.slice(0, 4);
  let viewM = +today.slice(5, 7);
  let selected = today;
  let events = [];

  async function load() {
    try {
      events = await fetchEvents(group.id);
    } catch (err) {
      if (isStale(token)) return;
      body.replaceChildren(isMissingCalendar(err)
        ? el('section', { class: 'card' }, emptyState('calendar', '가족 달력은 곧 열려요', '운영자가 데이터베이스를 버전 14로 올리면 쓸 수 있어요.'))
        : errorCard(friendlyError(err), load));
      return;
    }
    if (isStale(token)) return;
    draw();
  }

  function draw() {
    body.replaceChildren(monthCard(), upcomingCard(), addCard());
  }

  // ---- 한 달 달력 ----
  function monthCard() {
    const map = eventsInMonth(events, viewY, viewM);
    const first = new Date(Date.UTC(viewY, viewM - 1, 1)).getUTCDay();
    const n = daysInMonth(viewY, viewM);
    const cells = [];
    for (let i = 0; i < first; i++) cells.push(el('span', { class: 'cal-cell empty', 'aria-hidden': 'true' }));
    for (let d = 1; d <= n; d++) {
      const iso = `${viewY}-${pad(viewM)}-${pad(d)}`;
      const evs = map[iso] || [];
      const dow = (first + d - 1) % 7;
      cells.push(el('button', {
        class: `cal-cell ${iso === today ? 'today' : ''} ${iso === selected ? 'selected' : ''} ${dow === 0 ? 'sun' : dow === 6 ? 'sat' : ''} ${evs.length ? 'has' : ''}`,
        type: 'button',
        'aria-label': `${viewM}월 ${d}일${evs.length ? ` · 일정 ${evs.length}개` : ''}`,
        onclick: () => { selected = iso; draw(); },
      },
        el('span', { class: 'cal-num' }, d),
        evs.length ? el('span', { class: 'cal-emoji', 'aria-hidden': 'true' }, evs.slice(0, 2).map((e) => EVENT_KINDS[e.kind].emoji).join('')) : null,
      ));
    }
    const lunar = solarToLunar(selected);
    const dayEvents = eventsInMonth(events, +selected.slice(0, 4), +selected.slice(5, 7))[selected] || [];
    return el('section', { class: 'card cal-card' },
      el('div', { class: 'cal-head' },
        el('button', { class: 'btn btn-ghost btn-small', type: 'button', 'aria-label': '지난달', onclick: () => moveMonth(-1) }, icon('back', { size: 22 })),
        el('h2', {}, `${viewY}년 ${viewM}월`),
        el('button', { class: 'btn btn-ghost btn-small', type: 'button', 'aria-label': '다음 달', onclick: () => moveMonth(1) }, icon('chevronRight', { size: 22 })),
      ),
      el('div', { class: 'cal-grid cal-week' }, ...WEEKDAYS.map((w, i) => el('span', { class: i === 0 ? 'sun' : i === 6 ? 'sat' : '' }, w))),
      el('div', { class: 'cal-grid' }, ...cells),
      el('div', { class: 'cal-day' },
        el('p', { class: 'cal-day-title' }, dateLabel(selected), lunar && el('span', { class: 'muted small' }, ` · 음력 ${lunar.leap ? '윤' : ''}${lunar.month}월 ${lunar.day}일`)),
        dayEvents.length
          ? el('ul', { class: 'event-list' }, ...dayEvents.map((e) => eventRow(e, selected)))
          : el('p', { class: 'muted small', style: 'margin:4px 0 0' }, '이 날은 일정이 없어요.'),
      ),
    );
  }

  function moveMonth(d) {
    viewM += d;
    if (viewM < 1) { viewM = 12; viewY--; }
    if (viewM > 12) { viewM = 1; viewY++; }
    selected = `${viewY}-${pad(viewM)}-01`;
    if (selected.slice(0, 7) === today.slice(0, 7)) selected = today;
    draw();
  }

  // ---- 다가오는 일정 ----
  function upcomingCard() {
    const limit = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10) + UPCOMING_DAYS)).toISOString().slice(0, 10);
    const list = events.map((e) => ({ e, date: nextDate(e, today) }))
      .filter((x) => x.date && x.date <= limit)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    return el('section', { class: 'card' },
      el('div', { class: 'card-head' },
        iconTile('calendar'),
        el('div', {}, el('h2', {}, '다가오는 일정'), el('p', { class: 'muted' }, '하루 전 · 당일에 가족에게 알림이 가요 🔔')),
      ),
      list.length
        ? el('ul', { class: 'event-list' }, ...list.map(({ e, date }) => eventRow(e, date)))
        : emptyState('calendar', events.length ? '3달 안에는 일정이 없어요' : '아직 일정이 없어요', '아래에서 가족 생신이나 일정을 더해 보세요.'),
    );
  }

  function eventRow(e, date) {
    const k = EVENT_KINDS[e.kind];
    const canDelete = e.created_by === state.session.user.id || group.created_by === state.session.user.id;
    return el('li', {},
      el('button', {
        class: 'event-row', type: 'button',
        onclick: () => actionSheet({
          title: e.title,
          actions: canDelete
            ? [{ label: '이 일정 지우기', icon: 'trash', danger: true, onSelect: () => remove(e) }]
            : [{ label: '만든 사람이나 방장만 지울 수 있어요', icon: 'lock', onSelect: () => {} }],
        }),
      },
        el('span', { class: 'event-emoji', 'aria-hidden': 'true' }, k.emoji),
        el('span', { class: 'event-text' },
          el('b', {}, e.title),
          el('span', { class: 'muted small' }, [dateLabel(date), lunarLabel(e), e.year ? '' : '매년'].filter(Boolean).join(' · ')),
        ),
        el('span', { class: `dday ${date === today ? 'now' : ''}` }, ddayLabel(date, today)),
      ),
    );
  }

  async function remove(e) {
    if (!(await confirmDialog({ title: '이 일정을 지울까요?', message: `"${e.title}" 일정이 가족 모두의 달력에서 사라져요.`, confirmText: '지우기', danger: true }))) return;
    try {
      await deleteEvent(e.id);
      events = events.filter((x) => x.id !== e.id);
      toast('일정을 지웠어요.');
      draw();
    } catch (err) {
      toast(friendlyError(err), 4000);
    }
  }

  // ---- 일정 더하기 ----
  function addCard() {
    const form = { kind: 'birthday', calendar: 'solar', month: +selected.slice(5, 7), day: +selected.slice(8, 10), leap: false, yearly: true, year: +today.slice(0, 4) };
    const title = el('input', { class: 'input', type: 'text', maxlength: 30, placeholder: EVENT_KINDS.birthday.placeholder, 'aria-label': '제목' });
    const kindRow = el('div', { class: 'seg seg-4', role: 'radiogroup', 'aria-label': '종류' });
    const calRow = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': '양력 · 음력' });
    const repeatRow = el('div', { class: 'seg', role: 'radiogroup', 'aria-label': '반복' });
    const month = el('select', { class: 'input', 'aria-label': '월' }, ...Array.from({ length: 12 }, (_, i) => el('option', { value: i + 1 }, `${i + 1}월`)));
    const day = el('select', { class: 'input', 'aria-label': '일' });
    const year = el('select', { class: 'input', 'aria-label': '연도' },
      ...Array.from({ length: 4 }, (_, i) => el('option', { value: form.year + i }, `${form.year + i}년`)));
    const leap = el('input', { type: 'checkbox', id: 'ev-leap' });
    const leapBox = el('label', { class: 'check-row', for: 'ev-leap' }, leap, '윤달이에요');
    const preview = el('p', { class: 'event-preview' });
    const msg = messageBox();
    const save = el('button', { class: 'btn btn-block', type: 'submit' }, icon('plus', { size: 22 }), '일정 더하기');

    const seg = (row, items, key, onChange) => {
      row.replaceChildren(...items.map(([value, label]) => el('button', {
        class: `seg-item ${form[key] === value ? 'on' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(form[key] === value),
        onclick: () => { form[key] = value; onChange?.(); paint(); },
      }, label)));
    };

    function paint() {
      seg(kindRow, Object.entries(EVENT_KINDS).map(([k, v]) => [k, `${v.emoji} ${v.label}`]), 'kind', () => {
        title.placeholder = EVENT_KINDS[form.kind].placeholder;
        form.yearly = form.kind !== 'event';
      });
      seg(calRow, [['solar', '양력'], ['lunar', '음력']], 'calendar');
      seg(repeatRow, [[true, '매년'], [false, '한 번만']], 'yearly');
      month.value = String(form.month);
      const max = form.calendar === 'lunar' ? 30 : form.yearly ? daysInMonth(2024, form.month) : daysInMonth(form.year, form.month);
      if (form.day > max) form.day = max;
      day.replaceChildren(...Array.from({ length: max }, (_, i) => el('option', { value: i + 1, selected: i + 1 === form.day }, `${i + 1}일`)));
      year.hidden = form.yearly;
      year.value = String(form.year);
      leapBox.hidden = form.calendar !== 'lunar';
      leap.checked = form.leap;
      // 이번엔 언제인지 미리 보여 줘요 (음력은 특히)
      const ev = { ...form, leap: form.calendar === 'lunar' && form.leap, year: form.yearly ? null : form.year };
      const next = computeNextDates(ev)[0];
      preview.textContent = next
        ? `${form.yearly ? '다음은' : ''} ${dateLabel(next)} (${ddayLabel(next, today)})${form.calendar === 'lunar' ? ' · 양력 날짜는 해마다 바뀌어요' : ''}`.trim()
        : '이 날짜는 이미 지났거나 계산할 수 없어요.';
    }
    month.addEventListener('change', () => { form.month = +month.value; paint(); });
    day.addEventListener('change', () => { form.day = +day.value; paint(); });
    year.addEventListener('change', () => { form.year = +year.value; paint(); });
    leap.addEventListener('change', () => { form.leap = leap.checked; paint(); });
    paint();

    const details = el('details', { class: 'card add-event' },
      el('summary', {}, icon('plus', { size: 22 }), '일정 더하기 (생신 · 기일 · 기념일)'),
      el('form', {
        class: 'stack', novalidate: true,
        onsubmit: async (e) => {
          e.preventDefault();
          msg.clear();
          if (!title.value.trim()) return msg.show('제목을 적어 주세요. 예: 할머니 생신');
          const ev = { kind: form.kind, title: title.value, calendar: form.calendar, month: form.month, day: form.day, leap: form.leap, year: form.yearly ? null : form.year };
          if (!computeNextDates(ev).length && !ev.year) return msg.show('이 날짜는 계산할 수 없어요. 날짜를 다시 골라 주세요.');
          setBusy(save, true, '저장하는 중…');
          try {
            const created = await createEvent(group.id, ev);
            events.push(created);
            toast(`"${created.title}" 일정을 더했어요. 하루 전과 당일에 가족에게 알려 드려요.`, 3500);
            const d = nextDate(created, today);
            if (d) { viewY = +d.slice(0, 4); viewM = +d.slice(5, 7); selected = d; }
            draw();
          } catch (err) {
            msg.show(friendlyError(err));
            setBusy(save, false);
          }
        },
      },
        el('div', {}, el('p', { class: 'field-label' }, '무엇인가요?'), kindRow),
        el('div', {}, el('p', { class: 'field-label' }, '제목'), title),
        el('div', {}, el('p', { class: 'field-label' }, '날짜'), calRow,
          el('div', { class: 'date-row' }, year, month, day), leapBox),
        el('div', {}, el('p', { class: 'field-label' }, '반복'), repeatRow),
        preview,
        msg,
        save,
      ),
    );
    return details;
  }

  await load();
  return undefined;
}

// 홈 화면: 내 모든 그룹의 다가오는 일정 (30일 안)
export function upcomingHomeCard(events, today = kstToday()) {
  const limit = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10) + 30)).toISOString().slice(0, 10);
  const list = events.map((e) => ({ e, date: nextDate(e, today) }))
    .filter((x) => x.date && x.date <= limit)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(0, 5);
  if (!list.length) return null;
  return el('section', { class: 'card upcoming-home' },
    el('div', { class: 'card-head' },
      iconTile('calendar'),
      el('div', {}, el('h2', {}, '다가오는 가족 일정'), el('p', { class: 'muted' }, '30일 안')),
    ),
    el('ul', { class: 'event-list' }, ...list.map(({ e, date }) => el('li', {},
      el('a', { class: 'event-row', href: `#/group/${e.group_id}/calendar` },
        el('span', { class: 'event-emoji', 'aria-hidden': 'true' }, EVENT_KINDS[e.kind].emoji),
        el('span', { class: 'event-text' },
          el('b', {}, e.title),
          el('span', { class: 'muted small' }, [dateLabel(date), lunarLabel(e), e.group?.name].filter(Boolean).join(' · ')),
        ),
        el('span', { class: `dday ${date === today ? 'now' : ''}` }, ddayLabel(date, today)),
      )))),
  );
}

