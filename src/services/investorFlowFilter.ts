/**
 * 수급 이탈 매수 제외 필터.
 *
 * scripts/backtest_investor_flow.ts(2025-09~2026-09, 218종목): 최근 5일 외국인+기관 순매수 금액 / 20일 평균 거래대금을
 * 날짜별로 5분위로 나누면, 하위 20%(강한 순매도) 종목은 전반·후반 두 구간, 5·10·20일 보유 모두에서 같은 날 평균보다
 * 0.15~1.14%p 낮았다. 반대로 순매수 상위 종목의 초과수익은 구간마다 뒤집혀 매수 가점으로는 쓰지 않는다.
 * 시장 전체가 순매도인 날(연휴 전후 등)에 과하게 걸리지 않도록 절대값이 아니라 그날 상대 순위로 자른다.
 */
import { chunkValues, selectPaged } from "./supabasePaging";

type SupabaseClientAny = any;

export const FLOW_WINDOW_DAYS = 5;
/** 그날 점수 하위 이 비율이면서 순매도(점수<0)인 종목을 제외한다 */
export const HEAVY_NET_SELLING_BOTTOM_RATIO = 0.2;

export function computeFlowScore(input: {
  flows: Array<{ foreign: number; institution: number }>;
  avgTradedValue: number;
}): number | null {
  if (input.flows.length < FLOW_WINDOW_DAYS || !(input.avgTradedValue > 0)) return null;
  const sum = input.flows
    .slice(-FLOW_WINDOW_DAYS)
    .reduce((s, f) => s + (Number(f.foreign) || 0) + (Number(f.institution) || 0), 0);
  return sum / input.avgTradedValue;
}

/** 상대 순위 하위 bottomRatio이면서 순매도(점수<0)인 코드만 고른다 */
export function pickHeavyNetSelling(
  scores: Map<string, number>,
  bottomRatio = HEAVY_NET_SELLING_BOTTOM_RATIO
): Map<string, number> {
  const sorted = [...scores.entries()].sort((a, b) => a[1] - b[1]);
  const cutoffCount = Math.floor(sorted.length * bottomRatio);
  return new Map(sorted.slice(0, cutoffCount).filter(([, v]) => v < 0));
}

/**
 * 강한 순매도 종목 코드와 점수. 데이터가 부족한 종목은 제외하지 않는다.
 * 상대 순위를 매길 수 있도록 후보 전체(수십~수백 종목)를 넘긴다.
 */
export async function fetchHeavyNetSellingCodes(
  supabase: SupabaseClientAny,
  codes: string[]
): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  const unique = [...new Set(codes)].filter(Boolean);
  if (!unique.length) return scores;
  const since = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  for (const chunk of chunkValues(unique, 40)) {
    // 응답은 최대 1000행이라 limit(5000)이어도 잘린다. 날짜 오름차순이라 잘리면 가장 최근 며칠이 빠졌다
    // (2026-10-06 실측: 40종목 일봉이 9/29에서 끊겨 9/30~10/2 거래대금 누락). 끝까지 페이지로 받는다.
    const [flows, bars] = await Promise.all([
      selectPaged<any>(
        async (from, to) =>
          await supabase
            .from("investor_daily")
            .select("ticker, date, foreign_amount, institution_amount")
            .in("ticker", chunk)
            .gte("date", since)
            .order("ticker")
            .order("date", { ascending: true })
            .range(from, to),
        { logLabel: "investorFlowFilter.flows" }
      ).catch(() => [] as any[]),
      selectPaged<any>(
        async (from, to) =>
          await supabase
            .from("stock_daily")
            .select("ticker, date, close, volume")
            .in("ticker", chunk)
            .gte("date", since)
            .order("ticker")
            .order("date", { ascending: true })
            .range(from, to),
        { logLabel: "investorFlowFilter.bars" }
      ).catch(() => [] as any[]),
    ]);
    const flowBy = new Map<string, Array<{ foreign: number; institution: number }>>();
    for (const r of (flows ?? []) as any[]) {
      const list = flowBy.get(r.ticker) ?? [];
      list.push({ foreign: Number(r.foreign_amount ?? 0), institution: Number(r.institution_amount ?? 0) });
      flowBy.set(r.ticker, list);
    }
    const tvBy = new Map<string, number[]>();
    for (const r of (bars ?? []) as any[]) {
      const list = tvBy.get(r.ticker) ?? [];
      list.push(Number(r.close ?? 0) * Number(r.volume ?? 0));
      tvBy.set(r.ticker, list);
    }
    for (const code of chunk) {
      const tv = (tvBy.get(code) ?? []).slice(-20).filter((v) => v > 0);
      if (tv.length < 10) continue;
      const score = computeFlowScore({
        flows: flowBy.get(code) ?? [],
        avgTradedValue: tv.reduce((s, v) => s + v, 0) / tv.length,
      });
      if (score != null) scores.set(code, score);
    }
  }
  return pickHeavyNetSelling(scores);
}
