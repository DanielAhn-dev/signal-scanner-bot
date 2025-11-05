// scripts/setCommands.js
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
async function main() {
  if (!TOKEN) throw new Error("Missing TELEGRAM_BOT_TOKEN");
  const url = `https://api.telegram.org/bot${TOKEN}/setMyCommands`;
  const body = {
    // language_code: "ko", // 생략 시 전역 기본 명령
    commands: [
      { command: "시작", description: "사용법 안내" },
      { command: "섹터", description: "유망 섹터 보기" },
      { command: "종목", description: "섹터별 대장주 보기" },
      { command: "점수", description: "종목 점수/신호" },
      { command: "매수", description: "엔트리/손절/익절 제안" },
    ],
  };
  console.log("POST", url, JSON.stringify(body));
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log(res.status, res.headers.get("content-type"), text);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
