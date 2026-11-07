// 안부 인사: 한 번 누르면 가족 채팅으로 보내져요 (할머니 · 할아버지도 쉽게)
// 글자는 그대로 채팅 메시지가 되고, 데이터베이스에는 몇 번째 인사인지(greeting)도 남겨요 (버전 14)
export const GREETINGS = [
  { n: 1, text: '잘 지내요? 😊' },
  { n: 2, text: '잘 지내요! 👋' },
  { n: 3, text: '밥 먹었어요? 🍚' },
  { n: 4, text: '보고 싶어요 💛' },
  { n: 5, text: '건강 챙기세요 🍀' },
  { n: 6, text: '오늘도 힘내요 💪' },
  { n: 7, text: '다음에 만나요 🤗' },
  { n: 8, text: '고마워요 🙏' },
  { n: 9, text: '사랑해요 ❤️' },
  { n: 10, text: '잘 자요 🌙' },
];
export const GREETING_TEXTS = GREETINGS.map((g) => g.text);

export function isGreeting(content) {
  return GREETING_TEXTS.includes(content);
}

// 한국 시간 오늘 0시 (ISO)
export function todayStartIso() {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return new Date(`${d}T00:00:00+09:00`).toISOString();
}
