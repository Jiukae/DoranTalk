// 음력 ↔ 양력 바꾸기 (한국천문연구원 음력 기준, 음력 2019~2050년)
// 해마다 [음력 해, 음력 1월 1일(설날)의 양력 날짜, 달 길이(1 = 30일 · 0 = 29일, 윤달도 순서대로), 윤달이 오는 달(없으면 0)]
// (korean-lunar-calendar 라이브러리로 뽑은 표예요. 2050년은 11월까지만 있어요)
const DATA = [
  [2019, '2019-02-05', '101010010101', 0],
  [2020, '2020-01-25', '1011010010101', 4],
  [2021, '2021-02-12', '011010101010', 0],
  [2022, '2022-02-01', '101011010101', 0],
  [2023, '2023-01-22', '0101010110101', 2],
  [2024, '2024-02-10', '010010110110', 0],
  [2025, '2025-01-29', '1010010101110', 6],
  [2026, '2026-02-17', '101001010111', 0],
  [2027, '2027-02-07', '010100100111', 0],
  [2028, '2028-01-27', '0110100100110', 5],
  [2029, '2029-02-13', '110110010011', 0],
  [2030, '2030-02-03', '010110101010', 0],
  [2031, '2031-01-23', '1010101101010', 3],
  [2032, '2032-02-11', '100101101101', 0],
  [2033, '2033-01-31', '0100101011101', 11],
  [2034, '2034-02-19', '010010101110', 0],
  [2035, '2035-02-08', '101001001101', 0],
  [2036, '2036-01-28', '1101001001101', 6],
  [2037, '2037-02-15', '110100100101', 0],
  [2038, '2038-02-04', '110101010010', 0],
  [2039, '2039-01-24', '1101101010100', 5],
  [2040, '2040-02-12', '101101101010', 0],
  [2041, '2041-02-01', '100101101101', 0],
  [2042, '2042-01-22', '0100101011011', 2],
  [2043, '2043-02-10', '010010011011', 0],
  [2044, '2044-01-30', '1010010010111', 7],
  [2045, '2045-02-17', '101001001011', 0],
  [2046, '2046-02-06', '101100100101', 0],
  [2047, '2047-01-26', '1011010100101', 5],
  [2048, '2048-02-14', '011011010100', 0],
  [2049, '2049-02-02', '101011011010', 0],
  [2050, '2050-01-23', '100101011010', 3],
];
const YEARS = new Map(DATA.map(([y, start, bits, leap]) => [y, { start, bits, leap }]));

function addDays(iso, n) {
  const t = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000);
}

// 그 해의 달 목록 [{ month, leap, length, offset }] (offset = 설날부터 며칠째에 시작하는지)
function monthsOf(y) {
  const info = YEARS.get(y);
  if (!info) return null;
  const list = [];
  let offset = 0;
  let i = 0;
  for (let m = 1; m <= 12; m++) {
    for (const leap of [false, true]) {
      if (leap && info.leap !== m) continue;
      if (i >= info.bits.length) return list; // 표 끝
      const length = info.bits[i] === '1' ? 30 : 29;
      list.push({ month: m, leap, length, offset });
      offset += length;
      i++;
    }
  }
  return list;
}

// 음력 y년 m월 d일 (윤달이면 leap) → 양력 'YYYY-MM-DD' (표 밖이면 null)
// 그 해에 윤달이 없으면 평달로, 그 달이 29일까지면 30일은 29일로 셈해요 (생신 · 기일을 해마다 챙길 때 흔히 쓰는 방법)
export function lunarToSolar(y, m, d, leap = false) {
  const months = monthsOf(y);
  if (!months) return null;
  const hit = months.find((x) => x.month === m && x.leap === leap) || months.find((x) => x.month === m && !x.leap);
  if (!hit) return null;
  return addDays(YEARS.get(y).start, hit.offset + Math.min(d, hit.length) - 1);
}

// 양력 'YYYY-MM-DD' → { year, month, day, leap } (표 밖이면 null)
export function solarToLunar(iso) {
  for (let y = +iso.slice(0, 4); y >= +iso.slice(0, 4) - 1; y--) {
    const info = YEARS.get(y);
    if (!info) continue;
    const n = daysBetween(info.start, iso);
    if (n < 0) continue;
    for (const x of monthsOf(y)) {
      if (n < x.offset + x.length) return { year: y, month: x.month, day: n - x.offset + 1, leap: x.leap };
    }
  }
  return null;
}
