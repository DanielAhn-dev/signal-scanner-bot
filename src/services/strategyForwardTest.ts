/**
 * 전략 경쟁 측정(전향 검증) — 저장 없이 쌓이는 가격·점수 데이터로 매번 다시 계산한다.
 *
 * 과거 데이터가 짧아 백테스트만으로는 결론이 안 나므로, 같은 실데이터로 여러 전략을 동시에 굴려
 * 기준일 이후 실제로 이긴 전략을 채택한다. 기준일을 운영 시작일(2026-09-28)로 두면 순수 전향 검증,
 * 과거로 두면 백테스트다.
 *
 * 규칙: 주간 전략은 매주 첫 거래일 시가에 전 거래일 점수로 종목을 골라 다음 주 첫 거래일 시가까지 동일비중 보유.
 * 지수 코어는 전일 종가가 SMA100 위면 KODEX200, 아래면 CD금리. 주식 왕복비용 0.45%(편도 0.225%), ETF 편도 0.035%.
 */

export type DailyBar = { date: string; open: number; close: number; volume: number };
export type ScoreRow = { code: string; score: number };

export type StrategyName =
  | "index-core"
  | "kodex200-hold"
  | "cd-only"
  | "score-top5"
  | "score-top5+trend"
  | "score-top5+flow"
  | "momentum-top5";

export type StrategyResult = {
  name: StrategyName;
  label: string;
  totalReturnPct: number;
  maxDrawdownPct: number;
  periods: number;
};

export const STRATEGY_LABELS: Record<StrategyName, string> = {
  "index-core": "지수 추세 코어(SMA100)",
  "kodex200-hold": "KODEX200 보유",
  "cd-only": "CD금리만",
  "score-top5": "점수 상위5 주간교체",
  "score-top5+trend": "점수 상위5 + 시장추세",
  "score-top5+flow": "점수 상위5 + 수급이탈 제외",
  "momentum-top5": "모멘텀(60일) 상위5",
};

const STOCK_SIDE_COST = 0.00225;
const ETF_SIDE_COST = 0.00035;
const CD_ANNUAL = 0.028;

function sma(values: number[], end: number, window: number): number | null {
  if (end + 1 < window) return null;
  let s = 0;
  for (let i = end - window + 1; i <= end; i += 1) s += values[i];
  return s / window;
}

function maxDrawdown(equity: number[]): number {
  let peak = equity[0] ?? 1;
  let mdd = 0;
  for (const v of equity) {
    peak = Math.max(peak, v);
    mdd = Math.min(mdd, v / peak - 1);
  }
  return mdd * 100;
}

/** 지수 코어·보유·CD: 일별 */
export function simulateIndexStrategies(input: {
  index: DailyBar[]; // KODEX200 (시작 전 100봉 이상 포함)
  startDate: string;
}): StrategyResult[] {
  const bars = input.index.filter((b) => b.close > 0);
  const closes = bars.map((b) => b.close);
  const startIdx = bars.findIndex((b) => b.date >= input.startDate);
  if (startIdx < 1) return [];
  const cdDaily = (1 + CD_ANNUAL) ** (1 / 250) - 1;
  const eq = { core: [1], hold: [1], cd: [1] };
  let inIndex = false;
  for (let i = startIdx; i < bars.length; i += 1) {
    const ret = bars[i].close / bars[i - 1].close - 1;
    const m = sma(closes, i - 1, 100);
    const wantIndex = m != null && closes[i - 1] > m;
    const switchCost = wantIndex !== inIndex ? ETF_SIDE_COST * 2 : 0;
    inIndex = wantIndex;
    const last = (k: keyof typeof eq) => eq[k][eq[k].length - 1];
    eq.core.push(last("core") * (1 + (inIndex ? ret : cdDaily) - switchCost));
    eq.hold.push(last("hold") * (1 + ret));
    eq.cd.push(last("cd") * (1 + cdDaily));
  }
  const n = bars.length - startIdx;
  const mk = (name: StrategyName, e: number[]): StrategyResult => ({
    name,
    label: STRATEGY_LABELS[name],
    totalReturnPct: (e[e.length - 1] - 1) * 100,
    maxDrawdownPct: maxDrawdown(e),
    periods: n,
  });
  return [mk("index-core", eq.core), mk("kodex200-hold", eq.hold), mk("cd-only", eq.cd)];
}

/** 주간 교체 전략 */
export function simulateWeeklyStrategy(input: {
  name: StrategyName;
  rebalanceDates: string[]; // 오름차순 거래일(각 주 첫 거래일)
  pick: (rebalanceDate: string) => string[]; // 그날 시가에 살 종목 (빈 배열이면 CD금리)
  barsByCode: Map<string, Map<string, DailyBar>>;
  topN?: number;
}): StrategyResult {
  const cdWeekly = (1 + CD_ANNUAL) ** (1 / 52) - 1;
  const equity = [1];
  let prev = new Set<string>();
  for (let w = 0; w + 1 < input.rebalanceDates.length; w += 1) {
    const d0 = input.rebalanceDates[w];
    const d1 = input.rebalanceDates[w + 1];
    const picks = input.pick(d0).slice(0, input.topN ?? 5);
    const rets: number[] = [];
    for (const code of picks) {
      const b0 = input.barsByCode.get(code)?.get(d0);
      const b1 = input.barsByCode.get(code)?.get(d1);
      const p0 = b0 && b0.open > 0 ? b0.open : b0?.close;
      const p1 = b1 && b1.open > 0 ? b1.open : b1?.close;
      if (!(p0 && p0 > 0) || !(p1 && p1 > 0)) continue;
      rets.push(p1 / p0 - 1);
    }
    const next = new Set(picks);
    const turnover = picks.length
      ? ([...next].filter((c) => !prev.has(c)).length + [...prev].filter((c) => !next.has(c)).length) / (2 * Math.max(picks.length, 1))
      : prev.size ? 0.5 : 0;
    const gross = rets.length ? rets.reduce((s, r) => s + r, 0) / rets.length : cdWeekly;
    equity.push(equity[equity.length - 1] * (1 + gross - turnover * 2 * STOCK_SIDE_COST));
    prev = next;
  }
  return {
    name: input.name,
    label: STRATEGY_LABELS[input.name],
    totalReturnPct: (equity[equity.length - 1] - 1) * 100,
    maxDrawdownPct: maxDrawdown(equity),
    periods: equity.length - 1,
  };
}

/** 각 주의 첫 거래일 */
export function firstTradingDaysOfWeeks(dates: string[]): string[] {
  const out: string[] = [];
  let lastWeek = "";
  for (const d of [...dates].sort()) {
    const dt = new Date(`${d}T00:00:00Z`);
    const monday = new Date(dt.getTime() - ((dt.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
    if (monday !== lastWeek) {
      out.push(d);
      lastWeek = monday;
    }
  }
  return out;
}

export function formatForwardTestReport(input: { startDate: string; endDate: string; results: StrategyResult[] }): string {
  const sorted = [...input.results].sort((a, b) => b.totalReturnPct - a.totalReturnPct);
  const lines = [`[전략 경쟁 측정] ${input.startDate} ~ ${input.endDate}`];
  sorted.forEach((r, i) => {
    lines.push(
      `${i + 1}. ${r.label}: ${r.totalReturnPct >= 0 ? "+" : ""}${r.totalReturnPct.toFixed(1)}% · 최대낙폭 ${r.maxDrawdownPct.toFixed(1)}%`
    );
  });
  return lines.join("\n");
}
