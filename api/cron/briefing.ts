import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createBriefingReport } from "../../src/services/briefingService";
import { tg } from "../../src/telegram/api";
import { createClient } from "@supabase/supabase-js";

// 환경 변수 로드 및 검증
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;
const CRON_SECRET = process.env.CRON_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY!;

export const config = {
  maxDuration: 60, // 브리핑 생성에 시간이 걸릴 수 있으므로 60초로 연장
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 1. 메서드 검증 (Cron은 GET)
  if (req.method !== "GET") {
    return res.status(405).send("Method Not Allowed");
  }

  // 2. 보안 검증 (Vercel Cron 헤더)
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).send("Unauthorized");
  }

  if (!ADMIN_CHAT_ID) return res.status(500).send("Missing ADMIN_CHAT_ID");

  try {
    // 3. Supabase 클라이언트 초기화
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // 4. 브리핑 리포트 생성 (핵심 로직)
    // type=market_close 이면 마감, 기본값은 장전
    const briefingType =
      req.query.type === "market_close" ? "market_close" : "pre_market";
    const report = await createBriefingReport(supabase, briefingType);

    // 5. 텔레그램 전송 (HTML 파싱 모드)
    await tg("sendMessage", {
      chat_id: Number(ADMIN_CHAT_ID),
      text: report,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });

    console.log("Briefing sent successfully");
    return res.status(200).json({ success: true, message: "Briefing sent" });
  } catch (error: any) {
    console.error("Briefing Error:", error);
    // 에러 발생 시 관리자에게 알림
    await tg("sendMessage", {
      chat_id: Number(ADMIN_CHAT_ID),
      text: `⚠️ 브리핑 생성 실패: ${error.message}`,
    });
    return res.status(500).send(error.message);
  }
}
