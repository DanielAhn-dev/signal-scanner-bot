import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createBriefingReport } from "../../src/services/briefingService";
import { createDailyCandidatePlanningReport } from "../../src/services/marketInsightService";
import { tg } from "../../src/telegram/api";
import { createClient } from "@supabase/supabase-js";
import { getUserInvestmentPrefs } from "../../src/services/userService";

const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;
const CRON_SECRET = process.env.CRON_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

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

    // 활성 사용자 목록 조회
    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("tg_id, prefs")
      .eq("is_active", true);

    if (usersError) {
      console.error("사용자 조회 실패:", usersError);
    }

    const recipients =
      users && users.length > 0
        ? users.map((u: { tg_id: number; prefs?: Record<string, unknown> | null }) => ({
            chatId: u.tg_id,
            prefs: u.prefs || {},
          }))
        : [{ chatId: Number(ADMIN_CHAT_ID), prefs: {} }];

    let sent = 0;
    let failed = 0;

    for (const recipient of recipients) {
      const chatId = recipient.chatId;
      try {
        const prefs = await getUserInvestmentPrefs(chatId);
        const report = await createBriefingReport(supabase, briefingType, {
          chatId,
          riskProfile: prefs.risk_profile ?? "safe",
        });
        const planningBlock = briefingType === "pre_market"
          ? await createDailyCandidatePlanningReport(supabase, {
              riskProfile: prefs.risk_profile ?? "safe",
              mode: "briefing",
            }).catch(() => "")
          : "";

        await tg("sendMessage", {
          chat_id: chatId,
          text: planningBlock ? `${report}\n\n${planningBlock}` : report,
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

    // 리스크 신호 계산 및 저장
    try {
      const { calculateRiskSignals } = await import("../../src/services/riskSignalService");
      const { fetchAllMarketData } = await import("../../src/utils/fetchMarketData");
      
      const marketOverview = await fetchAllMarketData();
      const riskSignals = await calculateRiskSignals(supabase, marketOverview as any);
      const today = new Date().toISOString().split("T")[0];
      
      const { error: upsertError } = await supabase.from("risk_signals").upsert({
        signal_date: today,
        risk_level: riskSignals.risk_level,
        signal_count: riskSignals.signal_count,
        factors: riskSignals.factors,
      });
      
      if (upsertError) {
        console.warn("[briefing-cron] 리스크 신호 저장 실패:", upsertError);
      } else {
        console.log(`[briefing-cron] 리스크 신호 저장 완료: ${riskSignals.risk_level} (신호 ${riskSignals.signal_count}개)`);
      }
    } catch (error) {
      console.warn("[briefing-cron] 리스크 신호 계산 중 오류:", error);
    }

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
