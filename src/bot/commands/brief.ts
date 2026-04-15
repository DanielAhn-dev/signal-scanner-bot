import type { ChatContext } from "../router";
import { createClient } from "@supabase/supabase-js";
import { createBriefingReport } from "../../services/briefingService";
import { getUserInvestmentPrefs } from "../../services/userService";

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

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: report,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}
