/**
 * 보유 종목 한 건의 매도 판단 — 일일점검이 보유 종목마다 호출한다. DB·API 없이 계산만 한다.
 * 판단 결과를 실제 매도(executeAutoTradeSell)·보유 유지 기록으로 옮기는 일은 호출측(runDailyReviewForUser)이 맡는다.
 *
 * 판단 순서 (앞에서 결정되면 뒤는 보지 않는다):
 *   1) 수익잠금 트레일링 이탈 → 전량 익절
 *   2) 방어 레짐의 코스닥 +1% 초과 (추세 신호가 보유일 때) → 전량 익절
 *   3) 추세·신호 이탈 (detectTrendBreakExitSignal) → 전량 손절/익절
 *   4) 기본 손절/분할 익절 (planAutoTradeExit, 변동성·레짐 보정 기준)
 *   5) 위에서 보유면: 시간손절 → 비중 초과 → 섹터 등급 하락 → 예정 검토일 순으로 추가 점검
 */
import { calcATR } from "../indicators/atr";
import type { ScoreSnapshotRow } from "./scoreSourceService";
import {
  evaluatePlannedReviewExit,
  evaluateSectorRotationExit,
  evaluateTimeStop,
  planAutoTradeExit,
  planOverweightReduction,
  type PlannedAutoTradeExit,
} from "./virtualAutoTradePositionStrategy";
import {
  resolveProfileStopCapPct,
  resolveProfitLockTrailingStop,
  resolveVolatilityAdjustedStopPct,
  type AutoTradeMarketPolicy,
} from "./virtualAutoTradeSelection";
import { detectTrendBreakExitSignal, evaluateAutoTradeSignalGate } from "./virtualAutoTradeSignalGate";

/** 단일 종목이 포트폴리오의 이 비중을 넘으면 분할 매도 */
export const MAX_WEIGHT_PCT = 25;
/** 비중 초과 분할 매도의 목표 비중 */
export const TARGET_WEIGHT_PCT = 20;

