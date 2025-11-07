// api/cron/intraday.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { allowCron } from "../../src/utils/cron";
import { sendMessage } from "../../src/telegram/api";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!allowCron(req)) return res.status(401).send("unauthorized");

  const admin = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (admin) await sendMessage(Number(admin), "장중 스텁 실행");

  return res.status(200).send("intraday ok");
}
