import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createBriefingReport } from "../../src/services/briefingService";
import { sendMessage } from "../../src/telegram/api";
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
    // 'pre_market' 모드로 실행하여 08:30 장전 브리핑 포맷으로 생성
    const report = await createBriefingReport(supabase, "pre_market");

    // 5. 텔레그램 전송
    // 마크다운 파싱 에러 방지를 위해 HTML 모드 혹은 MarkdownV2 사용 권장
    await sendMessage(Number(ADMIN_CHAT_ID), report);

    console.log("Briefing sent successfully");
    return res.status(200).json({ success: true, message: "Briefing sent" });
  } catch (error: any) {
    console.error("Briefing Error:", error);
    // 에러 발생 시 관리자에게 알림
    await sendMessage(
      Number(ADMIN_CHAT_ID),
      `⚠️ 브리핑 생성 실패: ${error.message}`
    );
    return res.status(500).send(error.message);
  }
}
