import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { selectPaged } from "../../src/services/supabasePaging";
import { resolveAutoTradeSkipReasonCode } from "../../src/services/virtualAutoTradeObservability";

const SKIP_REASON_LABELS: Record<string, string> = {
  out_of_session: "장중 외 시간 스킵",
  duplicate_window: "동일 실행창 중복 스킵",
  daily_loss_limit: "일손실 한도 도달",
  no_deployable_cash: "투자 가능 현금 없음",
  cash_reserve_floor: "현금 하한 유지",
  insufficient_cash: "현금 부족",
  no_buy_slots: "매수 슬롯 없음",
  stale_or_frozen_close: "시세 동결/신선도 미달",
  strategy_blocked_buy: "전략 매수 차단",
  regime_defense_no_new_buy: "방어장 신규매수 중지",
  other: "기타(원문 미분류)",
};

type ActionRow = {
  chat_id: number | null;
  code: string | null;
  reason: string | null;
  created_at: string | null;
};

function getArgValue(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.findIndex((item) => item === flag);
  if (index < 0) return undefined;
  return args[index + 1];
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.");
  }

  const daysArg = Number(getArgValue("--days") ?? 14);
  const days = Number.isFinite(daysArg) && daysArg > 0 ? Math.floor(daysArg) : 14;
  const chatIdArg = getArgValue("--chat-id");
  const chatId = chatIdArg ? Number(chatIdArg) : null;
  const topArg = Number(getArgValue("--top") ?? 20);
  const top = Number.isFinite(topArg) && topArg > 0 ? Math.floor(topArg) : 20;

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const rows = await selectPaged<ActionRow>(
    async (from, to) => {
      let query = supabase
        .from("virtual_autotrade_actions")
        .select("chat_id, code, reason, created_at")
        .eq("action_type", "SKIP")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .range(from, to);
      if (chatId) query = query.eq("chat_id", chatId);
      return await query;
    },
    { pageSize: 1000, maxRows: 100000, logLabel: "ops.report_autotrade_skip_reasons" }
  );

  if (!rows.length) {
    console.log(`[skip-reasons] 최근 ${days}일 SKIP 액션 없음 (since=${since})`);
    return;
  }

  const byCode = new Map<string, number>();
  const byRawReason = new Map<string, number>();

  for (const row of rows) {
    const rawReason = String(row.reason ?? "").trim();
    byRawReason.set(rawReason || "(사유 없음)", (byRawReason.get(rawReason || "(사유 없음)") ?? 0) + 1);
    const code = (rawReason && resolveAutoTradeSkipReasonCode(rawReason)) || "other";
    byCode.set(code, (byCode.get(code) ?? 0) + 1);
  }

  const codeRanked = Array.from(byCode.entries()).sort((a, b) => b[1] - a[1]);
  const rawRanked = Array.from(byRawReason.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, top);

  console.log(`[skip-reasons] window=${days}d since=${since} chat_id=${chatId ?? "all"} total_skips=${rows.length}`);
  console.log("[skip-reasons] by code:");
  for (const [code, count] of codeRanked) {
    const pct = ((count / rows.length) * 100).toFixed(1);
    console.log(`- ${code} (${SKIP_REASON_LABELS[code] ?? code}): ${count}건 (${pct}%)`);
  }
  console.log(`[skip-reasons] top ${top} raw reasons:`);
  for (const [reason, count] of rawRanked) {
    const pct = ((count / rows.length) * 100).toFixed(1);
    console.log(`- "${reason}": ${count}건 (${pct}%)`);
  }
}

main().catch((error) => {
  console.error("[skip-reasons] failed:", error);
  process.exitCode = 1;
});
