// scripts/setCommands.js
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
await fetch(`https://api.telegram.org/bot${TOKEN}/setMyCommands`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    language_code: "ko",
    commands: [
      { command: "시작", description: "사용법 안내" },
      { command: "섹터", description: "유망 섹터 보기" },
      { command: "종목", description: "섹터별 대장주 보기" },
      { command: "점수", description: "종목 점수/신호" },
      { command: "매수", description: "엔트리/손절/익절 제안" },
    ],
  }),
});
