// scripts/ops/set_commands.ts
import "dotenv/config";

type TelegramResponse = {
  ok: boolean;
  result?: any;
  description?: string;
};

const commands = [
  { command: "sector", description: "유망 섹터 랭킹 보기" },
  { command: "nextsector", description: "수급 유입 섹터 흐름 보기" },
  { command: "stocks", description: "섹터별 주도주 보기" },
  { command: "score", description: "개별 종목 점수/시그널 보기" },
  { command: "buy", description: "엔트리/손절/익절 레벨 보기" },
  { command: "start", description: "사용법 안내" },
];

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

if (!TELEGRAM_BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN is not defined in .env file.");
  process.exit(1);
}

async function setCommands() {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setMyCommands`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands }),
    });

    // 🔧 res.json() 결과를 명시적으로 TelegramResponse로 단언
    const json = (await res.json()) as TelegramResponse;

    if (json.ok) {
      console.log("✅ Telegram bot commands updated successfully!");
    } else {
      console.error("❌ Failed to update commands:", json);
    }
  } catch (e) {
    console.error("❌ Exception while updating commands:", e);
  }
}

setCommands().catch((e) => {
  console.error(e);
  process.exit(1);
});
