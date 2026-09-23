/**
 * 백테스트 공용 청산 시뮬레이터.
 * 자동매매 일일점검의 청산 판단(종가 기준)을 일봉으로 재현한다.
 * scripts/backtest_exit_params.ts(청산 규칙 비교)와 scripts/backtest_entry_signals.ts(진입 신호 비교)가 공유한다.
 */
import { calcATR } from "../../src/indicators/atr";
import { planAutoTradeExit } from "../../src/services/virtualAutoTradePositionStrategy";
import {
  resolveProfileStopCapPct,
  resolveProfitLockTrailingStop,
  resolveVolatilityAdjustedStopPct,
} from "../../src/services/virtualAutoTradeSelection";

export type Bar = { date: string; open: number; high: number; low: number; close: number; volume: number };
export type TradeResult = { pnlPct: number; holdDays: number; exitReason: string; mfePct: number };

/**
 *   legacy  : ATR 손절 상한 12% · 익절 ≥ 손절+1.5%p · 트레일링(+5% 이상에서 고점 -10%)
 *   rr      : legacy + 손익비 1.5 강제 (익절 상한 18%)
 *   capped  : rr + ATR 손절 확장 상한을 프로필 손절의 2.5배로 제한
 *   lock    : legacy + 수익잠금 트레일링
 *   lock+rr : lock + 손익비 1.5 강제
 *   lock+cap: lock + ATR 손절 확장 상한 (현재 운영 로직)
 *   new     : capped + lock
 */
export type RuleName = "legacy" | "rr" | "capped" | "lock" | "lock+rr" | "lock+cap" | "new";
export const ALL_RULES: RuleName[] = ["legacy", "rr", "capped", "lock", "lock+rr", "lock+cap", "new"];
/** 현재 운영 로직과 같은 청산 규칙 */
export const PRODUCTION_RULE: RuleName = "lock+cap";

const usesCap = (rule: RuleName) => rule === "capped" || rule === "lock+cap" || rule === "new";
const usesRr = (rule: RuleName) => rule === "rr" || rule === "capped" || rule === "lock+rr" || rule === "new";
const usesLock = (rule: RuleName) =>
  rule === "lock" || rule === "lock+rr" || rule === "lock+cap" || rule === "new";

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * 손익비 강제(연구용 비교 규칙). 익절폭 < 손절폭 × minRatio이면 익절을 올리고(상한 18%),
 * 그래도 부족하면 손절을 좁힌다. 운영 로직에는 채택하지 않았다(백테스트상 성과 악화).
 */
function enforceMinRewardRisk(input: { takeProfitPct: number; stopLossPct: number }, minRatio = 1.5, maxTp = 18) {
  let takeProfitPct = input.takeProfitPct;
  let stopLossPct = input.stopLossPct;
  if (takeProfitPct < stopLossPct * minRatio) takeProfitPct = Math.min(maxTp, stopLossPct * minRatio);
  if (takeProfitPct < stopLossPct * minRatio) stopLossPct = takeProfitPct / minRatio;
  return { takeProfitPct, stopLossPct };
}

/** resolveAdaptiveExitThreshold(virtualAutoTradeService.ts)의 신호 보정을 뺀 최종 클램프 단계 */
function resolveThresholds(rule: RuleName, baseTp: number, baseStop: number, atrPct: number | null) {
  const stop = resolveVolatilityAdjustedStopPct({
    baseStopLossPct: baseStop,
    atrPct,
    maxStopPct: usesCap(rule) ? resolveProfileStopCapPct(baseStop) : undefined,
  });
  const tp = clamp(baseTp, 3, 14);
  const sl = clamp(stop, 1.5, 12);
  if (usesRr(rule)) return enforceMinRewardRisk({ takeProfitPct: tp, stopLossPct: sl });
  return { takeProfitPct: tp < sl + 1.5 ? Math.min(14, sl + 1.5) : tp, stopLossPct: sl };
}

/**
 * bars[entryIdx] 시가에 진입해 매 세션 종가로 청산을 판단한다. maxHold 세션이 지나면 종가에 전량 정리.
 * 수익률은 왕복 비용(costPct)을 뺀 값이며, 분할 청산은 비중 가중 합산한다.
 */
