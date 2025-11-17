import type { VercelRequest, VercelResponse } from "@vercel/node";
import { allowCron } from "../../src/utils/cron";
import { sendMessage } from "../../src/telegram/api";

// 환경 변수는 Vercel Dashboard나 .env.*에서 선언
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;

export const config = {
  api: {
    bodyParser: false, // raw body, 크론/웹훅에서 필수 설정
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // POST 아닌 요청 405 처리
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method Not Allowed");
  }

  // 내부 크론 인증값 확인
  if (!allowCron(req)) {
    return res.status(401).send("Unauthorized");
  }

  // 관리자 채팅 ID 정상 로딩 체크
  if (!ADMIN_CHAT_ID) {
    return res.status(500).send("Missing ADMIN_CHAT_ID");
  }

  try {
    // 텔레그램 메시지 전송
    await sendMessage(
      Number(ADMIN_CHAT_ID),
      "🟢 08:30 장전 브리핑 메시지 자동 전송"
    );
    return res.status(200).send("Briefing sent");
  } catch (error) {
    // 예외 발생 시 응답 및 로깅
    console.error("[BRIEFING_CRON]", error);
    return res.status(500).send("Failed to send briefing");
  }
}
