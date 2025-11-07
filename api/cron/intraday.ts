// api/cron/intraday.ts
import { sendMessage } from "../../src/telegram/api";

export default async function handler(req: any, res: any) {
  const secret = process.env.CRON_SECRET || "";
  const got =
    (req.headers["x-cron-secret"] as string) ||
    (req.query?.secret as string) ||
    "";
  if (!secret || got !== secret) {
    res.statusCode = 401;
    res.end("unauthorized");
    return;
  }

  const admin = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (admin) {
    await sendMessage(Number(admin), "장중 스텁 실행");
  }

  res.statusCode = 200;
  res.end("intraday ok");
}
