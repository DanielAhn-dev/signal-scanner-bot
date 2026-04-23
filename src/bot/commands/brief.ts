import type { ChatContext } from "../router";
import { createClient } from "@supabase/supabase-js";
import { createBriefingReport } from "../../services/briefingService";
import { createDailyCandidatePlanningReportResult } from "../../services/marketInsightService";
import { buildAutoCyclePreviewText } from "../../services/autoCycleBriefingService";
import { buildPersonalizedGuidance } from "../../services/personalizedGuidanceService";
import { getUserInvestmentPrefs } from "../../services/userService";
import { ACTIONS, actionButtons, buildRecommendationActionButtons } from "../messages/layout";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// /brief 명령 처리 — briefingService의 고도화된 로직을 그대로 사용하여
// 자동 브리핑(cron)과 수동 브리핑(/brief)의 내용이 항상 동일하게 유지됩니다.
export async function handleBriefCommand(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  // 로딩 중 메시지 (브리핑 생성에 시간이 걸릴 수 있으므로)
  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: "☀️ 브리핑 생성 중...",
  });

  const prefs = await getUserInvestmentPrefs(ctx.from?.id ?? ctx.chatId);
  const report = await createBriefingReport(supabase, "pre_market", {
    chatId: ctx.chatId,
    riskProfile: prefs.risk_profile ?? "safe",
  });
  const planningResult = await createDailyCandidatePlanningReportResult(supabase, {
    riskProfile: prefs.risk_profile ?? "safe",
    mode: "briefing",
    chatId: ctx.chatId,
  }).catch(() => null);
  const autoCyclePreview = await buildAutoCyclePreviewText(ctx.chatId);
  const personalLines = await buildPersonalizedGuidance({
    chatId: ctx.chatId,
    context: "brief",
  }).catch(() => []);

  const finalReportBase = planningResult?.text ? `${report}\n\n${planningResult.text}` : report;
  const withAutoCyclePreview = autoCyclePreview ? `${finalReportBase}\n\n${autoCyclePreview}` : finalReportBase;
  const finalReport = personalLines.length > 0
    ? `${withAutoCyclePreview}\n\n<b>내 상황 제안</b>\n- ${personalLines.join("\n- ")}`
    : withAutoCyclePreview;

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: finalReport,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: actionButtons(
      buildRecommendationActionButtons((planningResult?.actionItems ?? []).slice(0, 2), ACTIONS.briefingPrimary),
      3
    ),
  });
}
