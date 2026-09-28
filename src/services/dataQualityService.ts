/**
 * 데이터 품질 일일 검사 — 무결성 점검(integrityAudit) 리포트에 붙는다.
 *
 * 2026-09에 몇 주씩 모르고 지나간 문제들을 그대로 검사 항목으로 삼았다.
 *   - 일봉·수급 수집률 (최신 거래일 기준)
 *   - 점수 기준일이 최신 일봉과 같은지, 엔진 팩터가 붙었는지 (09-23~25 엔진 전 종목 스킵)
 *   - 가격제한폭(±30%)을 넘는 연속 거래일 점프 = 수정주가 혼재 (티엘비 -56% 등)
 *   - 휴장일 날짜 행 (추석·공휴일에 복제 저장된 신호·점수)
 */
import { isKrxTradingDate, toKstDateKey } from "../lib/krxCalendar";
import { chunkValues } from "./supabasePaging";

type SupabaseClientAny = any;

export type DataQualityReport = {
  issues: string[];
  summary: string;
};

/** 제한폭 30% + 사후 수정주가 오차 여유 (backfill.py PRICE_LIMIT_JUMP와 동일) */
const PRICE_LIMIT_JUMP = 0.35;

export function findLimitBreakingJumps(
  closesByTicker: Map<string, Array<{ date: string; close: number }>>,
  calendar: string[]
): Array<{ ticker: string; date: string; pct: number }> {
  const next = new Map(calendar.map((d, i) => [d, calendar[i + 1]]));
  const out: Array<{ ticker: string; date: string; pct: number }> = [];
  for (const [ticker, rows] of closesByTicker) {
    const byDate = new Map(rows.map((r) => [r.date, r.close]));
    for (const r of rows) {
      const d1 = next.get(r.date);
      const c1 = d1 ? byDate.get(d1) : undefined;
      if (!d1 || !c1 || !(r.close > 0) || !(c1 > 0)) continue;
      const pct = c1 / r.close - 1;
      if (Math.abs(pct) > PRICE_LIMIT_JUMP) out.push({ ticker, date: d1, pct: pct * 100 });
    }
  }
  return out;
}

async function count(supabase: SupabaseClientAny, table: string, column: string, value: string): Promise<number> {
  const { count: n } = await supabase.from(table).select(column, { count: "exact", head: true }).eq(column, value);
  return Number(n ?? 0);
}

