// 날짜·시간을 "방금 전", "오후 3:20", "어제", "10월 3일" 처럼 보기 쉽게 바꿉니다.

const timeFmt = new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' });
const fullFmt = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function timeAgo(value) {
  const d = new Date(value);
  const now = new Date();
  const diffMin = Math.floor((now - d) / 60000);
  if (diffMin < 1) return '방금 전';
  if (diffMin < 60) return `${diffMin}분 전`;
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (days === 0) return timeFmt.format(d);
  if (days === 1) return `어제 ${timeFmt.format(d)}`;
  if (d.getFullYear() === now.getFullYear()) return dateFmt.format(d);
  return fullFmt.format(d);
}

export function timeOnly(value) {
  return timeFmt.format(new Date(value));
}