export function simulateExit(
  rule: RuleName,
  bars: Bar[],
  entryIdx: number,
  opts: { baseTp: number; baseStop: number; maxHold: number; costPct: number }
): { result: TradeResult; exitIdx: number } | null {
  const entry = bars[entryIdx].open > 0 ? bars[entryIdx].open : bars[entryIdx].close;
  if (!(entry > 0)) return null;
  const history = bars.slice(Math.max(0, entryIdx - 40), entryIdx);
  const atr = calcATR(history.map((b) => ({ ...b, code: "", amount: 0 })));
  const { takeProfitPct, stopLossPct } = resolveThresholds(rule, opts.baseTp, opts.baseStop, atr?.atrPct ?? null);

  const UNITS = 100;
  let units = UNITS;
  let tranchesDone = 0;
  let peak = entry;
  let realized = 0; // Σ(청산 비중 × 수익률%)
  let mfePct = 0;
  let lastReason = "time-exit";

  const lastIdx = Math.min(bars.length - 1, entryIdx + opts.maxHold);
  for (let i = entryIdx; i <= lastIdx; i += 1) {
    const close = bars[i].close;
    if (!(close > 0)) continue;
    peak = Math.max(peak, close);
    const pnlPct = ((close - entry) / entry) * 100;
    mfePct = Math.max(mfePct, (((bars[i].high > 0 ? bars[i].high : close) - entry) / entry) * 100);

    const trailingBreached = usesLock(rule)
      ? resolveProfitLockTrailingStop({ buyPrice: entry, peakPrice: peak, currentPrice: close }).breached
      : pnlPct >= 5 && close < peak * 0.9;

    let sellUnits = 0;
    let reason = "";
    if (trailingBreached) {
      sellUnits = units;
      reason = "trailing";
    } else {
      const plan = planAutoTradeExit({
        quantity: units,
        pnlPct,
        takeProfitPct,
        stopLossPct,
        takeProfitSplitCount: 2,
        takeProfitTranchesDone: tranchesDone,
      });
      if (plan.action !== "HOLD") {
        sellUnits = plan.quantityToSell;
        reason = plan.reason;
        tranchesDone = plan.nextTakeProfitTranchesDone;
      }
    }
    if (i === lastIdx && sellUnits < units) {
      sellUnits = units;
      reason = reason || "time-exit";
    }
    if (sellUnits > 0) {
      realized += (sellUnits / UNITS) * (pnlPct - opts.costPct);
      units -= sellUnits;
      lastReason = reason;
    }
    if (units <= 0) {
      return {
        result: { pnlPct: realized, holdDays: i - entryIdx + 1, exitReason: lastReason, mfePct },
        exitIdx: i,
      };
    }
  }
  return null; // 데이터 부족으로 시뮬레이션 미완료
}

export type TradeSummary = {
  n: number;
  winRate: number;
  avgPnl: number;
  profitFactor: number;
  avgHold: number;
  capture: number;
  reasons: string;
};

export function summarizeTrades(results: TradeResult[]): TradeSummary | null {
  const n = results.length;
  if (!n) return null;
  const wins = results.filter((r) => r.pnlPct > 0);
  const losses = results.filter((r) => r.pnlPct <= 0);
  const grossWin = wins.reduce((s, r) => s + r.pnlPct, 0);
  const grossLoss = Math.abs(losses.reduce((s, r) => s + r.pnlPct, 0));
  const avg = results.reduce((s, r) => s + r.pnlPct, 0) / n;
  const avgHold = results.reduce((s, r) => s + r.holdDays, 0) / n;
  // 고점포착률: 보유 중 최대 수익(MFE) 합 대비 실현 수익 합 (승리 거래 기준)
  const winMfe = wins.reduce((s, r) => s + Math.max(0, r.mfePct), 0);
  const capture = winMfe > 0 ? grossWin / winMfe : 0;
  const reasons = new Map<string, number>();
  for (const r of results) reasons.set(r.exitReason, (reasons.get(r.exitReason) ?? 0) + 1);
  return {
    n,
    winRate: (wins.length / n) * 100,
    avgPnl: avg,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : Infinity,
    avgHold,
    capture: capture * 100,
    reasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", "),
  };
}
