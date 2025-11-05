// scripts/setCommands.js
import "dotenv/config";
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) throw new Error("Missing TELEGRAM_BOT_TOKEN");
const api = (m) => `https://api.telegram.org/bot${TOKEN}/${m}`;
const commands = [
  { command: "start", description: "사용법 안내" },
  { command: "sector", description: "유망 섹터 보기" },
  { command: "stocks", description: "섹터별 대장주 보기" },
  { command: "score", description: "종목 점수/신호" },
  { command: "buy", description: "엔트리/손절/익절 제안" },
];
async function post(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  console.log(await r.text());
}
await post(api("deleteMyCommands"), {});
await post(api("deleteMyCommands"), { scope: { type: "all_private_chats" } });
await post(api("setMyCommands"), { commands });
await post(api("setMyCommands"), {
  scope: { type: "all_private_chats" },
  commands,
});
await post(api("getMyCommands"), {});
