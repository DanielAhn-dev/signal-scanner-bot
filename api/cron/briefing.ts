// api/cron/briefing.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
const TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const ADMIN = process.env.TELEGRAM_ADMIN_CHAT_ID!;

export default async function handler(
  _req: VercelRequest,
  res: VercelResponse
) {
  const text =
    "☀️ 08:30 브리핑\n- 상위 섹터: 반도체, 2차전지\n- 신규 후보: ...";
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: ADMIN, text }),
  });
  return res.status(200).send("OK");
}
