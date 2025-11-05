import type { VercelRequest, VercelResponse } from "@vercel/node";

const SECRET = process.env.TELEGRAM_BOT_SECRET!;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN!;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const hdr = (req.headers["x-telegram-bot-api-secret-token"] as string) || "";
  if (!hdr || hdr !== SECRET) return res.status(401).send("unauthorized");

  const update = req.body as any;
  const msg = update?.message;
  const text: string = msg?.text || "";
  const chatId = msg?.chat?.id;

  const reply = (t: string) =>
    fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: t }),
    });

  if (text.startsWith("/start")) {
    await reply(
      "✅ 구독 시작\n08:30 브리핑, 장중 신호, 15:40 마감 요약을 전송합니다."
    );
  } else if (text.startsWith("/sector")) {
    await reply("📊 상위 섹터: (개발중)");
  } else if (text.startsWith("/stocks")) {
    await reply("📈 종목 Top10: (개발중)");
  } else {
    await reply("명령어: /start, /sector, /stocks");
  }

  return res.status(200).end();
}
