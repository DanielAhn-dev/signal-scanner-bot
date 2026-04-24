import type { SupabaseClient } from "@supabase/supabase-js";
import type { AutoTradeSkipReasonStat } from "./virtualAutoTradeObservability";
import { buildFreshnessLabel, isBusinessStale } from "../utils/dataFreshness";

type AutoTradeRunSummaryLike = {
  skipReasonStats?: Array<{
    code?: string | null;
    label?: string | null;
    count?: number | null;
  }> | null;
};

function kstNow(base = new Date()): Date {
  const utcMs = base.getTime() + base.getTimezoneOffset() * 60 * 1000;
  return new Date(utcMs + 9 * 60 * 60 * 1000);
}

function kstDayRangeIso(base = new Date()): { startIso: string; endIso: string; ymd: string } {
  const kst = kstNow(base);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  const startUtc = new Date(Date.UTC(y, kst.getUTCMonth(), kst.getUTCDate(), -9, 0, 0));
  const endUtc = new Date(Date.UTC(y, kst.getUTCMonth(), kst.getUTCDate() + 1, -9, 0, 0));
  return {
    startIso: startUtc.toISOString(),
    endIso: endUtc.toISOString(),
    ymd: `${y}-${m}-${d}`,
  };
}

async function fetchLatestValue(
  supabase: SupabaseClient,
  table: string,
  column: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from(table)
    .select(column)
    .order(column, { ascending: false })
    .limit(1);
  if (error) return null;
  const first = Array.isArray(data) ? data[0] : null;
  const row =
    first && typeof first === "object" ? (first as Record<string, unknown>) : null;
  const value = row?.[column];
  return typeof value === "string" ? value : null;
}

async function fetchCountByRange(
  supabase: SupabaseClient,
  table: string,
  tsColumn: string,
  startIso: string,
  endIso: string
): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .gte(tsColumn, startIso)
    .lt(tsColumn, endIso);
  if (error) return 0;
  return count ?? 0;
}

async function fetchQueuedJobsCount(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "queued");
  if (error) return 0;
  return count ?? 0;
}

async function fetchTodayAutoTradeFailedCount(
  supabase: SupabaseClient,
  startIso: string,
  endIso: string
): Promise<number> {
  const { count, error } = await supabase
    .from("virtual_autotrade_runs")
    .select("id", { count: "exact", head: true })
    .eq("status", "FAILED")
    .gte("started_at", startIso)
    .lt("started_at", endIso);
  if (error) return 0;
  return count ?? 0;
}

export function aggregateAutoTradeSkipReasonStats(
  summaries: AutoTradeRunSummaryLike[]
): AutoTradeSkipReasonStat[] {
  const counter = new Map<string, { label: string; count: number }>();

  for (const summary of summaries) {
    for (const stat of summary.skipReasonStats ?? []) {
      const code = String(stat?.code ?? "").trim();
      const label = String(stat?.label ?? "기타").trim() || "기타";
      const count = Number(stat?.count ?? 0);
      if (!code || !Number.isFinite(count) || count <= 0) continue;
      const current = counter.get(code) ?? { label, count: 0 };
      counter.set(code, {
        label: current.label || label,
        count: current.count + count,
      });
    }
  }

  return Array.from(counter.entries())
    .map(([code, value]) => ({
      code,
      label: value.label,
      count: value.count,
    }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

export function formatAutoTradeSkipReasonStats(
  stats: AutoTradeSkipReasonStat[],
  limit = 3
): string {
  const top = stats.filter((stat) => stat.count > 0).slice(0, limit);
  if (top.length === 0) return "없음";
  return top
    .map((stat) => `${stat.label} ${stat.count.toLocaleString("ko-KR")}건`)
    .join(" · ");
}

async function fetchTodayAutoTradeSkipReasonStats(
  supabase: SupabaseClient,
  startIso: string,
  endIso: string
): Promise<AutoTradeSkipReasonStat[]> {
  const { data, error } = await supabase
    .from("virtual_autotrade_runs")
    .select("summary")
    .gte("started_at", startIso)
    .lt("started_at", endIso)
    .limit(1000);
  if (error) return [];

  const summaries = (data ?? []).map((row) => {
    const rec = row as Record<string, unknown>;
    return (rec.summary ?? {}) as AutoTradeRunSummaryLike;
  });
  return aggregateAutoTradeSkipReasonStats(summaries);
}

function parsePositiveInt(raw: string | undefined): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const intValue = Math.floor(n);
  return intValue > 0 ? intValue : null;
}

export async function buildOpsStatusDigest(supabase: SupabaseClient): Promise<string> {
  const { startIso, endIso, ymd } = kstDayRangeIso();

  const [latestSectorAt, latestScoreAsof, queuedJobs, jobsToday, autoTradeRunsToday, autoTradeFailedToday, autoTradeSkipStats] =
    await Promise.all([
      fetchLatestValue(supabase, "sectors", "updated_at"),
      fetchLatestValue(supabase, "scores", "asof"),
      fetchQueuedJobsCount(supabase),
      fetchCountByRange(supabase, "jobs", "created_at", startIso, endIso),
      fetchCountByRange(supabase, "virtual_autotrade_runs", "started_at", startIso, endIso),
      fetchTodayAutoTradeFailedCount(supabase, startIso, endIso),
      fetchTodayAutoTradeSkipReasonStats(supabase, startIso, endIso),
    ]);

  const sectorFreshness = buildFreshnessLabel(latestSectorAt, 1);
  const scoreFreshness = buildFreshnessLabel(latestScoreAsof, 1);
  const staleWarning = isBusinessStale(latestSectorAt, 1) || isBusinessStale(latestScoreAsof, 1);

  const automationUsageEstimate = jobsToday + autoTradeRunsToday;
  const configuredBudget = parsePositiveInt(process.env.AUTOMATION_DAILY_BUDGET);
  const budgetLine = configuredBudget
    ? `- 자동화 처리량(추정): ${automationUsageEstimate.toLocaleString("ko-KR")}/${configuredBudget.toLocaleString("ko-KR")} (잔여 ${Math.max(0, configuredBudget - automationUsageEstimate).toLocaleString("ko-KR")})`
    : `- 자동화 처리량(추정): ${automationUsageEstimate.toLocaleString("ko-KR")}건 (큐 적재 ${jobsToday.toLocaleString("ko-KR")} + 자동매매 실행 ${autoTradeRunsToday.toLocaleString("ko-KR")})`;

  const staleLine = staleWarning
    ? "- 상태 경고: ⚠️ 데이터 갱신 지연이 감지되었습니다."
    : "- 상태 경고: 없음";
  const autoTradeSkipLine = `- 자동매매 스킵 상위: ${formatAutoTradeSkipReasonStats(autoTradeSkipStats)}`;

  return [
    "<b>📡 운영 상태 체크</b>",
    `- 기준일: ${ymd} (KST)`,
    `- 데이터 신선도: 섹터 ${sectorFreshness} · 점수 ${scoreFreshness}`,
    `- 가상자동매매: 오늘 실행 ${autoTradeRunsToday.toLocaleString("ko-KR")}회 (실패 ${autoTradeFailedToday.toLocaleString("ko-KR")}회)`,
    autoTradeSkipLine,
    `- 작업 큐 대기: ${queuedJobs.toLocaleString("ko-KR")}건`,
    budgetLine,
    staleLine,
    "<i>참고: 플랫폼의 실제 과금/할당 잔량은 API로 제공되지 않아 내부 처리량 기준 추정치를 제공합니다.</i>",
  ].join("\n");
}
