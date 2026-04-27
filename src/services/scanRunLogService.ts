import { createClient } from "@supabase/supabase-js";

export type ScanRunLogInput = {
  chatId: number;
  userId?: number | null;
  query?: string;
  filters: string[];
  riskProfile: string;
  signalTradeDate?: string | null;
  scoreAsof?: string | null;
  candidateCount: number;
  filteredCount: number;
  saferCount: number;
  finalCount: number;
  staleBusinessGap: number;
  realtimeMomentumWeight: number;
};

type ScanRunLogRow = {
  id: number;
  chat_id: number;
  query_text: string | null;
  filters: string[] | null;
  risk_profile: string | null;
  signal_trade_date: string | null;
  score_asof: string | null;
  candidate_count: number | null;
  filtered_count: number | null;
  safer_count: number | null;
  final_count: number | null;
  stale_business_gap: number | null;
  realtime_momentum_weight: number | null;
  created_at: string | null;
};

export type ScanRunDailySummary = {
  date: string;
  runCount: number;
  avgFilteredRatio: number;
  avgFinalRatio: number;
  avgRealtimeWeight: number;
};

const hasDbConfig =
  Boolean(process.env.SUPABASE_URL) &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);

const supabase = hasDbConfig
  ? createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY!
    )
  : null;

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toKstDateKey(iso?: string | null): string {
  if (!iso) return "-";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "-";
  const kst = new Date(parsed.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export async function appendScanRunLog(input: ScanRunLogInput): Promise<void> {
  if (!supabase) return;

  try {
    await supabase.from("scan_run_logs").insert({
      chat_id: input.chatId,
      user_id: input.userId ?? null,
      query_text: String(input.query ?? "").trim() || null,
      filters: input.filters,
      risk_profile: input.riskProfile,
      signal_trade_date: input.signalTradeDate ?? null,
      score_asof: input.scoreAsof ?? null,
      candidate_count: input.candidateCount,
      filtered_count: input.filteredCount,
      safer_count: input.saferCount,
      final_count: input.finalCount,
      stale_business_gap: input.staleBusinessGap,
      realtime_momentum_weight: input.realtimeMomentumWeight,
    });
  } catch (error) {
    console.error("appendScanRunLog error:", error);
  }
}

export async function fetchRecentScanRunDailySummary(input: {
  chatId: number;
  days?: number;
}): Promise<ScanRunDailySummary[]> {
  if (!supabase) return [];

  const days = Math.max(3, Math.min(30, Math.floor(input.days ?? 7)));
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("scan_run_logs")
    .select(
      "id, chat_id, query_text, filters, risk_profile, signal_trade_date, score_asof, candidate_count, filtered_count, safer_count, final_count, stale_business_gap, realtime_momentum_weight, created_at"
    )
    .eq("chat_id", input.chatId)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(500)
    .returns<ScanRunLogRow[]>();

  if (error) {
    console.error("fetchRecentScanRunDailySummary error:", error);
    return [];
  }

  const bucket = new Map<
    string,
    {
      runCount: number;
      filteredRatioSum: number;
      finalRatioSum: number;
      realtimeWeightSum: number;
    }
  >();

  for (const row of data ?? []) {
    const day = toKstDateKey(row.created_at);
    if (day === "-") continue;

    const candidateCount = Math.max(0, toNumber(row.candidate_count, 0));
    const filteredCount = Math.max(0, toNumber(row.filtered_count, 0));
    const finalCount = Math.max(0, toNumber(row.final_count, 0));
    const realtimeWeight = Math.max(0, toNumber(row.realtime_momentum_weight, 0));

    const filteredRatio = candidateCount > 0 ? filteredCount / candidateCount : 0;
    const finalRatio = candidateCount > 0 ? finalCount / candidateCount : 0;

    const current = bucket.get(day) ?? {
      runCount: 0,
      filteredRatioSum: 0,
      finalRatioSum: 0,
      realtimeWeightSum: 0,
    };

    current.runCount += 1;
    current.filteredRatioSum += filteredRatio;
    current.finalRatioSum += finalRatio;
    current.realtimeWeightSum += realtimeWeight;
    bucket.set(day, current);
  }

  return Array.from(bucket.entries())
    .map(([date, value]) => ({
      date,
      runCount: value.runCount,
      avgFilteredRatio:
        value.runCount > 0 ? Number((value.filteredRatioSum / value.runCount).toFixed(4)) : 0,
      avgFinalRatio:
        value.runCount > 0 ? Number((value.finalRatioSum / value.runCount).toFixed(4)) : 0,
      avgRealtimeWeight:
        value.runCount > 0 ? Number((value.realtimeWeightSum / value.runCount).toFixed(2)) : 0,
    }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}
