// api/cron/briefing.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sendMessage } from "../../src/telegram/api";

const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;
const CRON_SECRET = process.env.CRON_SECRET;

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // [수정 1] Vercel Cron은 GET 요청을 보냅니다. (테스트를 위해 POST도 허용하고 싶다면 || 조건 추가)
  if (req.method !== "GET") {
    return res.status(405).send("Method Not Allowed");
  }

  // [수정 2] 시크릿 키 검증
  // Vercel Cron은 자동으로 헤더에 `Authorization: Bearer {CRON_SECRET}`을 담아 보냅니다.
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).send("Unauthorized");
  }

  if (!ADMIN_CHAT_ID) return res.status(500).send("Missing ADMIN_CHAT_ID");

  try {
    // 로직 수행
    await sendMessage(
      Number(ADMIN_CHAT_ID),
      "☀️ 08:30 장전 브리핑 시작합니다."
    );
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).send("Briefing Failed");
  }
}
