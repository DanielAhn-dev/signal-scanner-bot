import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createBriefingReport } from "../../src/services/briefingService";
import { tg } from "../../src/telegram/api";
import { createClient } from "@supabase/supabase-js";

const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;
const CRON_SECRET = process.env.CRON_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY!;

export const config = {
  maxDuration: 60,
};

// 발송 사이 딜레이 (Telegram Bot API: 30msg/sec 제한 준수)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).send("Method Not Allowed");
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).send("Unauthorized");
  }

  if (!ADMIN_CHAT_ID) return res.status(500).send("Missing ADMIN_CHAT_ID");

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // 브리핑 타입 결정
    const briefingType =
      req.query.type === "market_close" ? "market_close" : "pre_market";

    // 브리핑 리포트 생성 (한 번만 생성 후 모든 사용자에게 동일 내용 발송)
    const report = await createBriefingReport(supabase, briefingType);

    // 활성 사용자 목록 조회
    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("tg_id")
      .eq("is_active", true);

    if (usersError) {
      console.error("사용자 조회 실패:", usersError);
    }

    const recipientIds: number[] =
      users && users.length > 0
        ? users.map((u: { tg_id: number }) => u.tg_id)
        : [Number(ADMIN_CHAT_ID)]; // 등록된 사용자 없으면 관리자에게만 발송

    let sent = 0;
    let failed = 0;

    for (const chatId of recipientIds) {
      try {
        await tg("sendMessage", {
          chat_id: chatId,
          text: report,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        });
        sent++;
      } catch (e: any) {
        // 봇 차단(403), 사용자 없음(400) 등 개별 오류는 무시하고 계속 진행
        const code = e?.response?.error_code ?? e?.status ?? "?";
        console.warn(`발송 실패 chat_id=${chatId} code=${code}: ${e?.message}`);
        failed++;

        // 봇 차단된 사용자 비활성화 처리
        if (code === 403) {
          // 봇 차단 사용자 비활성화 (실패 무시)
          supabase
            .from("users")
            .update({ is_active: false })
            .eq("tg_id", chatId)
            .then(() => {}, () => {});
        }
      }

      // 50ms 딜레이 (초당 최대 20건 발송으로 Telegram 제한 준수)
      await sleep(50);
    }

    console.log(`브리핑 발송 완료: 성공 ${sent}명, 실패 ${failed}명`);
    return res.status(200).json({ success: true, sent, failed });
  } catch (error: any) {
    console.error("Briefing Error:", error);
    // 브리핑 생성 자체 실패 시 관리자에게만 오류 알림
    await tg("sendMessage", {
      chat_id: Number(ADMIN_CHAT_ID),
      text: `⚠️ 브리핑 생성 실패: ${error.message}`,
    }).catch(() => {});
    return res.status(500).send(error.message);
  }
}
