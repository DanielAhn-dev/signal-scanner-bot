// api/intraday.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sendMessage } from "../../lib/telegram";
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.headers["x-cron-secret"] !== process.env.CRON_SECRET)
    return res.status(403).send("Forbidden");
  await sendMessage(
    process.env.TELEGRAM_ADMIN_CHAT_ID!,
    "장중 신호: VWAP 재돌파·RSI·ROC 동시 충족 종목 알림"
  );
  res.status(200).json({ ok: true });
}