type TrendExitSignal = ReturnType<typeof detectTrendBreakExitSignal>;

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fmtKrw(value: number): string {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

export function extractScoreFactors(factors: unknown): Record<string, unknown> | null {
  if (!factors || typeof factors !== "object" || Array.isArray(factors)) {
    return null;
  }
  return factors as Record<string, unknown>;
}

/** 종목 신호·시장 레짐·현재 수익률로 익절/손절 기준을 조정한다 */
export function resolveAdaptiveExitThreshold(input: {
  takeProfitPct: number;
  stopLossPct: number;
  signal?: string | null;
  market?: string | null;
  marketPolicy: Pick<AutoTradeMarketPolicy, "mode">;
  pnlPct: number;
}): {
  takeProfitPct: number;
  stopLossPct: number;
} {
  let takeProfitPct = Math.max(2, Math.abs(toNumber(input.takeProfitPct, 8)));
  let stopLossPct = Math.max(1, Math.abs(toNumber(input.stopLossPct, 4)));
  const signal = String(input.signal ?? "").trim().toUpperCase();
  const market = String(input.market ?? "").trim().toUpperCase();

  if (input.marketPolicy.mode === "rotation" && (signal === "BUY" || signal === "STRONG_BUY")) {
    takeProfitPct += 1.2;
    stopLossPct += 0.3;
  }

  if (signal === "STRONG_BUY") {
    takeProfitPct += 0.8;
    stopLossPct += 0.2;
  } else if (signal === "SELL") {
    takeProfitPct -= 1.2;
    stopLossPct -= 0.4;
  } else if (signal === "STRONG_SELL") {
    takeProfitPct -= 2.2;
    stopLossPct -= 0.8;
  }

  if (input.marketPolicy.mode === "large-cap-defense") {
    takeProfitPct -= 0.8;
    stopLossPct -= 0.3;
    if (market === "KOSDAQ") {
      takeProfitPct -= 0.7;
      stopLossPct -= 0.3;
    }
  }

  if (input.pnlPct >= Math.max(2, takeProfitPct * 0.5) && (signal === "BUY" || signal === "STRONG_BUY")) {
    takeProfitPct += 0.6;
  }

  takeProfitPct = Number(clamp(takeProfitPct, 3, 14).toFixed(1));
  // 상한 12: ATR 기반 변동성 확장(resolveVolatilityAdjustedStopPct)이 여기서 다시 깎이지 않도록.
  stopLossPct = Number(clamp(stopLossPct, 1.5, 12).toFixed(1));
  // 손익비 1.5 강제(익절 상향)도 검토했으나 백테스트(scripts/backtest_exit_params.ts, 2026-03~09
  // pullback A 신호 1.7천건)에서 모든 파라미터 조합에 대해 익절 도달률이 떨어져 성과가 악화됐다.
  // 손익비는 손절 확장 상한(resolveProfileStopCapPct)과 수익잠금 트레일링으로 관리한다.
  if (takeProfitPct < stopLossPct + 1.5) {
    takeProfitPct = Number(Math.min(14, stopLossPct + 1.5).toFixed(1));
  }

  return {
    takeProfitPct,
    stopLossPct,
  };
}

export type HoldingExitInput = {
  holding: {
    code: string;
    buy_date?: string | null;
    created_at?: string | null;
    planned_review_at?: string | null;
  };
  qty: number;
  buyPrice: number;
  close: number;
  /** resolvePositionTradeProfile 결과 (이벤트 리스크 가드와 같이 쓰려고 호출측이 먼저 계산한다) */
  tradeProfile: {
    profile: string;
    takeProfitPct: number;
    stopLossPct: number;
    takeProfitSplitCount: number;
    expectedHorizonDays: number;
  };
  /** parsePositionStrategyState 결과 */
  strategyState: { takeProfitTranchesDone: number; peakPrice: number | null; halfStopDone?: boolean };
  scoreRow: Pick<ScoreSnapshotRow, "total_score" | "signal" | "factors"> | undefined;
  market: string;
  marketPolicy: Pick<AutoTradeMarketPolicy, "mode">;
  /** 일봉 이력 (ATR 계산용, 오래된 순) */
  priceHistory: Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>;
  /** 보유 유지 오버라이드에 필요한 최소 신뢰점수의 기준 (리밸런싱 임계값) */
  rebalanceTrustThreshold: number;
  totalPortfolioValue: number;
  sectorId: string | undefined;
  sectorGrade: "A" | "B" | "C" | undefined;
  isSectorLeader: boolean;
  now?: Date;
};

export type HoldingExitDecision = {
  pnlPct: number;
  signal: string | null;
  adaptiveExitThreshold: { takeProfitPct: number; stopLossPct: number };
  trendExitSignal: TrendExitSignal;
  /** 추가 점검(시간손절 등) 전의 판단 */
  exitPlan: PlannedAutoTradeExit;
  /** 최종 판단 — HOLD면 보유 유지 */
  finalExitPlan: PlannedAutoTradeExit;
  prevPeak: number | null;
  updatedPeakPrice: number;
  /** 예정 검토일을 연장했으면 새 검토일 */
  plannedReviewExtensionAt: string | null;
  /** 알림에 붙일 매도 이유 (없으면 빈 문자열) */
  exitReasonLabel: string;
  /** 손절이면 그 맥락 (거래 로그용) */
  stopLossContext: string | null;
};

export function decideHoldingExit(input: HoldingExitInput): HoldingExitDecision {
  const { holding, qty, buyPrice, close, tradeProfile, strategyState, scoreRow, marketPolicy } = input;
  const pnlPct = ((close - buyPrice) / buyPrice) * 100;
  const signal = scoreRow?.signal ?? null;
  const factors = extractScoreFactors(scoreRow?.factors);
  // 점수 테이블의 종합점수는 total_score다. 예전엔 없는 필드(score)를 읽어 항상 비어 있었다 —
  // 보유 유지 오버라이드 신뢰점수가 0점 기준으로 깎였고, 예정 검토일은 점수를 "모름"으로 보고 신호만으로 연장했다.
  const totalScore = scoreRow?.total_score ?? null;

  // 변동성(ATR%) 기반 손절폭 보정: 고정 손절폭이 종목 일봉 변동성보다 좁으면
  // 정상 노이즈에도 끊기므로, ATR% 기반 하한을 적용한다.
  const atr = calcATR(input.priceHistory.map((row) => ({ ...row, code: holding.code, amount: 0 })));
  const volatilityAdjustedStopLossPct = resolveVolatilityAdjustedStopPct({
    baseStopLossPct: tradeProfile.stopLossPct,
    atrPct: atr?.atrPct ?? null,
    maxStopPct: resolveProfileStopCapPct(tradeProfile.stopLossPct),
  });
  const adaptiveExitThreshold = resolveAdaptiveExitThreshold({
    takeProfitPct: tradeProfile.takeProfitPct,
    stopLossPct: volatilityAdjustedStopLossPct,
    signal,
    market: input.market,
    marketPolicy,
    pnlPct,
  });
  const isValueSwing = tradeProfile.profile === "VALUE_SWING_CORE";
  const baseExitPlan = planAutoTradeExit({
    quantity: qty,
    pnlPct,
    takeProfitPct: adaptiveExitThreshold.takeProfitPct,
    stopLossPct: adaptiveExitThreshold.stopLossPct,
    takeProfitSplitCount: tradeProfile.takeProfitSplitCount,
    takeProfitTranchesDone: strategyState.takeProfitTranchesDone,
    // 가치투자+스윙(VALUE_SWING_CORE)은 단기 노이즈에 흔들리지 않도록 경직 손절선을 넓게 적용
    catastrophicStopPct: isValueSwing ? 15 : 10,
    halfExitStopPct: isValueSwing ? 12 : 7,
    halfStopDone: strategyState.halfStopDone ?? false,
  });

  // 수익잠금 트레일링: 보유 중 최고가(종가 기준) 추적 → 고점 수익의 일정 비율 아래로 밀리면 청산
  const prevPeak = strategyState.peakPrice;
  const updatedPeakPrice = prevPeak != null ? Math.max(prevPeak, close) : close;
  const profitLock = resolveProfitLockTrailingStop({ buyPrice, peakPrice: updatedPeakPrice, currentPrice: close });

  // 시장 레짐이 대형주 방어 모드일 때 KOSDAQ 보유 종목의 익절 기준 선제 적용
  const regimeEarlyExit = marketPolicy.mode === "large-cap-defense" && input.market.toUpperCase() === "KOSDAQ" && pnlPct > 1.0;
  const trendExitSignal = detectTrendBreakExitSignal({
    currentPrice: close,
    pnlPct,
    factors,
    signal,
    trustScore: evaluateAutoTradeSignalGate({
      currentPrice: close,
      score: toNumber(totalScore, 0),
      factors,
      minTrustScore: input.rebalanceTrustThreshold,
      requireAboveSma200: false,
    }).trustScore,
    minTrustForOverride: Math.max(input.rebalanceTrustThreshold, 72),
  });

  const fullExit = (action: "TAKE_PROFIT" | "STOP_LOSS"): PlannedAutoTradeExit =>
    action === "STOP_LOSS"
      ? { action, quantityToSell: qty, isPartial: false, nextTakeProfitTranchesDone: strategyState.takeProfitTranchesDone, reason: "stop-loss" }
      : { action, quantityToSell: qty, isPartial: false, nextTakeProfitTranchesDone: strategyState.takeProfitTranchesDone, reason: "take-profit-final" };
  const exitPlan: PlannedAutoTradeExit = profitLock.breached
    ? fullExit("TAKE_PROFIT")
    : regimeEarlyExit && trendExitSignal.exitAction === "HOLD"
      ? fullExit("TAKE_PROFIT")
      : trendExitSignal.exitAction === "STOP_LOSS"
        ? fullExit("STOP_LOSS")
        : trendExitSignal.exitAction === "TAKE_PROFIT"
          ? fullExit("TAKE_PROFIT")
          : baseExitPlan;

  // 가치투자 스윙(VALUE_SWING_CORE)은 단기 물림을 장기 손실로 오판하지 않도록 시간손절 기준을 늘림
  const timeStopParams = isValueSwing ? { phase1Days: 60, phase2Days: 90, lossThresholdPct: -15 } : {};
  const timeStop = evaluateTimeStop({
    quantity: qty,
    pnlPct,
    buyDate: holding.buy_date ?? holding.created_at,
    now: input.now,
    ...timeStopParams,
  });

  let plannedReviewExtensionAt: string | null = null;
  let plannedReviewExitTriggered = false;

  // 비중 초과·시간 손절 등은 앞 단계가 보유(HOLD)로 판단한 경우에만 본다
  const finalExitPlan: PlannedAutoTradeExit = (() => {
    if (exitPlan.action !== "HOLD") return exitPlan;

    // 1) 시간 기반 손절 (Time-Stop): 장기 물림 손실 종목 단계적 정리
    if (timeStop.triggered) {
      return {
        action: timeStop.phase === "full" ? "STOP_LOSS" : "TAKE_PROFIT",
        quantityToSell: timeStop.quantityToSell,
        isPartial: timeStop.phase === "partial",
        nextTakeProfitTranchesDone: strategyState.takeProfitTranchesDone,
        reason: timeStop.phase === "full" ? "stop-loss" : pnlPct >= 0 ? "take-profit-partial" : "loss-trim",
      } as PlannedAutoTradeExit;
    }

    // 2) 비중 초과 감지: 포트폴리오 내 단일 종목 비중이 MAX_WEIGHT_PCT 초과 시 분할 매도
    if (input.totalPortfolioValue <= 0) return exitPlan;
    const currentWeightPct = ((close * qty) / input.totalPortfolioValue) * 100;
    if (currentWeightPct > MAX_WEIGHT_PCT) {
      return planOverweightReduction({
        currentWeightPct,
        maxWeightPct: MAX_WEIGHT_PCT,
        targetWeightPct: TARGET_WEIGHT_PCT,
        quantity: qty,
        currentPrice: close,
        totalPortfolioValue: input.totalPortfolioValue,
        takeProfitTranchesDone: strategyState.takeProfitTranchesDone,
      });
    }

    // 3) 섹터 강도 하락 리밸런싱: 섹터가 Grade C로 하락 + 손실 -3% 이내 → 전량 매도
    // 섹터 리더는 예외 (대표주는 섹터 부진에도 보유 유지)
    const sectorRotation = evaluateSectorRotationExit({
      quantity: qty,
      pnlPct,
      isSectorLeader: input.isSectorLeader,
      sectorGrade: input.sectorId ? input.sectorGrade : undefined,
      buyDate: holding.buy_date ?? holding.created_at,
      now: input.now,
    });
    if (sectorRotation.triggered) {
      return {
        action: "SECTOR_ROTATION",
        quantityToSell: sectorRotation.quantityToSell,
        isPartial: false,
        nextTakeProfitTranchesDone: strategyState.takeProfitTranchesDone,
        reason: "sector-rotation",
        sectorGrade: "C",
      } as PlannedAutoTradeExit;
    }

    // 4) 예정 검토일(planned_review_at) 도달: 매수 시점에 세운 기대 보유기간이 끝났는데도
    // 목표수익에 못 미치면, 자본을 무기한 묶어두지 않고 정리하거나(모멘텀 소진) 검토일을
    // 연장한다(신호가 아직 살아있음).
    const reviewResult = evaluatePlannedReviewExit({
      plannedReviewAt: holding.planned_review_at,
      pnlPct,
      takeProfitPct: adaptiveExitThreshold.takeProfitPct,
      signal,
      score: totalScore,
      quantity: qty,
      takeProfitTranchesDone: strategyState.takeProfitTranchesDone,
      expectedHorizonDays: tradeProfile.expectedHorizonDays,
      now: input.now,
    });
    if (reviewResult.action === "extend") {
      plannedReviewExtensionAt = reviewResult.nextReviewAt;
    } else if (reviewResult.action === "exit") {
      plannedReviewExitTriggered = true;
      return reviewResult.plan;
    }

    return exitPlan;
  })();

  const exitReasonLabel: string = (() => {
    if (finalExitPlan.action === "HOLD") return "";
    if (plannedReviewExitTriggered) return `[예정검토일 도달] 기대 보유기간 종료 + 목표 미달 · 수익률 ${pnlPct.toFixed(2)}% → 정리`;
    if (profitLock.breached) return `[수익잠금 익절] 고점(${fmtKrw(updatedPeakPrice)}, +${profitLock.peakGainPct.toFixed(1)}%) 대비 잠금선 +${(profitLock.lockedGainPct ?? 0).toFixed(1)}% 이탈 · 수익률 ${pnlPct.toFixed(2)}%`;
    if (trendExitSignal.reason === "signal-strong-sell") return "[신호청산] STRONG_SELL 전환";
    if (trendExitSignal.reason === "signal-sell") return pnlPct > 0 ? "[신호익절] SELL 전환 + 수익 중" : "[신호손절] SELL 전환 + 손실 구간";
    if (trendExitSignal.reason === "trend-break-sma200") return "[추세이탈] SMA200 하향이탈";
    if (trendExitSignal.reason === "trend-break-sma50") return "[추세익절] SMA50 하향이탈";
    if (regimeEarlyExit) return "[레짐익절] 방어모드 KOSDAQ 선익절";
    // 시간손절: 앞 단계는 보유였는데 추가 점검에서 매도로 바뀐 경우
    if (exitPlan.action === "HOLD" && (finalExitPlan.action === "STOP_LOSS" || finalExitPlan.action === "TAKE_PROFIT") && timeStop.triggered) {
      return `[시간손절] ${timeStop.reason}`;
    }
    if (finalExitPlan.action === "OVERWEIGHT_REDUCTION") {
      const currentWeightPct = input.totalPortfolioValue > 0 ? (((close * qty) / input.totalPortfolioValue) * 100).toFixed(1) : "?";
      return `[비중조정] ${currentWeightPct}% 초과 → ${(finalExitPlan as { targetWeightPct: number }).targetWeightPct}%로 분할 매도`;
    }
    if (finalExitPlan.action === "SECTOR_ROTATION") {
      return `[섹터리밸런싱] 섹터 Grade C 하락(${input.sectorId ?? "미분류"}) · 손익률 ${pnlPct.toFixed(2)}% → 비손실 청산`;
    }
    return "";
  })();

  const stopLossContext: string | null = (() => {
    if (finalExitPlan.action !== "STOP_LOSS") return null;
    if (plannedReviewExitTriggered) return "planned-review-miss";
    if (trendExitSignal.reason === "signal-strong-sell") return "signal-strong-sell";
    if (trendExitSignal.reason === "signal-sell") return "signal-reversal";
    if (trendExitSignal.reason === "trend-break-sma200") return "trend-break-major";
    if (trendExitSignal.reason === "trend-break-sma50") return "trend-break-minor";
    return "hard-stop";
  })();

  return {
    pnlPct,
    signal,
    adaptiveExitThreshold,
    trendExitSignal,
    exitPlan,
    finalExitPlan,
    prevPeak,
    updatedPeakPrice,
    plannedReviewExtensionAt,
    exitReasonLabel,
    stopLossContext,
  };
}