export async function checkDataQuality(supabase: SupabaseClientAny): Promise<DataQualityReport> {
  const issues: string[] = [];

  const { data: stocks } = await supabase
    .from("stocks")
    .select("code")
    .in("universe_level", ["core", "extended"])
    .eq("is_active", true);
  const universe = ((stocks ?? []) as Array<{ code: string }>).map((s) => String(s.code));
  const universeSize = universe.length;

  const { data: calRows } = await supabase
    .from("stock_daily")
    .select("date")
    .eq("ticker", "005930")
    .order("date", { ascending: false })
    .limit(16);
  const calendar = ((calRows ?? []) as Array<{ date: string }>).map((r) => String(r.date).slice(0, 10)).reverse();
  const latestPrice = calendar[calendar.length - 1];
  if (!latestPrice) return { issues: ["일봉 기준일 확인 불가"], summary: "❌ 데이터 품질: 일봉 기준일 확인 불가" };

  // 1) 수집률
  const priceCount = await count(supabase, "stock_daily", "date", latestPrice);
  if (universeSize > 0 && priceCount < universeSize * 0.95) {
    issues.push(`일봉 수집률 ${priceCount}/${universeSize} (${latestPrice})`);
  }
  const { data: invLatest } = await supabase.from("investor_daily").select("date").order("date", { ascending: false }).limit(1);
  const investorDate = String((invLatest?.[0] as { date?: string } | undefined)?.date ?? "").slice(0, 10);
  if (investorDate !== latestPrice) {
    issues.push(`수급 기준일 ${investorDate || "없음"} ≠ 일봉 ${latestPrice}`);
  } else {
    const invCount = await count(supabase, "investor_daily", "date", investorDate);
    if (universeSize > 0 && invCount < universeSize * 0.8) issues.push(`수급 수집률 ${invCount}/${universeSize}`);
  }

  // 2) 점수 기준일·엔진 팩터
  const { data: scoreLatest } = await supabase.from("scores").select("asof").order("asof", { ascending: false }).limit(1);
  const scoreAsof = String((scoreLatest?.[0] as { asof?: string } | undefined)?.asof ?? "").slice(0, 10);
  let engineRatioText = "";
  if (scoreAsof !== latestPrice) {
    issues.push(`점수 기준일 ${scoreAsof || "없음"} ≠ 일봉 ${latestPrice}`);
  } else {
    const { data: scoreRows } = await supabase.from("scores").select("factors").eq("asof", scoreAsof).limit(2000);
    const rows = (scoreRows ?? []) as Array<{ factors?: Record<string, unknown> | null }>;
    const withEngine = rows.filter((r) => String(r.factors?.score_source ?? "").includes("engine")).length;
    engineRatioText = ` · 엔진팩터 ${withEngine}/${rows.length}`;
    if (rows.length > 0 && withEngine < rows.length * 0.8) {
      issues.push(`엔진 팩터 누락: ${withEngine}/${rows.length}종목만 엔진 팩터 보유 (${scoreAsof})`);
    }
  }

  // 3) 가격제한폭 초과 점프 (최근 15거래일)
  const closesByTicker = new Map<string, Array<{ date: string; close: number }>>();
  for (const chunk of chunkValues(universe, 60)) {
    const { data } = await supabase
      .from("stock_daily")
      .select("ticker, date, close")
      .in("ticker", chunk)
      .gte("date", calendar[0])
      .limit(5000);
    for (const r of (data ?? []) as Array<{ ticker: string; date: string; close: number }>) {
      const list = closesByTicker.get(r.ticker) ?? [];
      list.push({ date: String(r.date).slice(0, 10), close: Number(r.close) });
      closesByTicker.set(r.ticker, list);
    }
  }
  const jumps = findLimitBreakingJumps(closesByTicker, calendar);
  if (jumps.length) {
    issues.push(
      `수정주가 불일치 의심 ${jumps.length}건: ${jumps
        .slice(0, 3)
        .map((j) => `${j.ticker}@${j.date.slice(5)} ${j.pct.toFixed(0)}%`)
        .join(", ")} (다음 배치가 자동 재수집)`
    );
  }

  // 4) 휴장일 날짜 행 (최근 60일)
  const today = toKstDateKey();
  const holidays: string[] = [];
  for (let t = Date.parse(`${today}T00:00:00Z`) - 60 * 86_400_000; t <= Date.parse(`${today}T00:00:00Z`); t += 86_400_000) {
    const d = new Date(t);
    const key = d.toISOString().slice(0, 10);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !isKrxTradingDate(key) && key < today) holidays.push(key);
  }
  const holidayHits: string[] = [];
  for (const [table, column] of [
    ["stock_daily", "date"],
    ["scores", "asof"],
    ["pullback_signals", "trade_date"],
  ] as const) {
    for (const d of holidays) {
      const n = await count(supabase, table, column, d);
      if (n > 0) holidayHits.push(`${table} ${d.slice(5)} ${n}행`);
    }
  }
  if (holidayHits.length) issues.push(`휴장일 날짜 데이터: ${holidayHits.slice(0, 4).join(", ")}`);

  const summary = issues.length
    ? `❌ 데이터 품질 이상 ${issues.length}건 (${latestPrice})\n${issues.map((i) => `- ${i}`).join("\n")}`
    : `✅ 데이터 품질 정상 · 일봉 ${priceCount}/${universeSize} · 점수 ${scoreAsof}${engineRatioText} · 가짜 점프 0 · 휴장일 행 0`;
  return { issues, summary };
}
