import { createClient } from "@supabase/supabase-js";
import { PORTFOLIO_TABLES } from "../db/portfolioSchema";
import {
  applyFifoSale,
  appendTradeLotsForHolding,
  ensureTradeLotsForHolding,
  previewFifoSale,
  replaceTradeLotsForHolding,
} from "./virtualLotService";
import {
  getUserInvestmentPrefs,
  setUserInvestmentPrefs,
} from "./userService";
import { syncVirtualPortfolio } from "./portfolioService";
import { buildStrategyMemo } from "../lib/strategyMemo";
import { parseStrategyMemo } from "../lib/strategyMemo";
import { appendVirtualDecisionLog } from "./decisionLogService";
import { calculateAutoTradeBuySizing } from "./virtualAutoTradeSizing";
import {
  applyDynamicTradeProfileAdjustments,
  classifyAutoTradeEntryProfile,
  buildPositionStrategyMemo,
  evaluateTimeStop,
  parsePositionStrategyState,
  planAutoTradeExit,
  planOverweightReduction,
  resolvePositionBucketFromProfile,
  resolvePositionTradeProfile,
  type PlannedAutoTradeExit,
} from "./virtualAutoTradePositionStrategy";
import {
  applyStrategyBuyConstraint,
  deriveEntryProfile,
  detectAutoTradeMarketPolicy,
  isActionableTodayBuySignal,
  pickAutoTradeAddOnCandidates,
  pickAutoTradeCandidates,
  resolveDeployableCash,
  selectRunType,
  type AutoTradeCandidateSelectionResult,
  type AutoTradeMarketPolicy,
  type AutoTradeRunMode as SelectionAutoTradeRunMode,
  type AutoTradeRunType,
  type RankedCandidate,
} from "./virtualAutoTradeSelection";
import { fetchLatestPullbackCandidateCodes } from "./virtualAutoTradePullbackIntegration";
import { discoverMultibaggerCandidates } from "./discoveryService";
import { computeAutoTradePacingMetrics } from "./virtualAutoTradePacingService";
import {
  fetchRealtimePriceBatch,
  type RealtimeStockData,
} from "../utils/fetchRealtimePrice";
import { describeScanFilterReasons } from "../bot/commands/scanFilters";
import { fetchAllMarketData } from "../utils/fetchMarketData";
import { fetchLatestScoresByCodes } from "./scoreSourceService";
import {
  detectTrendBreakExitSignal,
  evaluateAutoTradeSignalGate,
} from "./virtualAutoTradeSignalGate";
import { sendMessage } from "../telegram/api";
import { actionButtons } from "../bot/messages/layout";
import {
  isKrxIntradayAutoTradeWindow,
  kstDateKey,
  kstWindowKey,
} from "./virtualAutoTradeTiming";
import {
  buildAutoTradeExecutionButtons,
  pickExecutionLines,
} from "./virtualAutoTradeAlert";
import {
  buildAutoTradeSkipReasonStats,
  type AutoTradeSkipReasonStat,
} from "./virtualAutoTradeObservability";
import { runLongTermCoachForChat } from "./longTermCoachService";
import {
  fetchStrategyGateState,
  upsertStrategyGateState,
  resolveStrategyGateStatus,
} from "./strategyGateStateService";
import { businessDaysBehind } from "../utils/dataFreshness";
import { fetchStockNews } from "../utils/fetchNews";
import { analyzeNewsSentiment, analyzeOrderIntakeSignal } from "../lib/newsSentiment";

type RunMode = SelectionAutoTradeRunMode;
type RunType = AutoTradeRunType;
type SupabaseClientAny = any;

type AutoTradeSettingRow = {
  chat_id: number;
  is_enabled: boolean;
  monday_buy_slots: number;
  max_positions: number;
  min_buy_score: number;
  take_profit_pct: number;
  stop_loss_pct: number;
  long_term_ratio?: number | null;
  last_long_term_coach_at?: string | null;
  last_monday_buy_at?: string | null;
  last_daily_review_at?: string | null;
  selected_strategy?: string | null;
};

type BuyPriceSource = "realtime" | "close";

type BuyPriceResolution = {
  priceByCode: Map<string, { price: number; source: BuyPriceSource }>;
  marketPhase: "intraday" | "after-close";
  realtimeAppliedCount: number;
  realtimeSkippedByBudget: boolean;
};

type ApiBudgetScope = "market_overview" | "realtime_price_batch";

type ApiBudget = {
  limit: number;
  used: number;
  usageByScope: Record<ApiBudgetScope, number>;
};

const AUTO_TRADE_STRATEGY_ID = "core.autotrade.v1";

type SignalTrustThresholds = {
  variant: "A" | "B" | "CUSTOM";
  newBuy: number;
  addOn: number;
  rebalance: number;
};

type DiscoveryProfile = "BLEND" | "HIGHLIGHT" | "PULLBACK" | "MULTIBAGGER" | "BACKTEST_EDGE";

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null) {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string' && obj.message) return obj.message;
    if (typeof obj.details === 'string' && obj.details) return obj.details;
  }
  return String(error);
}

function normalizeDiscoveryProfile(value: unknown): DiscoveryProfile {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "HIGHLIGHT") return "HIGHLIGHT";
  if (normalized === "PULLBACK") return "PULLBACK";
  if (normalized === "MULTIBAGGER") return "MULTIBAGGER";
  if (normalized === "BACKTEST_EDGE") return "BACKTEST_EDGE";
  return "BLEND";
}

function discoveryProfileLabel(profile: DiscoveryProfile): string {
  if (profile === "HIGHLIGHT") return "하이라이트(기본점수)";
  if (profile === "PULLBACK") return "눌림목 우선";
  if (profile === "MULTIBAGGER") return "멀티배거 우선";
  if (profile === "BACKTEST_EDGE") return "백테스트 우선";
  return "혼합(추천)";
}

type BacktestEdgeStat = {
  tradeCount: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  avgHoldDays: number;
  score: number;
  boost: number;
};

type BacktestEdgeProfile = {
  codes: Set<string>;
  boostByCode: Map<string, number>;
  statsByCode: Map<string, BacktestEdgeStat>;
  regimeScale: number;
};

function daysBetweenIso(laterIso: string, earlierIso: string): number {
  const later = Date.parse(laterIso);
  const earlier = Date.parse(earlierIso);
  if (!Number.isFinite(later) || !Number.isFinite(earlier)) return 0;
  const diff = Math.max(0, later - earlier);
  return diff / (24 * 60 * 60 * 1000);
}

async function fetchBacktestEdgeProfile(input: {
  supabase: SupabaseClientAny;
  chatId: number;
  limit: number;
}): Promise<BacktestEdgeProfile> {
  const since = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await input.supabase
    .from(PORTFOLIO_TABLES.trades)
    .select("id,code,pnl_amount,memo,traded_at")
    .eq("chat_id", input.chatId)
    .eq("side", "SELL")
    .is("broker_name", null)
    .is("account_name", null)
    .gte("traded_at", since)
    .order("traded_at", { ascending: false })
    .limit(1200);

  if (error || !Array.isArray(data)) {
    return {
      codes: new Set<string>(),
      boostByCode: new Map<string, number>(),
      statsByCode: new Map<string, BacktestEdgeStat>(),
      regimeScale: 1,
    };
  }

  const trades = (data as Array<{
    id?: number | null;
    code?: string | null;
    pnl_amount?: number | null;
    memo?: string | null;
    traded_at?: string | null;
  }>).filter((row) => parseStrategyMemo(row.memo).strategyId === AUTO_TRADE_STRATEGY_ID);

  if (trades.length <= 0) {
    return {
      codes: new Set<string>(),
      boostByCode: new Map<string, number>(),
      statsByCode: new Map<string, BacktestEdgeStat>(),
      regimeScale: 1,
    };
  }

  const tradeById = new Map<number, { tradedAt: string; code: string }>();
  for (const trade of trades) {
    const id = Math.floor(toNumber(trade.id, 0));
    const code = String(trade.code ?? "").trim();
    const tradedAt = String(trade.traded_at ?? "").trim();
    if (id > 0 && code && tradedAt) {
      tradeById.set(id, { tradedAt, code });
    }
  }

  const tradeIds = Array.from(tradeById.keys()).slice(0, 1000);
  const holdDaysByTrade = new Map<number, { weightedDays: number; qty: number }>();

  if (tradeIds.length > 0) {
    const { data: lotMatches } = await input.supabase
      .from(PORTFOLIO_TABLES.lotMatches)
      .select("trade_id,lot_id,quantity")
      .in("trade_id", tradeIds)
      .limit(5000);

    const matches = (lotMatches ?? []) as Array<{
      trade_id?: number | null;
      lot_id?: number | null;
      quantity?: number | null;
    }>;
    const lotIds = Array.from(
      new Set(matches.map((row) => Math.floor(toNumber(row.lot_id, 0))).filter((id) => id > 0))
    ).slice(0, 5000);

    const lotAcquiredAt = new Map<number, string>();
    if (lotIds.length > 0) {
      const { data: lots } = await input.supabase
        .from(PORTFOLIO_TABLES.lots)
        .select("id,acquired_at")
        .in("id", lotIds)
        .limit(5000);
      for (const lot of (lots ?? []) as Array<{ id?: number | null; acquired_at?: string | null }>) {
        const lotId = Math.floor(toNumber(lot.id, 0));
        const acquiredAt = String(lot.acquired_at ?? "").trim();
        if (lotId > 0 && acquiredAt) {
          lotAcquiredAt.set(lotId, acquiredAt);
        }
      }
    }

    for (const row of matches) {
      const tradeId = Math.floor(toNumber(row.trade_id, 0));
      const lotId = Math.floor(toNumber(row.lot_id, 0));
      const qty = Math.max(0, Math.floor(toNumber(row.quantity, 0)));
      if (tradeId <= 0 || lotId <= 0 || qty <= 0) continue;
      const tradeMeta = tradeById.get(tradeId);
      const acquiredAt = lotAcquiredAt.get(lotId);
      if (!tradeMeta || !acquiredAt) continue;

      const holdDays = daysBetweenIso(tradeMeta.tradedAt, acquiredAt);
      const prev = holdDaysByTrade.get(tradeId) ?? { weightedDays: 0, qty: 0 };
      holdDaysByTrade.set(tradeId, {
        weightedDays: prev.weightedDays + holdDays * qty,
        qty: prev.qty + qty,
      });
    }
  }

  const aggregateByCode = new Map<
    string,
    {
      tradeCount: number;
      wins: number;
      losses: number;
      grossWin: number;
      grossLoss: number;
      holdDaysWeighted: number;
      holdQty: number;
    }
  >();

  let recentWins = 0;
  let recentLosses = 0;
  let recentGrossWin = 0;
  let recentGrossLoss = 0;
  let recentCount = 0;
  const recentSinceMs = Date.now() - 21 * 24 * 60 * 60 * 1000;

  for (const row of trades) {
    const code = String(row.code ?? "").trim();
    if (!code) continue;
    const pnl = toNumber(row.pnl_amount, 0);
    const tradeId = Math.floor(toNumber(row.id, 0));
    const tradedAtMs = Date.parse(String(row.traded_at ?? ""));
    const hold = holdDaysByTrade.get(tradeId);

    const prev =
      aggregateByCode.get(code) ??
      {
        tradeCount: 0,
        wins: 0,
        losses: 0,
        grossWin: 0,
        grossLoss: 0,
        holdDaysWeighted: 0,
        holdQty: 0,
      };

    prev.tradeCount += 1;
    if (pnl > 0) {
      prev.wins += 1;
      prev.grossWin += pnl;
    } else if (pnl < 0) {
      prev.losses += 1;
      prev.grossLoss += Math.abs(pnl);
    }

    if (hold && hold.qty > 0) {
      prev.holdDaysWeighted += hold.weightedDays;
      prev.holdQty += hold.qty;
    }

    aggregateByCode.set(code, prev);

    if (Number.isFinite(tradedAtMs) && tradedAtMs >= recentSinceMs) {
      recentCount += 1;
      if (pnl > 0) {
        recentWins += 1;
        recentGrossWin += pnl;
      } else if (pnl < 0) {
        recentLosses += 1;
        recentGrossLoss += Math.abs(pnl);
      }
    }
  }

  const recentWinRate =
    recentWins + recentLosses > 0 ? (recentWins / (recentWins + recentLosses)) * 100 : 0;
  const recentProfitFactor =
    recentGrossLoss > 0 ? recentGrossWin / recentGrossLoss : recentGrossWin > 0 ? 2.5 : 0;
  const regimeScale =
    recentCount < 6
      ? 1
      : recentProfitFactor < 0.85 || recentWinRate < 40
      ? 0.45
      : recentProfitFactor < 1 || recentWinRate < 50
      ? 0.7
      : recentProfitFactor >= 1.25 && recentWinRate >= 56
      ? 1.1
      : 1;

  const statsByCode = new Map<string, BacktestEdgeStat>();
  for (const [code, stat] of aggregateByCode.entries()) {
    const winRate = stat.tradeCount > 0 ? (stat.wins / stat.tradeCount) * 100 : 0;
    const profitFactor =
      stat.grossLoss > 0 ? stat.grossWin / stat.grossLoss : stat.grossWin > 0 ? 2.5 : 0;
    const avgHoldDays = stat.holdQty > 0 ? stat.holdDaysWeighted / stat.holdQty : 5;
    const holdFactor = clamp(avgHoldDays / 12, 0.45, 1.3);
    const rawScore =
      winRate * 0.42 +
      profitFactor * 26 +
      holdFactor * 22 +
      Math.log1p(stat.tradeCount) * 5;
    const score = rawScore * regimeScale;
    const boost = clamp((score - 30) / 14, 0, 8);

    statsByCode.set(code, {
      tradeCount: stat.tradeCount,
      wins: stat.wins,
      losses: stat.losses,
      winRate,
      profitFactor,
      avgHoldDays,
      score,
      boost: Number(boost.toFixed(3)),
    });
  }

  const sortedCodes = Array.from(statsByCode.entries())
    .sort((a, b) => {
      const scoreDiff = b[1].score - a[1].score;
      if (scoreDiff !== 0) return scoreDiff;
      const winDiff = b[1].winRate - a[1].winRate;
      if (winDiff !== 0) return winDiff;
      return b[1].profitFactor - a[1].profitFactor;
    })
    .slice(0, Math.max(0, Math.floor(input.limit)));

  return {
    codes: new Set(sortedCodes.map(([code]) => code)),
    boostByCode: new Map(sortedCodes.map(([code, stat]) => [code, stat.boost])),
    statsByCode,
    regimeScale,
  };
}

function applyDiscoveryBoostToRows(input: {
  rows: RankedCandidate[];
  discoveryProfile: DiscoveryProfile;
  highlightCodes?: Set<string>;
  pullbackCandidateCodes?: Set<string>;
  multibaggerCodes?: Set<string>;
  backtestEdgeCodes?: Set<string>;
  backtestBoostByCode?: Map<string, number>;
}): RankedCandidate[] {
  const hasAnySource =
    (input.highlightCodes?.size ?? 0) > 0 ||
    (input.pullbackCandidateCodes?.size ?? 0) > 0 ||
    (input.multibaggerCodes?.size ?? 0) > 0 ||
    (input.backtestEdgeCodes?.size ?? 0) > 0;

  if (!hasAnySource) {
    return input.rows;
  }

  return input.rows.map((row) => {
    const sources: string[] = [];
    if (input.highlightCodes?.has(row.code)) sources.push("하이라이트");
    if (input.pullbackCandidateCodes?.has(row.code)) sources.push("눌림목");
    if (input.multibaggerCodes?.has(row.code)) sources.push("멀티배거");
    if (input.backtestEdgeCodes?.has(row.code)) sources.push("백테스트");

    const sourceCount = sources.length;
    const overlapCount = sourceCount;
    let rankBoost = 0;

    if (sourceCount >= 2) rankBoost += 3.2;
    if (sourceCount >= 3) rankBoost += 2.8;
    if (sourceCount >= 4) rankBoost += 1.5;

    if (input.discoveryProfile === "HIGHLIGHT" && input.highlightCodes?.has(row.code)) {
      rankBoost += 1.8;
    }
    if (input.discoveryProfile === "PULLBACK" && input.pullbackCandidateCodes?.has(row.code)) {
      rankBoost += 2.4;
    }
    if (input.discoveryProfile === "MULTIBAGGER" && input.multibaggerCodes?.has(row.code)) {
      rankBoost += 2.6;
    }
    if (input.discoveryProfile === "BACKTEST_EDGE" && input.backtestEdgeCodes?.has(row.code)) {
      rankBoost += 1.6;
    }
    if (input.discoveryProfile === "BLEND" && sourceCount === 1) {
      rankBoost += 0.6;
    }

    rankBoost += toNumber(input.backtestBoostByCode?.get(row.code), 0);

    if (rankBoost <= 0 && sourceCount <= 0) {
      return row;
    }

    const discoveryReason =
      sourceCount >= 3
        ? `교집합 ${sourceCount}개 소스 일치`
        : sourceCount === 2
        ? "교집합 2개 소스 일치"
        : input.discoveryProfile === "BACKTEST_EDGE" && input.backtestEdgeCodes?.has(row.code)
        ? "백테스트 우수체결 가중"
        : input.discoveryProfile === "MULTIBAGGER" && input.multibaggerCodes?.has(row.code)
        ? "멀티배거 우선 소스"
        : input.discoveryProfile === "PULLBACK" && input.pullbackCandidateCodes?.has(row.code)
        ? "눌림목 우선 소스"
        : sourceCount > 0
        ? `${sources[0]} 소스 반영`
        : null;

    return {
      ...row,
      rankBoost: Number(rankBoost.toFixed(3)),
      discoveryOverlapCount: overlapCount,
      discoverySourceCount: sourceCount,
      discoverySources: sourceCount > 0 ? sources : null,
      discoveryReason,
    };
  });
}

type DailyIndicatorFlowRow = {
  code?: string | null;
  trade_date?: string | null;
  close?: number | null;
  volume?: number | null;
  value_traded?: number | null;
  sma20?: number | null;
  sma50?: number | null;
  rsi14?: number | null;
  roc14?: number | null;
  roc21?: number | null;
};

type FlowSignalProfile = {
  todayBuyScore: number;
  holdExtensionScore: number;
  immediateExcludeSignal: boolean;
  reason: string;
};

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentileRank(values: number[], target: number): number {
  if (!values.length || !Number.isFinite(target)) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const belowOrEqual = sorted.filter((value) => value <= target).length;
  return belowOrEqual / sorted.length;
}

function buildFlowSignalProfile(series: DailyIndicatorFlowRow[]): FlowSignalProfile {
  if (!series.length) {
    return {
      todayBuyScore: 0,
      holdExtensionScore: 0,
      immediateExcludeSignal: false,
      reason: "수급데이터 없음",
    };
  }

  const latest = series[series.length - 1] ?? {};
  const valueSeries = series.map((row) => Math.max(0, toNumber(row.value_traded, 0))).filter((v) => v > 0);
  const volumeSeries = series.map((row) => Math.max(0, toNumber(row.volume, 0))).filter((v) => v > 0);
  const closeSeries = series.map((row) => Math.max(0, toNumber(row.close, 0))).filter((v) => v > 0);
  const recent20Value = valueSeries.slice(-20);
  const recent20Volume = volumeSeries.slice(-20);
  const recent5Close = closeSeries.slice(-5);
  const recent3Value = valueSeries.slice(-3);

  const latestValue = Math.max(0, toNumber(latest.value_traded, 0));
  const latestVolume = Math.max(0, toNumber(latest.volume, 0));
  const latestClose = Math.max(0, toNumber(latest.close, 0));
  const sma20 = Math.max(0, toNumber(latest.sma20, 0));
  const sma50 = Math.max(0, toNumber(latest.sma50, 0));
  const rsi14 = toNumber(latest.rsi14, 50);
  const roc14 = toNumber(latest.roc14, 0);
  const roc21 = toNumber(latest.roc21, 0);

  const valuePercentile = percentileRank(recent20Value, latestValue);
  const avg20Value = mean(recent20Value);
  const avg20Volume = mean(recent20Volume);
  const valueRatio = avg20Value > 0 ? latestValue / avg20Value : 1;
  const volumeRatio = avg20Volume > 0 ? latestVolume / avg20Volume : 1;
  const priorHigh5 = recent5Close.length >= 2 ? Math.max(...recent5Close.slice(0, -1)) : latestClose;
  const breakoutHeld = latestClose > 0 && priorHigh5 > 0 ? latestClose >= priorHigh5 * 0.998 : false;
  const stableTrend = (sma20 <= 0 || latestClose >= sma20) && (sma50 <= 0 || latestClose >= sma50 * 0.985);
  const recentValueStreak = recent3Value.filter((value) => avg20Value > 0 && value >= avg20Value * 1.2).length;

  let todayBuyScore = 0;
  if (valuePercentile >= 0.8) todayBuyScore += 22;
  else if (valuePercentile >= 0.65) todayBuyScore += 12;

  if (valueRatio >= 1.8) todayBuyScore += 18;
  else if (valueRatio >= 1.3) todayBuyScore += 12;

  if (volumeRatio >= 1.8) todayBuyScore += 16;
  else if (volumeRatio >= 1.3) todayBuyScore += 10;

  if (recentValueStreak >= 2) todayBuyScore += 12;
  if (breakoutHeld) todayBuyScore += 12;
  if (stableTrend) todayBuyScore += 10;
  if (rsi14 >= 48 && rsi14 <= 72) todayBuyScore += 6;
  if (roc14 > 0) todayBuyScore += 6;
  if (roc21 > 0) todayBuyScore += 6;
  todayBuyScore = clamp(Math.round(todayBuyScore), 0, 100);

  let holdExtensionScore = 0;
  holdExtensionScore += Math.round(todayBuyScore * 0.45);
  if (valueRatio >= 1.2) holdExtensionScore += 12;
  if (volumeRatio >= 1.1) holdExtensionScore += 10;
  if (stableTrend) holdExtensionScore += 16;
  if (rsi14 >= 45 && rsi14 <= 70) holdExtensionScore += 10;
  if (roc14 > 0 && roc21 > 0) holdExtensionScore += 12;
  holdExtensionScore = clamp(holdExtensionScore, 0, 100);

  const breakdown = latestClose > 0 && sma20 > 0 ? latestClose < sma20 * 0.97 : false;
  const flowDry = valueRatio < 0.65 && volumeRatio < 0.7;
  const momentumFail = roc14 < -1.5 && roc21 < -2.5;
  const immediateExcludeSignal = breakdown || flowDry || momentumFail;

  const reason = immediateExcludeSignal
    ? "즉시제외: 추세이탈/수급둔화"
    : todayBuyScore >= 80
    ? "오늘매수 강신호: 수급 누적 + 구조 유지"
    : todayBuyScore >= 65
    ? "오늘매수 후보: 수급 우위"
    : "관찰: 수급 강도 보통";

  return {
    todayBuyScore,
    holdExtensionScore,
    immediateExcludeSignal,
    reason,
  };
}

async function fetchFlowSignalProfilesByCode(input: {
  supabase: SupabaseClientAny;
  codes: string[];
}): Promise<Map<string, FlowSignalProfile>> {
  const codeSet = Array.from(new Set(input.codes.map((code) => String(code ?? "").trim()).filter(Boolean)));
  const out = new Map<string, FlowSignalProfile>();
  if (!codeSet.length) return out;

  const fromDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const chunks: string[][] = [];
  for (let i = 0; i < codeSet.length; i += 200) {
    chunks.push(codeSet.slice(i, i + 200));
  }

  const grouped = new Map<string, DailyIndicatorFlowRow[]>();
  for (const chunk of chunks) {
    const { data } = await input.supabase
      .from("daily_indicators")
      .select("code,trade_date,close,volume,value_traded,sma20,sma50,rsi14,roc14,roc21")
      .in("code", chunk)
      .gte("trade_date", fromDate)
      .order("trade_date", { ascending: true })
      .limit(8000);

    for (const row of (data ?? []) as DailyIndicatorFlowRow[]) {
      const code = String(row.code ?? "").trim();
      if (!code) continue;
      const list = grouped.get(code) ?? [];
      list.push(row);
      grouped.set(code, list);
    }
  }

  for (const code of codeSet) {
    out.set(code, buildFlowSignalProfile(grouped.get(code) ?? []));
  }

  return out;
}

function applyFlowSignalProfilesToRows(input: {
  rows: RankedCandidate[];
  profileByCode: Map<string, FlowSignalProfile>;
}): RankedCandidate[] {
  return input.rows.map((row) => {
    const profile = input.profileByCode.get(row.code);
    if (!profile) return row;

    let rankBoost = toNumber(row.rankBoost, 0);
    if (profile.todayBuyScore >= 85) rankBoost += 6;
    else if (profile.todayBuyScore >= 75) rankBoost += 4;
    else if (profile.todayBuyScore >= 65) rankBoost += 2;

    if (profile.holdExtensionScore >= 75) rankBoost += 1.5;
    if (profile.immediateExcludeSignal) rankBoost -= 12;

    return {
      ...row,
      rankBoost: Number(rankBoost.toFixed(3)),
      todayBuyScore: profile.todayBuyScore,
      holdExtensionScore: profile.holdExtensionScore,
      immediateExcludeSignal: profile.immediateExcludeSignal,
      flowReason: profile.reason,
    };
  });
}

export type AutoTradeRunMode = SelectionAutoTradeRunMode;

export type ChatAutoTradeRunSummary = {
  mode: RunMode;
  runType: RunType;
  runKey: string;
  dryRun: boolean;
  action: AutoTradeActionSummary;
  recentMetrics: AutoTradeRecentMetrics | null;
};

export type AutoTradeRecentMetrics = {
  windowDays: number;
  runCount: number;
  activeDays: number;
  buyActions: number;
  sellActions: number;
  skipActions: number;
  errorActions: number;
  topSkipReasons: Array<{ reason: string; count: number }>;
};

type AutoTradeSellPerformance = {
  windowDays: number;
  sellCount: number;
  winRate: number;
  profitFactor: number | null;
  maxLossStreak: number;
};

type NewsAssistSignal = {
  bias: number;
  blocked: boolean;
  note: string;
};

const NEWS_ASSIST_CACHE_TTL_MS = 10 * 60 * 1000;
const NEWS_ASSIST_NEWS_LIMIT = 6;
const NEWS_ASSIST_PROBE_LIMIT = Math.max(4, toPositiveInt(process.env.AUTO_TRADE_NEWS_ASSIST_PROBE_LIMIT, 8));
const newsAssistCache = new Map<string, { expiresAt: number; signal: NewsAssistSignal }>();

function toGateLabel(status: "promote" | "hold" | "watch" | "pause"): string {
  if (status === "promote") return "승격 후보";
  if (status === "pause") return "중단 후보";
  if (status === "watch") return "관찰";
  return "유지";
}

type HoldingRow = {
  id: number;
  code: string;
  buy_price: number | null;
  buy_date?: string | null;
  created_at?: string | null;
  quantity: number | null;
  invested_amount: number | null;
  status?: string | null;
  memo?: string | null;
};

type ScoreCandidateRow = {
  code: string;
  total_score: number | null;
  signal?: string | null;
  factors?: Record<string, unknown> | null;
  stock: {
    code: string;
    name: string | null;
    close: number | null;
    rsi14?: number | null;
    liquidity?: number | null;
    market?: string | null;
    market_cap?: number | null;
    universe_level?: string | null;
  } | Array<{
    code: string;
    name: string | null;
    close: number | null;
    rsi14?: number | null;
    liquidity?: number | null;
    market?: string | null;
    market_cap?: number | null;
    universe_level?: string | null;
  }> | null;
};

export type AutoTradeActionSummary = {
  chatId: number;
  buys: number;
  sells: number;
  skipped: number;
  errors: number;
  notes: string[];
  /** 이번 실행에서 비중 초과로 분할 매도된 종목 코드 목록 */
  overweightReducedCodes?: string[];
};

export type AutoTradeRunSummary = {
  mode: RunMode;
  runType: RunType;
  runKey: string;
  totalUsers: number;
  processedUsers: number;
  buyCount: number;
  sellCount: number;
  skippedCount: number;
  errorCount: number;
  skipReasonStats: AutoTradeSkipReasonStat[];
  actions: AutoTradeActionSummary[];
};

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toPositiveInt(value: unknown, fallback: number): number {
  const n = Math.floor(toNumber(value, fallback));
  return n > 0 ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function resolveApiBudgetLimit(input: { intradayOnly: boolean }): number {
  const slotLimit = toPositiveInt(process.env.API_SLOT_BUDGET, 4);
  const dailyLimit = toPositiveInt(process.env.API_DAILY_BUDGET, 12);
  return input.intradayOnly ? slotLimit : dailyLimit;
}

function createApiBudget(limit: number): ApiBudget {
  return {
    limit: Math.max(1, Math.floor(limit)),
    used: 0,
    usageByScope: {
      market_overview: 0,
      realtime_price_batch: 0,
    },
  };
}

function tryConsumeApiBudget(
  budget: ApiBudget | undefined,
  scope: ApiBudgetScope,
  cost = 1
): boolean {
  if (!budget) return true;
  const normalizedCost = Math.max(1, Math.floor(cost));
  if (budget.used + normalizedCost > budget.limit) {
    return false;
  }
  budget.used += normalizedCost;
  budget.usageByScope[scope] += normalizedCost;
  return true;
}

function normalizeSignalValue(signal: unknown): string {
  return String(signal ?? "").trim().toUpperCase();
}

function resolveTargetHorizon(input: {
  profile: string;
  expectedHorizonDays: number;
}): "scalp" | "swing" | "position" {
  const profile = String(input.profile ?? "").trim().toUpperCase();
  const days = Math.max(1, Math.floor(toNumber(input.expectedHorizonDays, 5)));

  if (profile === "SHORT_SWING" || profile === "REDUCE_TIGHT" || days <= 3) {
    return "scalp";
  }
  if (profile === "POSITION_CORE" || days >= 15) {
    return "position";
  }
  return "swing";
}

function resolvePlannedReviewAt(expectedHorizonDays: number): string {
  const clampedDays = Math.max(1, Math.min(90, Math.floor(toNumber(expectedHorizonDays, 5))));
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + clampedDays);
  return d.toISOString();
}

function resolveAdaptiveExitThreshold(input: {
  takeProfitPct: number;
  stopLossPct: number;
  signal?: string | null;
  market?: string | null;
  marketPolicy: AutoTradeMarketPolicy;
  pnlPct: number;
}): {
  takeProfitPct: number;
  stopLossPct: number;
} {
  let takeProfitPct = Math.max(2, Math.abs(toNumber(input.takeProfitPct, 8)));
  let stopLossPct = Math.max(1, Math.abs(toNumber(input.stopLossPct, 4)));
  const signal = normalizeSignalValue(input.signal);
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
  stopLossPct = Number(clamp(stopLossPct, 1.5, 8).toFixed(1));
  if (takeProfitPct < stopLossPct + 1.5) {
    takeProfitPct = Number(Math.min(14, stopLossPct + 1.5).toFixed(1));
  }

  return {
    takeProfitPct,
    stopLossPct,
  };
}

function normalizeLongTermRatio(value: unknown, fallback = 70): number {
  return Math.round(clamp(toNumber(value, fallback), 0, 100));
}

function resolveSignalTrustThresholdsFromPrefs(prefs: {
  signal_trust_variant?: "A" | "B" | "CUSTOM";
  signal_trust_new_buy?: number;
  signal_trust_add_on?: number;
  signal_trust_rebalance?: number;
}): SignalTrustThresholds {
  const variant = prefs.signal_trust_variant ?? "A";
  const preset =
    variant === "B"
      ? { newBuy: 66, addOn: 62, rebalance: 64 }
      : { newBuy: 62, addOn: 58, rebalance: 60 };

  return {
    variant,
    newBuy: clamp(toNumber(prefs.signal_trust_new_buy, preset.newBuy), 0, 100),
    addOn: clamp(toNumber(prefs.signal_trust_add_on, preset.addOn), 0, 100),
    rebalance: clamp(toNumber(prefs.signal_trust_rebalance, preset.rebalance), 0, 100),
  };
}

function resolveCandidateProbeLimit(targetSlots: number): number {
  const slots = Math.max(1, Math.floor(targetSlots));
  return Math.max(slots, Math.max(6, slots * 3));
}

function fmtKrw(value: number): string {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function formatFilteringMetricsLine(input: {
  label: string;
  metrics?: AutoTradeCandidateSelectionResult["filteringMetrics"];
}): string | null {
  const metrics = input.metrics;
  if (!metrics) return null;

  return `${input.label}: 초기 ${metrics.initialCount}건 -> 정책 ${metrics.afterMarketPolicyCount}건 -> 기본 ${metrics.afterBaseFilterCount}건 -> 후보 ${metrics.candidatePoolCount}건 -> 최종 ${metrics.selectedCount}건`;
}

function formatTopRejectReasons(input?: {
  rejectedByReason?: Record<string, number>;
}): string | null {
  const entries = Object.entries(input?.rejectedByReason ?? {})
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2);
  if (!entries.length) return null;
  return entries.map(([reason, count]) => `${reason}:${count}`).join(" · ");
}

async function buildNewsAssistSignalsByCode(codes: string[]): Promise<Map<string, NewsAssistSignal>> {
  const uniqueCodes = Array.from(new Set(codes.filter(Boolean))).slice(0, NEWS_ASSIST_PROBE_LIMIT);
  const now = Date.now();
  const out = new Map<string, NewsAssistSignal>();

  await Promise.all(
    uniqueCodes.map(async (code) => {
      const cached = newsAssistCache.get(code);
      if (cached && cached.expiresAt > now) {
        out.set(code, cached.signal);
        return;
      }

      try {
        const news = await fetchStockNews(code, NEWS_ASSIST_NEWS_LIMIT);
        if (!news.length) {
          const neutral: NewsAssistSignal = { bias: 0, blocked: false, note: "뉴스 신호 없음" };
          newsAssistCache.set(code, { expiresAt: now + NEWS_ASSIST_CACHE_TTL_MS, signal: neutral });
          out.set(code, neutral);
          return;
        }

        const titles = news.map((entry) => String(entry.title || "")).filter(Boolean);
        const sentiment = analyzeNewsSentiment(titles);
        const orderSignal = analyzeOrderIntakeSignal(titles);
        const rawBias = sentiment.score * 0.7 + orderSignal.score * 1.0;
        const bias = Number(clamp(rawBias, -8, 8).toFixed(1));
        const blocked = sentiment.score <= -6 || orderSignal.score <= -5;

        let note = "중립";
        if (blocked) {
          note = `강한 악재 감지(s=${sentiment.score}, o=${orderSignal.score})`;
        } else if (bias >= 2.5) {
          note = `호재 가중치 +${bias}`;
        } else if (bias <= -2.5) {
          note = `악재 감점 ${bias}`;
        }

        const signal: NewsAssistSignal = { bias, blocked, note };
        newsAssistCache.set(code, { expiresAt: now + NEWS_ASSIST_CACHE_TTL_MS, signal });
        out.set(code, signal);
      } catch {
        const neutral: NewsAssistSignal = { bias: 0, blocked: false, note: "뉴스 조회 실패(중립 처리)" };
        newsAssistCache.set(code, { expiresAt: now + NEWS_ASSIST_CACHE_TTL_MS, signal: neutral });
        out.set(code, neutral);
      }
    })
  );

  return out;
}

async function applyNewsAssistToSelection(
  selection: AutoTradeCandidateSelectionResult,
  contextLabel: string
): Promise<{ selection: AutoTradeCandidateSelectionResult; notes: string[] }> {
  if (!selection.candidates.length) return { selection, notes: [] };

  const signalsByCode = await buildNewsAssistSignalsByCode(
    selection.candidates.map((candidate) => candidate.code)
  );
  let boosted = 0;
  let penalized = 0;
  let blocked = 0;
  const boostedDetails: string[] = [];
  const penalizedDetails: string[] = [];
  const blockedDetails: string[] = [];

  const candidates = selection.candidates
    .filter((candidate) => {
      const signal = signalsByCode.get(candidate.code);
      if (signal?.blocked) {
        blocked += 1;
        blockedDetails.push(`${candidate.name}(${candidate.code}, ${signal.note})`);
        return false;
      }
      return true;
    })
    .map((candidate) => {
      const signal = signalsByCode.get(candidate.code);
      if (!signal || Math.abs(signal.bias) < 0.1) return candidate;
      if (signal.bias > 0) {
        boosted += 1;
        boostedDetails.push(`${candidate.name}(${candidate.code}, +${signal.bias})`);
      }
      if (signal.bias < 0) {
        penalized += 1;
        penalizedDetails.push(`${candidate.name}(${candidate.code}, ${signal.bias})`);
      }
      return {
        ...candidate,
        score: Number((candidate.score + signal.bias).toFixed(1)),
      };
    })
    .sort((a, b) => b.score - a.score);

  const notes: string[] = [];
  if (boosted > 0 || penalized > 0 || blocked > 0) {
    notes.push(`${contextLabel} 뉴스보정: 가산 ${boosted} · 감산 ${penalized} · 악재차단 ${blocked}`);
    if (boostedDetails.length > 0) {
      notes.push(`${contextLabel} 가산 근거: ${boostedDetails.slice(0, 3).join(" · ")}`);
    }
    if (penalizedDetails.length > 0) {
      notes.push(`${contextLabel} 감산 근거: ${penalizedDetails.slice(0, 3).join(" · ")}`);
    }
    if (blockedDetails.length > 0) {
      notes.push(`${contextLabel} 차단 근거: ${blockedDetails.slice(0, 3).join(" · ")}`);
    }
  }

  const nextRejectedByReason = {
    ...(selection.filteringMetrics?.rejectedByReason ?? {}),
  };
  if (blocked > 0) {
    nextRejectedByReason.newsAssistBlocked =
      Number(nextRejectedByReason.newsAssistBlocked ?? 0) + blocked;
  }

  return {
    selection: {
      ...selection,
      candidates,
      filteringMetrics: selection.filteringMetrics
        ? {
            ...selection.filteringMetrics,
            selectedCount: candidates.length,
            rejectedByReason: nextRejectedByReason,
          }
        : selection.filteringMetrics,
    },
    notes,
  };
}

async function fetchExecutionPriceMap(
  codes: string[]
): Promise<Record<string, RealtimeStockData>> {
  if (!codes.length) return {};
  try {
    return await fetchRealtimePriceBatch(codes);
  } catch {
    return {};
  }
}

async function fetchMarketOverviewWithBudget(input: {
  apiBudget?: ApiBudget;
}): Promise<{ overview: Awaited<ReturnType<typeof fetchAllMarketData>> | null; skippedByBudget: boolean }> {
  if (!tryConsumeApiBudget(input.apiBudget, "market_overview", 1)) {
    return { overview: null, skippedByBudget: true };
  }
  const overview = await fetchAllMarketData().catch(() => null);
  return { overview, skippedByBudget: false };
}

function resolveNewsBiasFromFactors(
  factors: Record<string, unknown> | null | undefined
): "risk-on" | "neutral" | "risk-off" {
  if (!factors) return "neutral";

  const sentimentRaw = Number((factors as Record<string, unknown>).news_sentiment_score);
  if (Number.isFinite(sentimentRaw)) {
    if (sentimentRaw >= 0.25) return "risk-on";
    if (sentimentRaw <= -0.25) return "risk-off";
  }

  const flag = String((factors as Record<string, unknown>).news_risk ?? "").trim().toLowerCase();
  if (["risk-off", "high", "negative", "warn"].includes(flag)) return "risk-off";
  if (["risk-on", "low", "positive", "good"].includes(flag)) return "risk-on";

  return "neutral";
}

function resolveExecutionPrice(input: {
  code: string;
  fallbackPrice: number;
  realtimeMap: Record<string, RealtimeStockData>;
}): { price: number; source: "realtime" | "snapshot" } {
  const realtimePrice = toNumber(input.realtimeMap[input.code]?.price, 0);
  if (realtimePrice > 0) {
    return { price: realtimePrice, source: "realtime" };
  }
  return { price: Math.max(0, input.fallbackPrice), source: "snapshot" };
}

function resolveEarningsGrowthPctFromFactors(
  factors: Record<string, unknown>
): number | null {
  const candidates = [
    factors.earnings_growth_pct,
    factors.net_income_growth_pct,
    factors.op_income_growth_pct,
  ];

  for (const value of candidates) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
  }

  return null;
}

function formatPriceSourceLabel(source: BuyPriceSource | "snapshot"): string {
  if (source === "realtime") return "실시간 시세";
  if (source === "close") return "종가 시세";
  return "스냅샷 시세";
}

function resolveDailyRiskBudget(input: {
  seedCapital: number;
  dailyLossLimitPct: number;
  dailyRealizedPnl: number;
}): {
  lossCapAmount: number;
  lossUsedAmount: number;
  remainingLossAmount: number;
  scale: number;
  blocked: boolean;
} {
  const seedCapital = Math.max(0, toNumber(input.seedCapital, 0));
  const dailyLossLimitPct = Math.max(0, toNumber(input.dailyLossLimitPct, 0));
  const dailyRealizedPnl = toNumber(input.dailyRealizedPnl, 0);

  const lossCapAmount = seedCapital > 0 ? Math.abs(seedCapital * (dailyLossLimitPct / 100)) : 0;
  const lossUsedAmount = Math.max(0, -dailyRealizedPnl);
  const remainingLossAmount = Math.max(0, lossCapAmount - lossUsedAmount);
  const blocked = lossCapAmount > 0 && lossUsedAmount >= lossCapAmount;
  const scale =
    lossCapAmount > 0 ? Math.max(0.35, Math.min(1, remainingLossAmount / lossCapAmount)) : 1;

  return {
    lossCapAmount,
    lossUsedAmount,
    remainingLossAmount,
    scale,
    blocked,
  };
}

function buildResponseGuideNote(input: {
  actionType: "new-buy" | "add-on-buy";
  code: string;
  basePrice: number;
  quantity: number;
  investedAmount?: number;
  takeProfitPct: number;
  stopLossPct: number;
  addOnLowerPct?: number;
  addOnUpperPct?: number;
}): string {
  const basePrice = Math.max(0, Math.round(input.basePrice));
  const takeProfitPct = Math.max(0, Math.abs(toNumber(input.takeProfitPct, 0)));
  const stopLossPct = Math.max(0, Math.abs(toNumber(input.stopLossPct, 0)));
  const addOnLowerPct = toNumber(input.addOnLowerPct, -6);
  const addOnUpperPct = toNumber(input.addOnUpperPct, 3);

  const takeProfitPrice = Math.max(0, Math.round(basePrice * (1 + takeProfitPct / 100)));
  const stopLossPrice = Math.max(0, Math.round(basePrice * (1 - stopLossPct / 100)));
  const addOnLowPrice = Math.max(0, Math.round(basePrice * (1 + addOnLowerPct / 100)));
  const addOnHighPrice = Math.max(0, Math.round(basePrice * (1 + addOnUpperPct / 100)));
  const trailingArmedPrice = Math.max(0, Math.round(basePrice * 1.05));
  const trailingExitPrice = Math.max(0, Math.round(trailingArmedPrice * 0.98));
  const quantity = Math.max(0, Math.floor(toNumber(input.quantity, 0)));
  const investedAmount = Math.max(0, Math.round(toNumber(input.investedAmount, quantity * basePrice)));
  const stopLossRiskAmount = Math.max(0, Math.round(Math.max(0, basePrice - stopLossPrice) * quantity));
  const positionWeightPct = investedAmount > 0 && basePrice > 0
    ? Number(((investedAmount / Math.max(investedAmount, basePrice * quantity)) * 100).toFixed(1))
    : 0;
  const actionLabel = input.actionType === "add-on-buy" ? "추가매수" : "신규매수";

  return [
    `[대응가이드][${actionLabel}] ${input.code}`,
    `기준가 ${fmtKrw(basePrice)}`,
    `수량 ${quantity}주`,
    `익절 ${takeProfitPct.toFixed(1)}%(${fmtKrw(takeProfitPrice)})`,
    `손절 ${stopLossPct.toFixed(1)}%(${fmtKrw(stopLossPrice)})`,
    `예상손실 ${fmtKrw(stopLossRiskAmount)}`,
    `추가매수밴드 ${addOnLowerPct.toFixed(1)}~${addOnUpperPct.toFixed(1)}%(${fmtKrw(addOnLowPrice)}~${fmtKrw(addOnHighPrice)})`,
    `트레일링 +5.0%(${fmtKrw(trailingArmedPrice)}) 도달 후 고점대비 -2.0% 이탈 시 1차익절 기준(${fmtKrw(trailingExitPrice)})`,
    `투입비중 ${positionWeightPct.toFixed(1)}%`,
  ].join(" · ");
}

function buildTodaySignalReasonNote(input: {
  signal?: string | null;
  stableTurn?: string | null;
  signalGate?: { trustScore: number; grade: string } | null;
}): string {
  const signal = String(input.signal ?? "").trim().toUpperCase();
  const stableTurn = String(input.stableTurn ?? "").trim().toLowerCase();
  const parts: string[] = [];

  if (signal === "STRONG_BUY") parts.push("오늘 적극신호 STRONG_BUY");
  else if (signal === "BUY") parts.push("오늘 적극신호 BUY");
  else if (signal === "WATCH") parts.push("오늘 관찰신호 WATCH");

  if (stableTurn === "bull-strong") parts.push("Stable 강상승 턴");
  else if (stableTurn === "bull-weak") parts.push("Stable 상승 턴");

  if (input.signalGate) {
    parts.push(`신뢰도 ${input.signalGate.grade}(${input.signalGate.trustScore}점)`);
  }

  return parts.length ? `[오늘신호] ${parts.join(" · ")}` : "";
}

function buildAutoTradeFilterReason(candidate: {
  score: number;
  signal?: string | null;
  todayBuyScore?: number | null;
  holdExtensionScore?: number | null;
  immediateExcludeSignal?: boolean | null;
  flowReason?: string | null;
  stableTurn?: string | null;
  stableTrust?: number | null;
  stableAboveAvg?: boolean | null;
  stableAccumulation?: boolean | null;
}): string {
  const stableTurn = String(candidate.stableTurn ?? "").toLowerCase();
  const reasons = describeScanFilterReasons(
    {
      total: toNumber(candidate.score, 0),
      signal: String(candidate.signal ?? ""),
      stableTurn,
      stableTrust: toNumber(candidate.stableTrust, 0),
      stableAboveAvg: Boolean(candidate.stableAboveAvg ?? false),
      stableAccumulation: Boolean(candidate.stableAccumulation ?? false),
      recentInDays: isActionableTodayBuySignal(candidate.signal) ? 1 : 0,
      recentAccumulationDays: Boolean(candidate.stableAccumulation ?? false) ? 2 : 0,
      recentBullDays:
        stableTurn === "bull-weak" || stableTurn === "bull-strong"
          ? 1
          : 0,
    },
    ["entry", "accumulation"],
    {
      entryGrade: "A",
      entryScore: 3,
      trendGrade: "B",
      distGrade: "B",
    }
  );

  const flowParts: string[] = [];
  if (candidate.todayBuyScore != null) {
    flowParts.push(`오늘매수 ${Math.round(toNumber(candidate.todayBuyScore, 0))}`);
  }
  if (candidate.holdExtensionScore != null) {
    flowParts.push(`보유연장 ${Math.round(toNumber(candidate.holdExtensionScore, 0))}`);
  }
  if (candidate.immediateExcludeSignal === true) {
    flowParts.push("즉시제외 신호");
  }
  if (candidate.flowReason) {
    flowParts.push(String(candidate.flowReason));
  }

  return [...reasons.slice(0, 2), ...flowParts].filter(Boolean).join(" · ");
}

const AUTO_TRADE_CHECKPOINTS_KST = [
  { hour: 9, minute: 8, label: "09:08" },
  { hour: 10, minute: 35, label: "10:35" },
  { hour: 14, minute: 10, label: "14:10" },
];

function resolveExecutionPriorityLine(action: AutoTradeActionSummary): string {
  if (action.sells > 0) {
    return "대응우선도: 높음 (매도 체결 발생, 리스크/익절 체결 확인)";
  }
  if (action.buys > 0) {
    return "대응우선도: 중간 (신규/추가 진입 근거 및 비중 확인)";
  }
  return "대응우선도: 낮음 (체결 없음)";
}

function resolveNextAutoTradeCheckpoint(base = new Date()): string {
  const kst = new Date(base.getTime() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay();
  const minutesNow = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const isWeekday = day >= 1 && day <= 5;

  if (isWeekday) {
    for (const slot of AUTO_TRADE_CHECKPOINTS_KST) {
      const slotMinutes = slot.hour * 60 + slot.minute;
      if (minutesNow < slotMinutes) {
        return `다음 자동점검: 오늘 ${slot.label} (KST)`;
      }
    }
  }

  return `다음 자동점검: 다음 영업일 ${AUTO_TRADE_CHECKPOINTS_KST[0].label} (KST)`;
}

function buildAutoTradeExecutionAlert(input: {
  runType: RunType;
  action: AutoTradeActionSummary;
  isShadow?: boolean;
}): string | null {
  const executedCount = input.action.buys + input.action.sells;
  if (executedCount <= 0) return null;

  const runLabel =
    input.runType === "MONDAY_BUY"
      ? "월요일 진입"
      : input.runType === "DAILY_REVIEW"
        ? "일일 대응"
        : "수동 실행";

  const shadowPrefix = input.isShadow ? "[섀도우] " : "";
  const priorityLine = resolveExecutionPriorityLine(input.action);
  const nextCheckpointLine = resolveNextAutoTradeCheckpoint();

  const lines = [
    `${shadowPrefix}[자동사이클 체결 알림] ${runLabel}`,
    `매수 ${input.action.buys}건 · 매도 ${input.action.sells}건 · 미체결 ${input.action.skipped}건`,
    priorityLine,
    nextCheckpointLine,
    ...pickExecutionLines(input.action.notes || []).map((line) => `- ${line}`),
    input.isShadow ? "※ 섀도우 모드: 실반영 없음. 실전 전환은 /섀도우 off" : "다음 점검: /보유 · /보유대응",
  ];

  return lines.join("\n");
}

async function buildRealHoldingResponseSnippet(input: {
  supabase: SupabaseClientAny;
  chatId: number;
  /** 가상매매에서 이번 실행에 비중조정 매도된 종목 코드 목록 */
  overweightReducedCodes?: string[];
}): Promise<string | null> {
  const { data, error } = await input.supabase
    .from("virtual_positions")
    .select("code,buy_price,quantity,invested_amount,stock:stocks!inner(name,close)")
    .eq("chat_id", input.chatId)
    .order("created_at", { ascending: true })
    .limit(30);

  if (error || !Array.isArray(data) || data.length <= 0) {
    return null;
  }

  const rows = data
    .map((row) => {
      const rec = row as Record<string, unknown>;
      const stock = rec.stock as Record<string, unknown> | Record<string, unknown>[] | null;
      const stockRow = Array.isArray(stock) ? stock[0] : stock;
      const code = String(rec.code ?? "").trim();
      const name = String(stockRow?.name ?? code).trim();
      const buyPrice = Number(rec.buy_price ?? 0);
      const quantity = Math.max(0, Math.floor(Number(rec.quantity ?? 0)));
      const close = Number(stockRow?.close ?? 0);
      const invested = Math.max(0, Number(rec.invested_amount ?? 0)) || (buyPrice * quantity);
      if (!code || buyPrice <= 0 || close <= 0 || quantity <= 0) return null;
      const pnlPct = ((close - buyPrice) / buyPrice) * 100;
      const currentValue = close * quantity;
      return { code, name, quantity, close, pnlPct, currentValue, invested };
    })
    .filter((row): row is { code: string; name: string; quantity: number; close: number; pnlPct: number; currentValue: number; invested: number } => Boolean(row));

  if (rows.length <= 0) {
    return null;
  }

  const totalValue = rows.reduce((sum, r) => sum + r.currentValue, 0);
  const OVERWEIGHT_THRESHOLD = 25;

  const overweightRows = totalValue > 0
    ? rows.filter(r => (r.currentValue / totalValue) * 100 >= OVERWEIGHT_THRESHOLD)
    : [];

  const topLines = rows
    .sort((a, b) => Math.abs(b.pnlPct) - Math.abs(a.pnlPct))
    .slice(0, 3)
    .map((row) => {
      const weightPct = totalValue > 0 ? ((row.currentValue / totalValue) * 100).toFixed(1) : null;
      const isOverweight = overweightRows.some(r => r.code === row.code);
      const wasVirtuallyReduced = (input.overweightReducedCodes ?? []).includes(row.code);
      const action =
        wasVirtuallyReduced
          ? `⚠ 가상매매 비중조정 실행 → 실계좌 분할매도 검토`
          : isOverweight
            ? `⚠ 비중과다(${weightPct}%) · 분할매도 검토`
            : row.pnlPct <= -4
              ? "방어우선"
              : row.pnlPct >= 6
                ? "익절검토"
                : "보유관찰";
      const weightNote = weightPct ? ` · 비중 ${weightPct}%` : "";
      return `- ${name}: ${row.name}(${row.code}) ${row.quantity}주 · 손익 ${row.pnlPct.toFixed(1)}%${weightNote} · ${action}`;
    });

  const lines: string[] = ["[실보유 대응 요약]", ...topLines];

  if (overweightRows.length > 0 || (input.overweightReducedCodes ?? []).length > 0) {
    lines.push("💡 비중 25% 초과 종목은 분할 매도로 리스크 분산 권장");
  }

  lines.push("상세 점검: /보유대응");
  return lines.join("\n");
}

function isKrxIntradaySession(base = new Date()): boolean {
  const kst = new Date(base.getTime() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay();
  if (day === 0 || day === 6) return false;
  const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  return minutes >= 9 * 60 && minutes < 15 * 60 + 30;
}

async function resolveBuyExecutionPrices(
  candidates: RankedCandidate[],
  options?: { apiBudget?: ApiBudget }
): Promise<BuyPriceResolution> {
  const priceByCode = new Map<string, { price: number; source: BuyPriceSource }>();
  for (const candidate of candidates) {
    if (candidate.close > 0) {
      priceByCode.set(candidate.code, { price: candidate.close, source: "close" });
    }
  }

  if (!isKrxIntradaySession()) {
    return {
      priceByCode,
      marketPhase: "after-close",
      realtimeAppliedCount: 0,
      realtimeSkippedByBudget: false,
    };
  }

  if (!tryConsumeApiBudget(options?.apiBudget, "realtime_price_batch", 1)) {
    return {
      priceByCode,
      marketPhase: "intraday",
      realtimeAppliedCount: 0,
      realtimeSkippedByBudget: true,
    };
  }

  const realtimeByCode = await fetchRealtimePriceBatch(candidates.map((candidate) => candidate.code));
  let realtimeAppliedCount = 0;

  for (const candidate of candidates) {
    const realtimePrice = Number(realtimeByCode[candidate.code]?.price ?? 0);
    if (Number.isFinite(realtimePrice) && realtimePrice > 0) {
      priceByCode.set(candidate.code, { price: realtimePrice, source: "realtime" });
      realtimeAppliedCount += 1;
    }
  }

  return {
    priceByCode,
    marketPhase: "intraday",
    realtimeAppliedCount,
    realtimeSkippedByBudget: false,
  };
}

function normalizeStock(input: ScoreCandidateRow["stock"]): {
  name: string;
  close: number;
  rsi14?: number | null;
  liquidity?: number | null;
  market?: string | null;
  marketCap?: number | null;
  universeLevel?: string | null;
  isSectorLeader?: boolean | null;
} | null {
  const row = Array.isArray(input) ? input[0] : input;
  if (!row) return null;
  const close = toNumber(row.close, 0);
  if (close <= 0) return null;
  return {
    name: String(row.name ?? ""),
    close,
    rsi14: toNumber((row as Record<string, unknown>).rsi14, 0) || null,
    liquidity: toNumber((row as Record<string, unknown>).liquidity, 0) || null,
    market: String((row as Record<string, unknown>).market ?? "") || null,
    marketCap: toNumber((row as Record<string, unknown>).market_cap, 0) || null,
    universeLevel: String((row as Record<string, unknown>).universe_level ?? "") || null,
    isSectorLeader: typeof (row as Record<string, unknown>).is_sector_leader === "boolean"
      ? (row as Record<string, unknown>).is_sector_leader as boolean
      : null,
  };
}

function extractScoreFactors(
  factors: unknown
): Record<string, unknown> | null {
  if (!factors || typeof factors !== "object" || Array.isArray(factors)) {
    return null;
  }
  return factors as Record<string, unknown>;
}


function isMissingScoresSignalColumn(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const rec = error as Record<string, unknown>;
  const code = String(rec.code ?? "").trim();
  const message = String(rec.message ?? rec.details ?? "").toLowerCase();
  return (
    code === "42703" ||
    (message.includes("scores.signal") && message.includes("does not exist"))
  );
}

function isMissingVirtualPositionHorizonColumns(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const rec = error as Record<string, unknown>;
  const code = String(rec.code ?? "").trim();
  const message = String(rec.message ?? rec.details ?? "").toLowerCase();
  if (code !== "42703") return false;
  return (
    message.includes("target_horizon") ||
    message.includes("horizon_reason") ||
    message.includes("macro_context_at_entry") ||
    message.includes("news_context_at_entry") ||
    message.includes("planned_review_at")
  );
}

function queryErrorMessage(error: unknown): string {
  if (!error) return "unknown error";
  if (typeof error === "object") {
    const rec = error as Record<string, unknown>;
    const message = String(rec.message ?? rec.details ?? rec.hint ?? "").trim();
    if (message) return message;
  }
  return String(error);
}

type StopLossActionRow = {
  code?: string | null;
  created_at?: string | null;
  detail?: Record<string, unknown> | null;
};

function resolveStopLossCooldownDays(action: StopLossActionRow): number {
  const detail = (action.detail && typeof action.detail === "object") ? action.detail : null;
  const context = String(detail?.stopLossContext ?? "").trim().toLowerCase();
  const pnl = toNumber(detail?.pnl, 0);

  if (context === "trend-break-major" || context === "signal-strong-sell") return 10;
  if (context === "signal-reversal") return 8;
  if (pnl <= -8) return 10;
  if (pnl <= -5) return 7;
  return 5;
}

function isStopLossCooldownActive(action: StopLossActionRow, nowMs: number): boolean {
  const createdAtMs = Date.parse(String(action.created_at ?? ""));
  if (!Number.isFinite(createdAtMs)) return false;
  const cooldownDays = resolveStopLossCooldownDays(action);
  const elapsedMs = nowMs - createdAtMs;
  return elapsedMs < cooldownDays * 24 * 60 * 60 * 1000;
}

async function fetchStopLossCooldownCodes(payload: {
  supabase: SupabaseClientAny;
  chatId: number;
  lookbackDays?: number;
}): Promise<Set<string>> {
  const nowMs = Date.now();
  const lookbackDays = Math.max(10, Math.floor(payload.lookbackDays ?? 21));
  const since = new Date(nowMs - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await payload.supabase
    .from("virtual_autotrade_actions")
    .select("code, created_at, detail")
    .eq("chat_id", payload.chatId)
    .eq("action_type", "SELL")
    .eq("reason", "stop-loss")
    .gte("created_at", since)
    .limit(500);

  const codes = new Set<string>();
  for (const row of (data ?? []) as StopLossActionRow[]) {
    const code = String(row.code ?? "").trim();
    if (!code) continue;
    if (isStopLossCooldownActive(row, nowMs)) codes.add(code);
  }
  return codes;
}

async function fetchLegacyVirtualPositionsForChat(payload: {
  supabase: SupabaseClientAny;
  chatId: number;
  select: string;
  status?: string;
}): Promise<{ data: Record<string, unknown>[] | null; error: unknown }> {
  let query = payload.supabase
    .from(PORTFOLIO_TABLES.positions)
    .select(payload.select)
    .eq("chat_id", payload.chatId)
    .is("broker_name", null)
    .is("account_name", null);

  if (payload.status) {
    query = query.eq("status", payload.status);
  }

  const result = await query;
  return {
    data: (result.data ?? null) as Record<string, unknown>[] | null,
    error: result.error,
  };
}

async function fetchLegacyPositionByCode(payload: {
  supabase: SupabaseClientAny;
  chatId: number;
  code: string;
}): Promise<{ data: { id?: number | null; broker_name?: string | null; account_name?: string | null } | null; error: unknown }> {
  const result = await payload.supabase
    .from(PORTFOLIO_TABLES.positions)
    .select("id, broker_name, account_name")
    .eq("chat_id", payload.chatId)
    .eq("code", payload.code)
    .maybeSingle();

  return {
    data: (result.data as { id?: number | null; broker_name?: string | null; account_name?: string | null } | null) ?? null,
    error: result.error,
  };
}

async function appendTradeLog(payload: {
  supabase: SupabaseClientAny;
  chatId: number;
  code: string;
  side: "BUY" | "SELL" | "ADJUST";
  price: number;
  quantity: number;
  grossAmount: number;
  netAmount: number;
  feeAmount?: number;
  taxAmount?: number;
  pnlAmount?: number;
  memo?: string;
  source?: "MANUAL" | "AUTO" | "ADJUST"; // 추가: 거래 출처
  brokerName?: string | null;
  accountName?: string | null;
}): Promise<number | null> {
  const { data, error } = await payload.supabase
    .from(PORTFOLIO_TABLES.trades)
    .insert({
      chat_id: payload.chatId,
      code: payload.code,
      side: payload.side,
      price: payload.price,
      quantity: payload.quantity,
      gross_amount: payload.grossAmount,
      net_amount: payload.netAmount,
      fee_amount: payload.feeAmount ?? 0,
      tax_amount: payload.taxAmount ?? 0,
      pnl_amount: payload.pnlAmount ?? 0,
      memo: payload.memo ?? null,
      source: payload.source ?? "MANUAL",
      broker_name: payload.brokerName ?? null,
      account_name: payload.accountName ?? null,
      traded_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  return Number((data as Record<string, unknown> | null)?.id ?? 0) || null;
}

async function tryRegisterOperation(params: {
  supabase: SupabaseClientAny;
  opKey: string;
  chatId: number | string;
  strategy?: string | null;
  meta?: Record<string, unknown> | null;
}): Promise<boolean> {
  const supabase = params.supabase;
  const row = {
    op_key: String(params.opKey),
    user_id: String(params.chatId),
    strategy: params.strategy ?? null,
    meta: params.meta ?? null,
  };

  const { data, error } = await supabase
    .from("executed_operations")
    .upsert(row, { onConflict: "op_key", ignoreDuplicates: true })
    .select("op_key")
    .maybeSingle();

  if (error) {
    throw error;
  }

  // if data is null, the upsert was ignored (duplicate)
  return Boolean(data && (data as Record<string, unknown>).op_key);
}

async function tryAcquireRunLock(supabase: SupabaseClientAny, opKey: string): Promise<boolean> {
  // Requires a table `virtual_autotrade_locks(op_key text primary key, acquired_at timestamptz default now())`
  const { data, error } = await supabase
    .from("virtual_autotrade_locks")
    .upsert({ op_key: opKey }, { onConflict: "op_key", ignoreDuplicates: true })
    .select("op_key")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data && (data as Record<string, unknown>).op_key);
}

async function releaseRunLock(supabase: SupabaseClientAny, opKey: string): Promise<void> {
  await supabase.from("virtual_autotrade_locks").delete().eq("op_key", opKey);
}

async function writeActionLog(payload: {
  supabase: SupabaseClientAny;
  runId: number | null;
  chatId: number;
  code?: string;
  actionType: "BUY" | "SELL" | "HOLD" | "SKIP" | "ERROR";
  reason?: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  await payload.supabase.from("virtual_autotrade_actions").insert({
    run_id: payload.runId,
    chat_id: payload.chatId,
    code: payload.code ?? null,
    action_type: payload.actionType,
    reason: payload.reason ?? null,
    detail: payload.detail ?? null,
  });
}

async function getRecentAutoTradeMetrics(payload: {
  supabase: SupabaseClientAny;
  chatId: number;
  windowDays?: number;
}): Promise<AutoTradeRecentMetrics | null> {
  const windowDays = Math.max(1, Math.floor(payload.windowDays ?? 7));
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  const [actionsResp, runsResp] = await Promise.all([
    payload.supabase
      .from("virtual_autotrade_actions")
      .select("action_type, reason, created_at")
      .eq("chat_id", payload.chatId)
      .gte("created_at", since)
      .limit(2000),
    payload.supabase
      .from("virtual_autotrade_runs")
      .select("id, started_at")
      .eq("chat_id", payload.chatId)
      .gte("started_at", since)
      .limit(500),
  ]);

  if (actionsResp.error || runsResp.error) {
    return null;
  }

  const actions = (actionsResp.data ?? []) as Array<{
    action_type?: string | null;
    reason?: string | null;
    created_at?: string | null;
  }>;
  const runs = (runsResp.data ?? []) as Array<{ id?: number | null; started_at?: string | null }>;

  let buyActions = 0;
  let sellActions = 0;
  let skipActions = 0;
  let errorActions = 0;
  const skipReasonMap = new Map<string, number>();
  const activeDayKeys = new Set<string>();

  for (const row of actions) {
    const actionType = String(row.action_type ?? "").trim().toUpperCase();
    if (actionType === "BUY") buyActions += 1;
    if (actionType === "SELL") sellActions += 1;
    if (actionType === "SKIP") skipActions += 1;
    if (actionType === "ERROR") errorActions += 1;

    if (actionType === "SKIP") {
      const reason = String(row.reason ?? "기타").trim() || "기타";
      skipReasonMap.set(reason, (skipReasonMap.get(reason) ?? 0) + 1);
    }

    if (row.created_at) {
      activeDayKeys.add(String(row.created_at).slice(0, 10));
    }
  }

  const topSkipReasons = Array.from(skipReasonMap.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  return {
    windowDays,
    runCount: runs.length,
    activeDays: activeDayKeys.size,
    buyActions,
    sellActions,
    skipActions,
    errorActions,
    topSkipReasons,
  };
}

async function getRecentAutoTradeSellPerformance(payload: {
  supabase: SupabaseClientAny;
  chatId: number;
  windowDays?: number;
}): Promise<AutoTradeSellPerformance | null> {
  const windowDays = Math.max(7, Math.floor(payload.windowDays ?? 45));
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await payload.supabase
    .from(PORTFOLIO_TABLES.trades)
    .select("side, pnl_amount, memo, traded_at")
    .eq("chat_id", payload.chatId)
    .eq("side", "SELL")
    .is("broker_name", null)
    .is("account_name", null)
    .gte("traded_at", since)
    .order("traded_at", { ascending: true })
    .limit(5000);

  if (error) return null;

  const rows = (data ?? []) as Array<{
    side?: string | null;
    pnl_amount?: number | null;
    memo?: string | null;
  }>;

  const pnls: number[] = [];
  for (const row of rows) {
    const strategyId = parseStrategyMemo(row.memo).strategyId;
    if (strategyId !== AUTO_TRADE_STRATEGY_ID) continue;
    pnls.push(toNumber(row.pnl_amount, 0));
  }

  if (!pnls.length) {
    return {
      windowDays,
      sellCount: 0,
      winRate: 0,
      profitFactor: null,
      maxLossStreak: 0,
    };
  }

  const wins = pnls.filter((value) => value > 0);
  const losses = pnls.filter((value) => value < 0);
  const grossWin = wins.reduce((acc, value) => acc + value, 0);
  const grossLossAbs = Math.abs(losses.reduce((acc, value) => acc + value, 0));

  let maxLossStreak = 0;
  let currentLossStreak = 0;
  for (const pnl of pnls) {
    if (pnl < 0) {
      currentLossStreak += 1;
      if (currentLossStreak > maxLossStreak) maxLossStreak = currentLossStreak;
    } else {
      currentLossStreak = 0;
    }
  }

  return {
    windowDays,
    sellCount: pnls.length,
    winRate: (wins.length / pnls.length) * 100,
    profitFactor: grossLossAbs > 0 ? grossWin / grossLossAbs : null,
    maxLossStreak,
  };
}

function applyPerformanceBuyGuard(input: {
  requestedSlots: number;
  baseMinBuyScore: number;
  perf: AutoTradeSellPerformance | null;
}): { requestedSlots: number; baseMinBuyScore: number; note?: string } {
  const requestedSlots = Math.max(0, Math.floor(input.requestedSlots));
  const baseMinBuyScore = toPositiveInt(input.baseMinBuyScore, 72);
  const perf = input.perf;

  if (!perf || perf.sellCount < 8) {
    return { requestedSlots, baseMinBuyScore };
  }

  const pf = perf.profitFactor;
  const isRiskOff = (pf != null && pf < 0.9) || perf.maxLossStreak >= 4;
  if (isRiskOff) {
    return {
      requestedSlots: Math.max(0, requestedSlots - 1),
      baseMinBuyScore: Math.min(95, baseMinBuyScore + 3),
      note: `성과게이트(보수): 최근 ${perf.windowDays}일 PF ${pf != null ? pf.toFixed(2) : "N/A"}, 연속손실 ${perf.maxLossStreak}회 -> 슬롯 -1, 최소점수 +3`,
    };
  }

  const isRiskOn =
    perf.sellCount >= 12 &&
    pf != null &&
    pf >= 1.25 &&
    perf.winRate >= 55;
  if (isRiskOn) {
    return {
      requestedSlots,
      baseMinBuyScore: Math.max(50, baseMinBuyScore - 2),
      note: `성과게이트(완화): 최근 ${perf.windowDays}일 PF ${pf.toFixed(2)}, 승률 ${perf.winRate.toFixed(1)}% -> 최소점수 -2`,
    };
  }

  return {
    requestedSlots,
    baseMinBuyScore,
    note: `성과게이트(유지): 최근 ${perf.windowDays}일 PF ${pf != null ? pf.toFixed(2) : "N/A"}, 승률 ${perf.winRate.toFixed(1)}%`,
  };
}

/**
 * 적응형 출구 전략 조정 엔진
 * 최근 매도 성과(손절 연속 패턴, 익절 비율) → stopLossPct / takeProfitPct 자동 조정
 * - 연속 손절 3회 이상: 손절 기준 타이트하게 (더 일찍 끊기)
 * - 익절 비율 높고 PF 양호: 익절 목표를 소폭 늘려 수익 연장
 * - 평균 손절 비율 분석: 실제 -X%에서 끊기는지 파악 후 기준 조정
 */
export function applyAdaptiveExitGuard(input: {
  baseStopLossPct: number;
  baseTakeProfitPct: number;
  perf: AutoTradeSellPerformance | null;
}): { stopLossPct: number; takeProfitPct: number; note?: string } {
  const stopLossPct = Math.abs(toNumber(input.baseStopLossPct, 4));
  const takeProfitPct = Math.abs(toNumber(input.baseTakeProfitPct, 8));
  const perf = input.perf;

  if (!perf || perf.sellCount < 5) {
    return { stopLossPct, takeProfitPct };
  }

  const notes: string[] = [];

  // 연속 손절 3회 이상 → 손절 기준 더 타이트하게 (빠른 손절)
  if (perf.maxLossStreak >= 3) {
    const tighterStop = Math.max(2, stopLossPct - 1.0);
    notes.push(`연속손실 ${perf.maxLossStreak}회 → 손절 ${stopLossPct.toFixed(1)}% → ${tighterStop.toFixed(1)}%`);
    return {
      stopLossPct: tighterStop,
      takeProfitPct,
      note: notes.join(" · "),
    };
  }

  // 승률 높고 PF 양호 → 익절 목표 소폭 연장 (수익 더 끌기)
  if (
    perf.sellCount >= 10 &&
    perf.winRate >= 55 &&
    perf.profitFactor != null &&
    perf.profitFactor >= 1.2
  ) {
    const extendedTP = Math.min(15, takeProfitPct + 1.5);
    notes.push(`승률 ${perf.winRate.toFixed(1)}% PF ${perf.profitFactor.toFixed(2)} → 익절 ${takeProfitPct.toFixed(1)}% → ${extendedTP.toFixed(1)}%`);
    return {
      stopLossPct,
      takeProfitPct: extendedTP,
      note: notes.join(" · "),
    };
  }

  return { stopLossPct, takeProfitPct };
}

function applyPersistedGateGuard(input: {
  requestedSlots: number;
  baseMinBuyScore: number;
  gateStatus?: "promote" | "hold" | "watch" | "pause";
}): { requestedSlots: number; baseMinBuyScore: number; note?: string } {
  const requestedSlots = Math.max(0, Math.floor(input.requestedSlots));
  const baseMinBuyScore = toPositiveInt(input.baseMinBuyScore, 72);

  if (!input.gateStatus || input.gateStatus === "hold") {
    return { requestedSlots, baseMinBuyScore };
  }

  if (input.gateStatus === "pause") {
    return {
      requestedSlots: 0,
      baseMinBuyScore: Math.min(98, baseMinBuyScore + 5),
      note: "저장 게이트(중단 후보): 신규·추가 매수 차단",
    };
  }

  if (input.gateStatus === "watch") {
    return {
      requestedSlots: Math.max(0, requestedSlots - 1),
      baseMinBuyScore: Math.min(96, baseMinBuyScore + 2),
      note: "저장 게이트(관찰): 슬롯 -1, 최소점수 +2",
    };
  }

  return {
    requestedSlots,
    baseMinBuyScore: Math.max(50, baseMinBuyScore - 1),
    note: "저장 게이트(승격 후보): 최소점수 -1",
  };
}

function applyMarketRegimeBuyGuard(input: {
  baseMinBuyScore: number;
  marketOverview?: {
    vix?: { price?: number | null } | null;
    fearGreed?: { score?: number | null } | null;
  } | null;
}): { minBuyScore: number; note?: string } {
  const baseMinBuyScore = toPositiveInt(input.baseMinBuyScore, 72);
  const vix = toNumber(input.marketOverview?.vix?.price, 0);
  const fearGreed = toNumber(input.marketOverview?.fearGreed?.score, 50);

  if (vix >= 30) {
    const minBuyScore = Math.max(baseMinBuyScore, 78);
    return {
      minBuyScore,
      note: `시장게이트(초고변동): VIX ${vix.toFixed(1)} -> 최소점수 ${minBuyScore}점`,
    };
  }

  if (vix >= 25) {
    const minBuyScore = Math.max(baseMinBuyScore, 75);
    return {
      minBuyScore,
      note: `시장게이트(변동성 경계): VIX ${vix.toFixed(1)} -> 최소점수 ${minBuyScore}점`,
    };
  }

  if (fearGreed <= 20) {
    const minBuyScore = Math.max(50, Math.min(baseMinBuyScore, 65));
    return {
      minBuyScore,
      note: `시장게이트(극단 공포): 공포탐욕 ${fearGreed.toFixed(0)} -> 최소점수 ${minBuyScore}점`,
    };
  }

  return { minBuyScore: baseMinBuyScore };
}

export async function generateAutoTradeBacktestReportForChat(input: {
  chatId: number;
  months: 3 | 6;
}): Promise<{
  months: 3 | 6;
  totalTrades: number;
  buyTrades: number;
  sellTrades: number;
  realizedPnl: number;
  winRatePct: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  maxLossStreak: number;
}> {
  const supabase: SupabaseClientAny = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const months = input.months;
  const since = new Date();
  since.setMonth(since.getMonth() - months);

  const { data, error } = await supabase
    .from(PORTFOLIO_TABLES.trades)
    .select("side, pnl_amount, traded_at")
    .eq("chat_id", input.chatId)
    .is("broker_name", null)
    .is("account_name", null)
    .gte("traded_at", since.toISOString())
    .order("traded_at", { ascending: true })
    .limit(20000);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as Array<{
    side?: string | null;
    pnl_amount?: number | null;
  }>;

  let buyTrades = 0;
  let sellTrades = 0;
  let realizedPnl = 0;
  const wins: number[] = [];
  const losses: number[] = [];
  let currentLossStreak = 0;
  let maxLossStreak = 0;

  for (const row of rows) {
    const side = String(row.side ?? "").toUpperCase();
    if (side === "BUY") {
      buyTrades += 1;
      continue;
    }
    if (side !== "SELL") {
      continue;
    }

    sellTrades += 1;
    const pnl = toNumber(row.pnl_amount, 0);
    realizedPnl += pnl;

    if (pnl > 0) {
      wins.push(pnl);
      currentLossStreak = 0;
    } else if (pnl < 0) {
      losses.push(Math.abs(pnl));
      currentLossStreak += 1;
      maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
    }
  }

  const winRatePct = sellTrades > 0 ? (wins.length / sellTrades) * 100 : 0;
  const avgWin = wins.length ? wins.reduce((sum, value) => sum + value, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((sum, value) => sum + value, 0) / losses.length : 0;
  const grossWin = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = losses.reduce((sum, value) => sum + value, 0);
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0;

  return {
    months,
    totalTrades: buyTrades + sellTrades,
    buyTrades,
    sellTrades,
    realizedPnl,
    winRatePct,
    avgWin,
    avgLoss,
    profitFactor,
    maxLossStreak,
  };
}

function getKstDayRange(base = new Date()): { startIso: string; endIso: string } {
  const dayMs = 24 * 60 * 60 * 1000;
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const kstNowMs = base.getTime() + kstOffsetMs;
  const kstStartMs = Math.floor(kstNowMs / dayMs) * dayMs;
  const utcStartMs = kstStartMs - kstOffsetMs;
  return {
    startIso: new Date(utcStartMs).toISOString(),
    endIso: new Date(utcStartMs + dayMs).toISOString(),
  };
}

async function getDailyRealizedPnl(payload: {
  supabase: SupabaseClientAny;
  chatId: number;
}): Promise<number> {
  const { startIso, endIso } = getKstDayRange();
  const { data, error } = await payload.supabase
    .from(PORTFOLIO_TABLES.trades)
    .select("pnl_amount")
    .eq("chat_id", payload.chatId)
    .eq("side", "SELL")
    .is("broker_name", null)
    .is("account_name", null)
    .gte("traded_at", startIso)
    .lt("traded_at", endIso)
    .limit(3000);

  if (error) return 0;

  return (data ?? []).reduce((sum: number, row: Record<string, unknown>) => {
    return sum + toNumber(row.pnl_amount, 0);
  }, 0);
}

async function getLatestScoreAsof(
  supabase: SupabaseClientAny
): Promise<string | null> {
  const { data, error } = await supabase
    .from("scores")
    .select("asof")
    .order("asof", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  if (!data) return null;
  return String((data as Record<string, unknown>).asof ?? "") || null;
}

async function getLatestInvestorAsof(
  supabase: SupabaseClientAny
): Promise<string | null> {
  const { data, error } = await supabase
    .from("investor_daily")
    .select("date")
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return String((data as Record<string, unknown>).date ?? "") || null;
}

type AutoTradeDataQuality = {
  qualityScore: number;
  band: "high" | "medium" | "low";
  limitScale: number;
  minScoreBoost: number;
  blockNewBuys: boolean;
  note: string;
  investorStaleBusinessDays: number | null;
};

function assessAutoTradeDataQuality(input: {
  scoreStaleBusinessDays: number;
  investorStaleBusinessDays: number | null;
}): AutoTradeDataQuality {
  const scoreLag = Math.max(0, Math.floor(toNumber(input.scoreStaleBusinessDays, 0)));
  const invLag =
    input.investorStaleBusinessDays == null
      ? null
      : Math.max(0, Math.floor(toNumber(input.investorStaleBusinessDays, 0)));

  let qualityScore = 100;
  qualityScore -= scoreLag * 12;
  if (invLag == null) {
    qualityScore -= 40;
  } else {
    qualityScore -= invLag * 8;
  }
  qualityScore = clamp(qualityScore, 0, 100);

  if (scoreLag >= 2 || invLag == null || invLag >= 6) {
    return {
      qualityScore,
      band: "low",
      limitScale: 0.0,
      minScoreBoost: 8,
      blockNewBuys: true,
      note:
        invLag == null
          ? "수급 기준일 확인 불가로 신규 매수 차단"
          : `수급 기준일 지연(${invLag}영업일)으로 신규 매수 차단`,
      investorStaleBusinessDays: invLag,
    };
  }

  if (scoreLag >= 1 || (invLag != null && invLag >= 3)) {
    return {
      qualityScore,
      band: "medium",
      limitScale: 0.6,
      minScoreBoost: 4,
      blockNewBuys: false,
      note:
        invLag != null && invLag >= 3
          ? `수급 지연(${invLag}영업일)으로 진입 수 축소(60%) + 최소점수 +4 보수화`
          : "점수 기준일 1영업일 지연으로 진입 수 축소(60%) + 최소점수 +4 보수화",
      investorStaleBusinessDays: invLag,
    };
  }

  return {
    qualityScore,
    band: "high",
    limitScale: 1,
    minScoreBoost: 0,
    blockNewBuys: false,
    note: invLag == null ? "데이터 품질 판단 제한" : "데이터 품질 양호",
    investorStaleBusinessDays: invLag,
  };
}

async function fetchLatestRankedRows(payload: {
  supabase: SupabaseClientAny;
  limit: number;
  codes?: string[];
}): Promise<{ rows: RankedCandidate[]; latestAsof: string | null }> {
  const latestAsof = await getLatestScoreAsof(payload.supabase);
  if (!latestAsof) {
    return { rows: [], latestAsof: null };
  }

  const queryLimit = Math.max(1, Math.min(2000, Math.floor(payload.limit)));
  const selectWithSignal =
    "code,total_score,signal,factors,stock:stocks!inner(code,name,close,rsi14,liquidity,market,market_cap,universe_level,is_sector_leader)";
  const selectWithoutSignal =
    "code,total_score,factors,stock:stocks!inner(code,name,close,rsi14,liquidity,market,market_cap,universe_level,is_sector_leader)";

  const buildQuery = async (selectClause: string) => {
    let query = payload.supabase
      .from("scores")
      .select(selectClause)
      .eq("asof", latestAsof)
      .order("total_score", { ascending: false })
      .limit(queryLimit);

    if (payload.codes?.length) {
      query = query.in("code", payload.codes);
    }

    return query;
  };

  let data: unknown[] | null = null;
  let error: unknown = null;

  ({ data, error } = await buildQuery(selectWithSignal));

  if (error && isMissingScoresSignalColumn(error)) {
    ({ data, error } = await buildQuery(selectWithoutSignal));
  }

  if (error) {
    throw error;
  }

  const rankedRows: RankedCandidate[] = [];

  for (const row of (data ?? []) as ScoreCandidateRow[]) {
    const stock = normalizeStock(row.stock);
    if (!stock) continue;
    const rawFactors = (row.factors ?? {}) as Record<string, unknown>;
    const rawPer = Number(rawFactors.per);
    const per = Number.isFinite(rawPer) && rawPer > 0 ? rawPer : null;
    const earningsGrowthPct = resolveEarningsGrowthPctFromFactors(rawFactors);
    const rawPeg = Number(rawFactors.peg);
    const peg =
      Number.isFinite(rawPeg) && rawPeg > 0
        ? rawPeg
        : per != null && earningsGrowthPct != null && earningsGrowthPct > 0
        ? per / earningsGrowthPct
        : null;

    const rawSma20 = Number(rawFactors.sma20);
    const sma20 = Number.isFinite(rawSma20) && rawSma20 > 0 ? rawSma20 : null;
    const aboveSma20 = sma20 != null && stock.close > 0 ? stock.close > sma20 : null;

    rankedRows.push({
      code: row.code,
      close: stock.close,
      score: toNumber(row.total_score, 0),
      name: stock.name || row.code,
      peg,
      per,
      earningsGrowthPct,
      signal: row.signal ?? null,
      rsi14: stock.rsi14 ?? null,
      liquidity: stock.liquidity ?? null,
      market: stock.market ?? null,
      marketCap: stock.marketCap ?? null,
      universeLevel: stock.universeLevel ?? null,
      isSectorLeader: stock.isSectorLeader ?? null,
      aboveSma20,
      stableTurn: String(rawFactors.stable_turn ?? "").trim() || null,
      stableTrust: Number.isFinite(Number(rawFactors.stable_turn_trust))
        ? Number(rawFactors.stable_turn_trust)
        : null,
      stableAboveAvg:
        typeof rawFactors.stable_above_avg === "boolean"
          ? (rawFactors.stable_above_avg as boolean)
          : null,
      stableAccumulation:
        typeof rawFactors.stable_accumulation === "boolean"
          ? (rawFactors.stable_accumulation as boolean)
          : null,
    });
  }

  return { rows: rankedRows, latestAsof };
}
async function selectDailyAddOnCandidates(payload: {
  supabase: SupabaseClientAny;
  holdings: HoldingRow[];
  limit: number;
  minBuyScore: number;
  accountStrategy?: string | null;
  baseTakeProfitPct: number;
  baseStopLossPct: number;
  sellSplitCount: number;
  marketPolicy?: AutoTradeMarketPolicy;
}): Promise<AutoTradeCandidateSelectionResult> {
  const codes = payload.holdings.map((holding) => holding.code).filter(Boolean);
  const { rows, latestAsof } = await fetchLatestRankedRows({
    supabase: payload.supabase,
    limit: Math.max(payload.limit * 5, codes.length || 1),
    codes,
  });

  const holdingsByCode = new Map(
    payload.holdings.map((holding) => {
      const profile = resolvePositionTradeProfile({
        accountStrategy: payload.accountStrategy,
        positionMemo: holding.memo,
        baseTakeProfitPct: payload.baseTakeProfitPct,
        baseStopLossPct: payload.baseStopLossPct,
        sellSplitCount: payload.sellSplitCount,
      });
      return [
        holding.code,
        {
          code: holding.code,
          buyPrice: toNumber(holding.buy_price, 0),
          allowAddOn: profile.allowAddOn,
        },
      ];
    })
  );

  const selection = pickAutoTradeAddOnCandidates({
    rows,
    preferredMinBuyScore: payload.minBuyScore,
    limit: payload.limit,
    holdingsByCode,
    marketPolicy: payload.marketPolicy,
  });

  return {
    ...selection,
    latestAsof,
  };
}

async function selectMondayCandidates(payload: {
  supabase: SupabaseClientAny;
  chatId: number;
  minBuyScore: number;
  limit: number;
  heldCodes: Set<string>;
  marketPolicy?: AutoTradeMarketPolicy;
  selectedStrategy?: string | null;
  riskProfile?: string | null;
  discoveryProfile?: DiscoveryProfile;
}): Promise<AutoTradeCandidateSelectionResult> {
  const { rows: rankedRows, latestAsof } = await fetchLatestRankedRows({
    supabase: payload.supabase,
    limit: Math.max(payload.limit * 20, 300),
  });

  // 손절 쿨다운: 손절 원인/손실폭에 따라 5~10일 차등 적용
  const cooldownCodes = await fetchStopLossCooldownCodes({
    supabase: payload.supabase,
    chatId: payload.chatId,
    lookbackDays: 21,
  });
  const heldAndCooldownCodes = new Set<string>([...payload.heldCodes, ...cooldownCodes]);
  if (!latestAsof) {
    return {
      candidates: [],
      selectionMode: "none",
      thresholdUsed: toPositiveInt(payload.minBuyScore, 70),
      latestTopScore: 0,
      latestAsof: null,
      filteringMetrics: {
        initialCount: 0,
        afterMarketPolicyCount: 0,
        afterBaseFilterCount: 0,
        candidatePoolCount: 0,
        selectedCount: 0,
      },
      entryProfile: "score-first",
      pullbackCandidatesUsed: 0,
      aggressiveCandidatesUsed: 0,
    };
  }

  const staleBusinessDays = businessDaysBehind(latestAsof);
  if (staleBusinessDays == null || staleBusinessDays > 1) {
    return {
      candidates: [],
      selectionMode: "none",
      thresholdUsed: Math.min(98, Math.max(70, toPositiveInt(payload.minBuyScore, 70) + 6)),
      latestTopScore: rankedRows[0]?.score ?? 0,
      latestAsof,
      filteringMetrics: {
        initialCount: rankedRows.length,
        afterMarketPolicyCount: 0,
        afterBaseFilterCount: 0,
        candidatePoolCount: 0,
        selectedCount: 0,
      },
      entryProfile: "score-first",
      pullbackCandidatesUsed: 0,
      aggressiveCandidatesUsed: 0,
      guardNote: `점수 기준일 지연(${staleBusinessDays == null ? "확인불가" : `${staleBusinessDays}영업일`})으로 신규 매수 차단`,
    };
  }

  const staleAdjustedMinBuyScore =
    staleBusinessDays === 1
      ? Math.min(95, toPositiveInt(payload.minBuyScore, 70) + 2)
      : toPositiveInt(payload.minBuyScore, 70);

  const latestInvestorAsof = await getLatestInvestorAsof(payload.supabase);
  const investorStaleBusinessDays = businessDaysBehind(latestInvestorAsof);
  const dataQuality = assessAutoTradeDataQuality({
    scoreStaleBusinessDays: staleBusinessDays,
    investorStaleBusinessDays,
  });

  if (dataQuality.blockNewBuys) {
    return {
      candidates: [],
      selectionMode: "none",
      thresholdUsed: Math.min(98, staleAdjustedMinBuyScore + dataQuality.minScoreBoost),
      latestTopScore: rankedRows[0]?.score ?? 0,
      latestAsof,
      filteringMetrics: {
        initialCount: rankedRows.length,
        afterMarketPolicyCount: 0,
        afterBaseFilterCount: 0,
        candidatePoolCount: 0,
        selectedCount: 0,
      },
      entryProfile: "score-first",
      pullbackCandidatesUsed: 0,
      aggressiveCandidatesUsed: 0,
      guardNote: `데이터 품질 게이트: ${dataQuality.note} (품질점수 ${dataQuality.qualityScore}, 점수기준일 ${latestAsof}, 수급기준일 ${latestInvestorAsof ?? "없음"})`,
    };
  }

  const qualityAdjustedMinBuyScore = Math.min(
    98,
    staleAdjustedMinBuyScore + dataQuality.minScoreBoost
  );
  const qualityAdjustedLimit = Math.max(
    1,
    Math.floor(payload.limit * dataQuality.limitScale)
  );

  const discoveryProfile = normalizeDiscoveryProfile(payload.discoveryProfile);

  const baseEntryProfile = deriveEntryProfile({
    selectedStrategy: payload.selectedStrategy,
    riskProfile: payload.riskProfile,
  });

  const entryProfile =
    discoveryProfile === "PULLBACK" || discoveryProfile === "BLEND"
      ? "pullback-first"
      : baseEntryProfile;

  const pullbackCandidateCodes =
    entryProfile === "pullback-first"
      ? await fetchLatestPullbackCandidateCodes({
          supabase: payload.supabase,
          limit: Math.max(payload.limit * 4, 20),
        })
      : undefined;

  const highlightCodes = new Set(
    rankedRows
      .filter((row) => {
        const signal = String(row.signal ?? "").trim().toUpperCase();
        return signal === "BUY" || signal === "STRONG_BUY" || signal === "WATCH";
      })
      .slice(0, Math.max(payload.limit * 6, 24))
      .map((row) => row.code)
      .filter(Boolean)
  );

  const multibaggerCodes =
    discoveryProfile === "MULTIBAGGER" || discoveryProfile === "BLEND"
      ? new Set(
          (await discoverMultibaggerCandidates(Math.max(payload.limit * 3, 20)).catch(() => []))
            .map((pick) => pick.code)
            .filter(Boolean)
        )
      : undefined;

  const backtestEdgeProfile =
    discoveryProfile === "BACKTEST_EDGE" || discoveryProfile === "BLEND"
      ? await fetchBacktestEdgeProfile({
          supabase: payload.supabase,
          chatId: payload.chatId,
          limit: Math.max(payload.limit * 2, 12),
        })
      : null;

  const backtestEdgeCodes = backtestEdgeProfile?.codes;

  const boostedRows = applyDiscoveryBoostToRows({
    rows: rankedRows,
    discoveryProfile,
    highlightCodes,
    pullbackCandidateCodes,
    multibaggerCodes,
    backtestEdgeCodes,
    backtestBoostByCode: backtestEdgeProfile?.boostByCode,
  });

  const flowProfilesByCode = await fetchFlowSignalProfilesByCode({
    supabase: payload.supabase,
    codes: boostedRows.map((row) => row.code),
  });
  const scoredRows = applyFlowSignalProfilesToRows({
    rows: boostedRows,
    profileByCode: flowProfilesByCode,
  });

  const overlap2Count = scoredRows.filter((row) => toNumber(row.discoverySourceCount, 0) >= 2).length;
  const overlap3Count = scoredRows.filter((row) => toNumber(row.discoverySourceCount, 0) >= 3).length;
  const strongTodayBuyCount = scoredRows.filter((row) => toNumber(row.todayBuyScore, 0) >= 75).length;
  const immediateExcludeCount = scoredRows.filter((row) => row.immediateExcludeSignal === true).length;

  const selection = pickAutoTradeCandidates({
    rows: scoredRows,
    preferredMinBuyScore: qualityAdjustedMinBuyScore,
    limit: qualityAdjustedLimit,
    heldCodes: heldAndCooldownCodes,
    marketPolicy: payload.marketPolicy,
    entryProfile,
    pullbackCandidateCodes,
  });

  return {
    ...selection,
    latestAsof,
    thresholdUsed: Math.max(selection.thresholdUsed, qualityAdjustedMinBuyScore),
    guardNote:
      staleBusinessDays === 1
        ? `점수 기준일 1영업일 지연 보수 적용 · 데이터품질 ${dataQuality.band.toUpperCase()}(${dataQuality.qualityScore}) · ${dataQuality.note} · 발굴프로필 ${discoveryProfileLabel(discoveryProfile)}${cooldownCodes.size > 0 ? ` · 스탑로스 쿨다운 ${cooldownCodes.size}종목 제외` : ""}`
        : `발굴프로필 ${discoveryProfileLabel(discoveryProfile)}${
            discoveryProfile === "PULLBACK"
              ? ` · 눌림목 연동 ${pullbackCandidateCodes?.size ?? 0}종목`
              : ""
          }${
            discoveryProfile === "MULTIBAGGER"
              ? ` · 멀티배거 연동 ${multibaggerCodes?.size ?? 0}종목`
              : ""
          }${
            discoveryProfile === "BACKTEST_EDGE"
              ? ` · 백테스트 우수 연동 ${backtestEdgeCodes?.size ?? 0}종목${
                  backtestEdgeProfile ? ` (성과스케일 x${backtestEdgeProfile.regimeScale.toFixed(2)})` : ""
                }`
              : ""
          }${
            discoveryProfile === "BLEND"
              ? ` · 하이라이트 ${highlightCodes.size} · 눌림목 ${pullbackCandidateCodes?.size ?? 0} · 멀티배거 ${multibaggerCodes?.size ?? 0} · 백테스트 ${backtestEdgeCodes?.size ?? 0}`
              : ""
          } · 데이터품질 ${dataQuality.band.toUpperCase()}(${dataQuality.qualityScore}) · ${dataQuality.note} · 교집합(2+) ${overlap2Count}종목 · 교집합(3+) ${overlap3Count}종목 · 오늘매수강신호 ${strongTodayBuyCount}종목 · 즉시제외 ${immediateExcludeCount}종목${cooldownCodes.size > 0 ? ` · 스탑로스 쿨다운 ${cooldownCodes.size}종목 제외` : ""}`,
  };
}

async function runMondayBuyForUser(payload: {
  supabase: SupabaseClientAny;
  setting: AutoTradeSettingRow;
  runId: number | null;
  dryRun: boolean;
  apiBudget?: ApiBudget;
}): Promise<AutoTradeActionSummary> {
  const chatId = payload.setting.chat_id;
  const summary: AutoTradeActionSummary = {
    chatId,
    buys: 0,
    sells: 0,
    skipped: 0,
    errors: 0,
    notes: [],
  };

  const prefs = await getUserInvestmentPrefs(chatId);
  const discoveryProfile = normalizeDiscoveryProfile(prefs.discovery_profile);
  const signalTrustThresholds = resolveSignalTrustThresholdsFromPrefs(prefs);

  const { data: holdingRows, error: holdingError } = await fetchLegacyVirtualPositionsForChat({
    supabase: payload.supabase,
    chatId,
    select: "id, code, status",
  });

  if (holdingError) {
    const holdingErrorMessage = queryErrorMessage(holdingError);
    summary.errors += 1;
    summary.notes.push(`보유 조회 실패: ${holdingErrorMessage}`);
    await writeActionLog({
      supabase: payload.supabase,
      runId: payload.runId,
      chatId,
      actionType: "ERROR",
      reason: "holdings-fetch-failed",
      detail: { error: holdingErrorMessage },
    });
    return summary;
  }

  const holdings = (holdingRows ?? []) as Array<{ id: number; code: string; status?: string | null }>;
  const heldCodes = new Set(
    holdings
      .filter((row) => (row.status ?? "holding") !== "closed")
      .map((row) => String(row.code))
  );

  const selectedStrategy = payload.setting.selected_strategy;
  if (selectedStrategy) {
    summary.notes.push(`전략: ${getStrategyLabel(selectedStrategy) || selectedStrategy}`);
  }
  summary.notes.push(`발굴 소스: ${discoveryProfileLabel(discoveryProfile)}`);
  const longTermRatio = normalizeLongTermRatio(payload.setting.long_term_ratio, 70);
  summary.notes.push(`자산 비중: 장기 ${longTermRatio}% · 단기 ${100 - longTermRatio}%`);
  summary.notes.push(
    `신뢰도 임계값(${signalTrustThresholds.variant}): 신규 ${signalTrustThresholds.newBuy} · 추가 ${signalTrustThresholds.addOn} · 리밸런싱 ${signalTrustThresholds.rebalance}`
  );

  const recentMetricsForPacing = await getRecentAutoTradeMetrics({
    supabase: payload.supabase,
    chatId,
    windowDays: 20,
  });
  const pacingMetrics = await computeAutoTradePacingMetrics({
    supabase: payload.supabase,
    chatId,
    prefs,
    recentRunCount: recentMetricsForPacing?.runCount,
    recentBuyActions: recentMetricsForPacing?.buyActions,
  });

  summary.notes.push(
    `페이싱: 월수익 ${pacingMetrics.monthReturnPct.toFixed(2)}% / 목표 ${pacingMetrics.targetMonthlyPct.toFixed(2)}% (${pacingMetrics.state})`
  );

  const activeCount = heldCodes.size;
  const maxPositions = toPositiveInt(payload.setting.max_positions, 10);
  let rawRemainSlots = Math.max(
    0,
    Math.min(toPositiveInt(payload.setting.monday_buy_slots, 2), maxPositions - activeCount)
  );
  const storedCashRaw = Number(prefs.virtual_cash);
  const storedCash = Number.isFinite(storedCashRaw) ? Math.max(0, storedCashRaw) : null;
  const seedCapital = Math.max(
    0,
    toNumber(prefs.virtual_seed_capital, toNumber(prefs.capital_krw, 0))
  );
  let availableCash = storedCash ?? seedCapital;

  if ((storedCash ?? 0) <= 0 && seedCapital > 0) {
    availableCash = seedCapital;
    summary.notes.push(`가상현금 보정 적용: ${Math.round(availableCash).toLocaleString("ko-KR")}원`);
  }

  const marketOverviewResult = await fetchMarketOverviewWithBudget({
    apiBudget: payload.apiBudget,
  });
  const marketOverview = marketOverviewResult.overview;
  const marketPolicy = detectAutoTradeMarketPolicy({ overview: marketOverview });
  let deployableCash = resolveDeployableCash({
    availableCash,
    seedCapital,
    minCashReservePct: marketPolicy.minCashReservePct,
  });
  summary.notes.push(
    `시장모드: ${marketPolicy.label} · ${marketPolicy.reason} · 최소현금 ${marketPolicy.minCashReservePct}% 유지`
  );
  if (marketOverviewResult.skippedByBudget) {
    summary.notes.push("API 예산 보호: 시장 개요 조회 생략(기본 방어모드 규칙 사용)");
  }

  const dailyLossLimitPct = Math.max(0.5, toNumber(prefs.daily_loss_limit_pct, 5));
  const dailyRealizedPnl = await getDailyRealizedPnl({
    supabase: payload.supabase,
    chatId,
  });
  const dailyRiskBudget = resolveDailyRiskBudget({
    seedCapital,
    dailyLossLimitPct,
    dailyRealizedPnl,
  });
  const dailyLossLimitAmount = -Math.abs(dailyRiskBudget.lossCapAmount);
  if (dailyRiskBudget.blocked) {
    summary.skipped += 1;
    summary.notes.push(
      `신규 매수 중단: 일손실 한도 도달 (${fmtKrw(dailyRealizedPnl)} / 기준 ${fmtKrw(dailyLossLimitAmount)})`
    );
    await writeActionLog({
      supabase: payload.supabase,
      runId: payload.runId,
      chatId,
      actionType: "SKIP",
      reason: "daily-loss-limit-reached",
      detail: {
        dailyRealizedPnl,
        dailyLossLimitAmount,
        dailyLossLimitPct,
      },
    });
    return summary;
  }
  if (dailyRiskBudget.scale < 1) {
    summary.notes.push(
      `위험예산 축소: 일손실 사용 ${fmtKrw(-dailyRiskBudget.lossUsedAmount)} / 한도 ${fmtKrw(-dailyRiskBudget.lossCapAmount)} -> 매수예산 ${(dailyRiskBudget.scale * 100).toFixed(0)}% 적용`
    );
  }

  if (rawRemainSlots <= 0 && pacingMetrics.relaxLevel >= 2 && activeCount <= 0) {
    rawRemainSlots = 1;
  }

  const mondaySellPerf = await getRecentAutoTradeSellPerformance({
    supabase: payload.supabase,
    chatId,
    windowDays: 45,
  });
  const persistedGateState = await fetchStrategyGateState({
    supabase: payload.supabase,
    chatId,
    strategyId: AUTO_TRADE_STRATEGY_ID,
  }).catch(() => null);

  const perfGuardForMonday = applyPerformanceBuyGuard({
    requestedSlots: rawRemainSlots,
    baseMinBuyScore: toPositiveInt(payload.setting.min_buy_score, 72),
    perf: mondaySellPerf,
  });
  const persistedGuardForMonday = applyPersistedGateGuard({
    requestedSlots: perfGuardForMonday.requestedSlots,
    baseMinBuyScore: perfGuardForMonday.baseMinBuyScore,
    gateStatus: persistedGateState?.status,
  });

  const buyConstraint = applyStrategyBuyConstraint({
    selectedStrategy,
    requestedSlots: persistedGuardForMonday.requestedSlots,
    baseMinBuyScore: persistedGuardForMonday.baseMinBuyScore,
    activeCount,
    pacingRelaxLevel: pacingMetrics.relaxLevel,
  });

  if (perfGuardForMonday.note) {
    summary.notes.push(perfGuardForMonday.note);
  }
  if (persistedGuardForMonday.note) {
    summary.notes.push(persistedGuardForMonday.note);
  }

  if (pacingMetrics.relaxLevel > 0) {
    summary.notes.push(`페이싱 보정: 기준점수 완화 레벨 ${pacingMetrics.relaxLevel}`);
  }

  const marketRegimeGuard = applyMarketRegimeBuyGuard({
    baseMinBuyScore: buyConstraint.minBuyScore,
    marketOverview,
  });
  if (marketRegimeGuard.note) {
    summary.notes.push(marketRegimeGuard.note);
  }

  const remainSlots = buyConstraint.buySlots;

  if (buyConstraint.note) {
    summary.notes.push(buyConstraint.note);
  }

  if (remainSlots <= 0) {
    summary.skipped += 1;
    if (!buyConstraint.note) {
      summary.notes.push("추가 매수 슬롯 없음");
    }
    await writeActionLog({
      supabase: payload.supabase,
      runId: payload.runId,
      chatId,
      actionType: "SKIP",
      reason: buyConstraint.reason === "default"
        ? "no-buy-slots"
        : buyConstraint.reason,
      detail: {
        activeCount,
        maxPositions,
        remainSlots,
        rawRemainSlots,
        selectedStrategy,
      },
    });
    return summary;
  }

  if (availableCash <= 0) {
    summary.skipped += 1;
    summary.notes.push("신규 매수 불가: 투자 가능 현금 0원");
    await writeActionLog({
      supabase: payload.supabase,
      runId: payload.runId,
      chatId,
      actionType: "SKIP",
      reason: "no-available-cash",
      detail: {
        availableCash,
        activeCount,
        maxPositions,
        remainSlots,
      },
    });
    return summary;
  }

  if (deployableCash <= 0) {
    summary.skipped += 1;
    summary.notes.push("신규 매수 보류: 현금 하한 유지 구간");
    await writeActionLog({
      supabase: payload.supabase,
      runId: payload.runId,
      chatId,
      actionType: "SKIP",
      reason: "cash-reserve-floor",
      detail: {
        availableCash,
        deployableCash,
        seedCapital,
        minCashReservePct: marketPolicy.minCashReservePct,
        marketMode: marketPolicy.mode,
        marketReason: marketPolicy.reason,
      },
    });
    return summary;
  }

  const candidateSelectionRaw = await selectMondayCandidates({
    supabase: payload.supabase,
    chatId,
    minBuyScore: marketRegimeGuard.minBuyScore,
    limit: resolveCandidateProbeLimit(remainSlots),
    heldCodes,
    marketPolicy,
    selectedStrategy,
    riskProfile: prefs.risk_profile ?? null,
    discoveryProfile,
  });
  const newsAssistMonday = await applyNewsAssistToSelection(candidateSelectionRaw, "신규매수");
  const candidateSelection = newsAssistMonday.selection;
  summary.notes.push(...newsAssistMonday.notes);
  if (candidateSelection.guardNote) {
    summary.notes.push(candidateSelection.guardNote);
  }
  const candidates = candidateSelection.candidates;
  const buyPriceResolution = await resolveBuyExecutionPrices(candidates, {
    apiBudget: payload.apiBudget,
  });
  const mondayScoreSnapshot = candidates.length
    ? await fetchLatestScoresByCodes(payload.supabase, candidates.map((candidate) => candidate.code)).catch(
        () => null
      )
    : null;
  const mondayFactorsByCode = mondayScoreSnapshot?.byCode ?? new Map();

  if ((mondayScoreSnapshot?.fallbackCodes?.length ?? 0) > 0) {
    summary.notes.push(
      `점수 fallback 반영: ${mondayScoreSnapshot?.fallbackCodes?.length ?? 0}종목`
    );
  }

  if (candidateSelection.latestAsof) {
    summary.notes.push(`점수 기준일: ${candidateSelection.latestAsof}`);
  }

  if (candidateSelection.entryProfile === "pullback-first") {
    summary.notes.push("진입 프로필: 눌림목 + 매집 포착 하이브리드");
    summary.notes.push(
      `하이브리드 반영: 눌림목 ${candidateSelection.pullbackCandidatesUsed ?? 0}건 · 매집 포착 ${candidateSelection.aggressiveCandidatesUsed ?? 0}건 / 총 ${candidateSelection.candidates.length}건`
    );
  }

  const filteringLine = formatFilteringMetricsLine({
    label: "후보 필터링",
    metrics: candidateSelection.filteringMetrics,
  });
  if (filteringLine) {
    summary.notes.push(filteringLine);
  }
  const topRejectReasons = formatTopRejectReasons(candidateSelection.filteringMetrics);
  if (topRejectReasons) {
    summary.notes.push(`후보 탈락 상위: ${topRejectReasons}`);
  }

  if (buyPriceResolution.marketPhase === "intraday") {
    if (buyPriceResolution.realtimeSkippedByBudget) {
      summary.notes.push("매수가 기준: API 예산 보호로 장중 종가 스냅샷 기준 적용");
    } else {
      summary.notes.push(
        buyPriceResolution.realtimeAppliedCount > 0
          ? `매수가 기준: 장중 실시간가 우선 (${buyPriceResolution.realtimeAppliedCount}/${candidates.length}종목 반영)`
          : "매수가 기준: 장중 실시간가 조회 실패로 종가 기준 적용"
      );
    }
  } else {
    summary.notes.push("매수가 기준: 장마감 이후 종가 기준 적용");
  }

  if (candidateSelection.selectionMode === "signal-relaxed") {
    summary.notes.push(
      `후보 기준 완화: 최신 상위점수 ${candidateSelection.latestTopScore}점 기준으로 ${candidateSelection.thresholdUsed}점 이상 BUY 계열 종목 선별`
    );
  }
  if (candidateSelection.selectionMode === "signal-preferred") {
    const actionableTodayCount = candidates.filter((candidate) => {
      const normalized = String(candidate.signal ?? "").trim().toUpperCase();
      return normalized === "BUY" || normalized === "STRONG_BUY";
    }).length;
    if (actionableTodayCount > 0) {
      summary.notes.push(`오늘 적극신호 우선: BUY/STRONG_BUY ${actionableTodayCount}건 중심 선별`);
    }
  }
  if (candidateSelection.selectionMode === "top-score-fallback") {
    summary.notes.push(
      `후보 대체선별: BUY 신호 부족으로 상위 점수대 ${candidateSelection.thresholdUsed}점 이상 종목 선별`
    );
  }

  if (!candidates.length) {
    summary.skipped += 1;
    if (candidateSelection.latestTopScore > 0) {
      summary.notes.push(
        `매수 후보 없음 (최신 상위점수 ${candidateSelection.latestTopScore}점 · 기준 ${candidateSelection.thresholdUsed}점)`
      );
    } else {
      summary.notes.push("매수 후보 없음");
    }
    await writeActionLog({
      supabase: payload.supabase,
      runId: payload.runId,
      chatId,
      actionType: "SKIP",
      reason: "no-candidates",
      detail: {
        remainSlots,
        latestTopScore: candidateSelection.latestTopScore,
        thresholdUsed: candidateSelection.thresholdUsed,
        selectionMode: candidateSelection.selectionMode,
        filteringMetrics: candidateSelection.filteringMetrics ?? null,
        entryProfile: candidateSelection.entryProfile ?? null,
        pullbackCandidatesUsed: candidateSelection.pullbackCandidatesUsed ?? 0,
        aggressiveCandidatesUsed: candidateSelection.aggressiveCandidatesUsed ?? 0,
        target_pacing_state: pacingMetrics.state,
        fallback_relax_level: pacingMetrics.relaxLevel,
      },
    });
    return summary;
  }

  let plannedHoldingCount = activeCount;
  let sizingNoteAdded = false;
  let trustGateNoteAdded = false;
  let slotsLeft = remainSlots;
  let insufficientCashCount = 0;

  for (const candidate of candidates) {
    if (slotsLeft <= 0) break;

    try {
      const executionEntry = buyPriceResolution.priceByCode.get(candidate.code);
      const executionPrice = executionEntry?.price ?? candidate.close;
      const executionSource = executionEntry?.source ?? "close";
      const scoreRow = mondayFactorsByCode.get(candidate.code);
      const stableTurn = scoreRow?.factors
        ? String(((scoreRow.factors as Record<string, unknown>).stable_turn ?? "")).trim()
        : null;
      const signalGate = evaluateAutoTradeSignalGate({
        currentPrice: executionPrice,
        score: candidate.score,
        factors: extractScoreFactors(scoreRow?.factors),
        minTrustScore: signalTrustThresholds.newBuy,
        requireAboveSma200: true,
      });
      const todaySignalReason = buildTodaySignalReasonNote({
        signal: candidate.signal,
        stableTurn,
        signalGate: { trustScore: signalGate.trustScore, grade: signalGate.grade },
      });
      const filterReason = buildAutoTradeFilterReason(candidate);

      if (!trustGateNoteAdded) {
        summary.notes.push("진입게이트: 세력선(sma200) 상단 + 턴 신뢰도(거래량/RSI/MACD/AVWAP) 적용");
        trustGateNoteAdded = true;
      }

      if (!signalGate.passed) {
        summary.skipped += 1;
        await writeActionLog({
          supabase: payload.supabase,
          runId: payload.runId,
          chatId,
          code: candidate.code,
          actionType: "SKIP",
          reason: "signal-gate-reject",
          detail: {
            score: candidate.score,
            trustScore: signalGate.trustScore,
            trustGrade: signalGate.grade,
            reasons: signalGate.reasons,
            metrics: signalGate.metrics,
            price: executionPrice,
            priceSource: executionSource,
          },
        });
        continue;
      }

      const sizing = calculateAutoTradeBuySizing({
        availableCash: deployableCash,
        price: executionPrice,
        slotsLeft,
        currentHoldingCount: plannedHoldingCount,
        maxPositions,
        stopLossPct: Math.abs(toNumber(payload.setting.stop_loss_pct, 4)),
        riskBudgetScale: dailyRiskBudget.scale,
        prefs,
      });

      if (!sizingNoteAdded) {
        const riskCapText = sizing.maxBudgetByRisk
          ? ` · 손절기준 상한 ${fmtKrw(sizing.maxBudgetByRisk)}`
          : "";
        const splitModeText =
          sizing.splitCount !== sizing.configuredSplitCount
            ? ` · 분할 자동조정 ${sizing.configuredSplitCount}->${sizing.splitCount}`
            : "";
        summary.notes.push(
          `사이징 기준: 목표보유 ${sizing.targetPositions}종목 · 분할 1/${sizing.splitCount}${splitModeText} · 회당 ${fmtKrw(sizing.budget)} (총 목표 ${fmtKrw(sizing.totalBudget)}) · 최소주문 ${fmtKrw(sizing.minOrderAmount)}${riskCapText}`
        );
        sizingNoteAdded = true;
      }

      const qty = sizing.quantity;
      const investedAmount = sizing.investedAmount;
      const factors = extractScoreFactors((scoreRow as Record<string, unknown> | undefined)?.factors);
      const newsBias = resolveNewsBiasFromFactors(factors);
      const candidateProfile = classifyAutoTradeEntryProfile({
        accountStrategy: selectedStrategy,
        riskProfile: prefs.risk_profile,
        marketMode: marketPolicy.mode,
        newsBias,
        candidate: {
          ...candidate,
          stableTurn: candidate.stableTurn ?? null,
          stableTrust: candidate.stableTrust ?? null,
        },
      });
      let tradeProfile = resolvePositionTradeProfile({
        accountStrategy: candidateProfile,
        baseTakeProfitPct: Math.abs(toNumber(payload.setting.take_profit_pct, 8)),
        baseStopLossPct: Math.abs(toNumber(payload.setting.stop_loss_pct, 4)),
        sellSplitCount: Math.max(1, Math.min(4, toPositiveInt(prefs.virtual_sell_split_count, 2))),
      });
      tradeProfile = applyDynamicTradeProfileAdjustments({
        tradeProfile,
        context: {
          score: candidate.score,
          signal: candidate.signal,
          rsi14: candidate.rsi14,
          liquidity: candidate.liquidity,
          stableTurn: candidate.stableTurn,
          stableTrust: candidate.stableTrust,
          marketMode: marketPolicy.mode,
          isSectorLeader: candidate.isSectorLeader,
        },
      });
      // Adjust tradeProfile using ATR if available in score factors
      try {
        const atrPct = factors && Number.isFinite(Number(factors.atrPct)) ? Number(factors.atrPct) : null;
        if (atrPct != null) {
          // stopLossPct: at least base, or atrPct * 2; cap to 15%
          const stopFromAtr = Math.min(15, Math.max(tradeProfile.stopLossPct, atrPct * 2));
          // takeProfitPct: at least base, or atrPct * 4; cap to 50%
          const takeFromAtr = Math.min(50, Math.max(tradeProfile.takeProfitPct, atrPct * 4));
          tradeProfile = {
            ...tradeProfile,
            stopLossPct: Number(stopFromAtr.toFixed(2)),
            takeProfitPct: Number(takeFromAtr.toFixed(2)),
          };
          summary.notes.push(`ATR 보정: ${candidate.code} ATR% ${atrPct.toFixed(2)} -> 손절 ${tradeProfile.stopLossPct}% / 익절 ${tradeProfile.takeProfitPct}%`);
        }
      } catch (e) {
        // ignore and continue with default tradeProfile
      }
      const profileLabel = getStrategyLabel(tradeProfile.profile) || tradeProfile.profile;
      if (qty <= 0 || investedAmount <= 0) {
        summary.skipped += 1;
        insufficientCashCount += 1;
        // 슬롯을 소모하여 다음 후보가 더 큰 예산을 배정받도록 함
        slotsLeft -= 1;
        await writeActionLog({
          supabase: payload.supabase,
          runId: payload.runId,
          chatId,
          code: candidate.code,
          actionType: "SKIP",
          reason: "insufficient-cash",
          detail: {
            availableCash,
            budget: sizing.budget,
            totalBudget: sizing.totalBudget,
            budgetPerSlot: sizing.budgetPerSlot,
            budgetPerTargetPosition: sizing.budgetPerTargetPosition,
            maxBudgetByRisk: sizing.maxBudgetByRisk,
            splitCount: sizing.splitCount,
            configuredSplitCount: sizing.configuredSplitCount,
            minOrderAmount: sizing.minOrderAmount,
            price: executionPrice,
          },
        });
        continue;
      }

      if (payload.dryRun) {
        const targetPct = Math.abs(toNumber(tradeProfile.takeProfitPct, 8));
        const targetPrice = Math.round(executionPrice * (1 + targetPct / 100));
        const expectedPnl = Math.max(0, Math.round((targetPrice - executionPrice) * qty));
        summary.buys += 1;
        summary.notes.push(
          `[테스트 매수안] ${candidate.name}(${candidate.code}) ${qty}주 · 전략 ${profileLabel} · 매수가 ${fmtKrw(executionPrice)} · 투입 ${fmtKrw(investedAmount)} · 목표가 ${fmtKrw(targetPrice)} · 기대수익 ${fmtKrw(expectedPnl)} (${targetPct.toFixed(1)}%) · ${formatPriceSourceLabel(executionSource)}${todaySignalReason ? ` · ${todaySignalReason}` : ""}${filterReason ? ` · 필터근거 ${filterReason}` : ""}`
        );
        summary.notes.push(
          buildResponseGuideNote({
            actionType: "new-buy",
            code: candidate.code,
            basePrice: executionPrice,
            quantity: qty,
            investedAmount,
            takeProfitPct: tradeProfile.takeProfitPct,
            stopLossPct: tradeProfile.stopLossPct,
          })
        );
        await writeActionLog({
          supabase: payload.supabase,
          runId: payload.runId,
          chatId,
          code: candidate.code,
          actionType: "BUY",
          reason: "dry-run-monday-buy",
          detail: {
            price: executionPrice,
            priceSource: executionSource,
            score: candidate.score,
            quantity: qty,
            investedAmount,
            totalBudget: sizing.totalBudget,
            splitCount: sizing.splitCount,
            strategyProfile: tradeProfile.profile,
            targetPrice,
            expectedPnl,
            signalTrust: {
              score: signalGate.trustScore,
              grade: signalGate.grade,
              metrics: signalGate.metrics,
            },
          },
        });
        plannedHoldingCount += 1;
        availableCash = Math.max(0, availableCash - investedAmount);
        deployableCash = Math.max(0, deployableCash - investedAmount);
        slotsLeft -= 1;
        continue;
      }

      const opKey = `${chatId}:BUY:${candidate.code}:${Math.round(executionPrice)}:${qty}:${new Date().toISOString().slice(0,16)}`;
      const registered = await tryRegisterOperation({
        supabase: payload.supabase,
        opKey,
        chatId,
        strategy: AUTO_TRADE_STRATEGY_ID,
        meta: { event: "monday-buy", profile: tradeProfile.profile, runId: payload.runId },
      }).catch((err) => {
        throw err;
      });

      if (!registered) {
        summary.skipped += 1;
        await writeActionLog({
          supabase: payload.supabase,
          runId: payload.runId,
          chatId,
          code: candidate.code,
          actionType: "SKIP",
          reason: "duplicate-execution",
          detail: { opKey },
        });
        continue;
      }

      const { data: existingPositionForCode, error: existingPositionForCodeError } = await fetchLegacyPositionByCode({
        supabase: payload.supabase,
        chatId,
        code: candidate.code,
      });

      if (existingPositionForCodeError) {
        throw existingPositionForCodeError;
      }

      const hasNonVirtualPositionForCode =
        !!existingPositionForCode &&
        (existingPositionForCode.broker_name != null || existingPositionForCode.account_name != null);

      if (hasNonVirtualPositionForCode) {
        summary.skipped += 1;
        summary.notes.push(
          `${candidate.code} 신규 매수 스킵: 실계좌 보유 종목과 코드 충돌(가상 전용 보호)`
        );
        await writeActionLog({
          supabase: payload.supabase,
          runId: payload.runId,
          chatId,
          code: candidate.code,
          actionType: "SKIP",
          reason: "non-virtual-position-exists",
          detail: {
            opKey,
            existingPositionId: Number(existingPositionForCode.id ?? 0) || null,
          },
        });
        continue;
      }

      const targetHorizon = resolveTargetHorizon({
        profile: tradeProfile.profile,
        expectedHorizonDays: tradeProfile.expectedHorizonDays,
      });
      const horizonReason = `profile=${tradeProfile.profile};market=${marketPolicy.mode};news=${newsBias};signal=${String(candidate.signal ?? "").trim() || "NA"}`;
      const positionUpsertPayload: Record<string, unknown> = {
        chat_id: chatId,
        code: candidate.code,
        buy_price: executionPrice,
        buy_date: new Date().toISOString().slice(0, 10),
        quantity: qty,
        invested_amount: investedAmount,
        bucket: resolvePositionBucketFromProfile(tradeProfile.profile),
        status: "holding",
        broker_name: null,
        account_name: null,
        memo: buildPositionStrategyMemo({
          event: "monday-buy",
          note: "autotrade-monday-buy",
          profile: tradeProfile.profile,
          takeProfitTranchesDone: 0,
        }),
        target_horizon: targetHorizon,
        horizon_reason: horizonReason,
        macro_context_at_entry: {
          mode: marketPolicy.mode,
          label: marketPolicy.label,
          reason: marketPolicy.reason,
          minCashReservePct: marketPolicy.minCashReservePct,
        },
        news_context_at_entry: {
          bias: newsBias,
          signal: candidate.signal ?? null,
          stableTurn: candidate.stableTurn ?? null,
          stableTrust: candidate.stableTrust ?? null,
        },
        planned_review_at: resolvePlannedReviewAt(tradeProfile.expectedHorizonDays),
      };

      let upserted: Record<string, unknown> | null = null;
      const upsertTry = await payload.supabase
        .from(PORTFOLIO_TABLES.positions)
        .upsert(positionUpsertPayload, { onConflict: "chat_id,code", ignoreDuplicates: true })
        .select("id, created_at, buy_date")
        .maybeSingle();

      if (upsertTry.error && isMissingVirtualPositionHorizonColumns(upsertTry.error)) {
        const fallbackPayload = { ...positionUpsertPayload };
        delete fallbackPayload.target_horizon;
        delete fallbackPayload.horizon_reason;
        delete fallbackPayload.macro_context_at_entry;
        delete fallbackPayload.news_context_at_entry;
        delete fallbackPayload.planned_review_at;

        const fallbackTry = await payload.supabase
          .from(PORTFOLIO_TABLES.positions)
          .upsert(fallbackPayload, { onConflict: "chat_id,code", ignoreDuplicates: true })
          .select("id, created_at, buy_date")
          .maybeSingle();
        if (fallbackTry.error) {
          throw fallbackTry.error;
        }
        upserted = (fallbackTry.data as Record<string, unknown> | null) ?? null;
      } else {
        if (upsertTry.error) {
          throw upsertTry.error;
        }
        upserted = (upsertTry.data as Record<string, unknown> | null) ?? null;
      }

      const tradeId = await appendTradeLog({
        supabase: payload.supabase,
        chatId,
        code: candidate.code,
        side: "BUY",
        price: executionPrice,
        quantity: qty,
        grossAmount: investedAmount,
        netAmount: investedAmount,
        memo: buildStrategyMemo({
          strategyId: AUTO_TRADE_STRATEGY_ID,
          event: "monday-buy",
          note: "autotrade-monday-buy",
        }),
        source: "AUTO",
        brokerName: null,
        accountName: null,
      });

      // 즉시 가상현금 업데이트 (원자 트랜잭션은 향후 DB 함수로 개선 가능)
      try {
        await setUserInvestmentPrefs(chatId, {
          virtual_cash: Math.max(0, Math.round(availableCash)),
        });
      } catch (e) {
        console.error("[autoTrade] update virtual_cash after buy failed", e);
      }

      const positionId = Number((upserted as Record<string, unknown> | null)?.id ?? 0) || null;
      if (positionId) {
        await ensureTradeLotsForHolding({
          chatId,
          watchlistId: positionId,
          code: candidate.code,
          quantity: qty,
          investedAmount,
          buyPrice: executionPrice,
          acquiredAt: String((upserted as Record<string, unknown> | null)?.created_at ?? "") || null,
          buyDate: String((upserted as Record<string, unknown> | null)?.buy_date ?? "") || null,
        });
      }

      summary.buys += 1;
      plannedHoldingCount += 1;
      availableCash = Math.max(0, availableCash - investedAmount);
      deployableCash = Math.max(0, deployableCash - investedAmount);
      summary.notes.push(
        `[실행 매수] ${candidate.name}(${candidate.code}) ${qty}주 · 전략 ${profileLabel} · 매수가 ${fmtKrw(executionPrice)} · 투입 ${fmtKrw(investedAmount)} · 점수 ${candidate.score.toFixed(1)} · ${formatPriceSourceLabel(executionSource)}${todaySignalReason ? ` · ${todaySignalReason}` : ""}${filterReason ? ` · 필터근거 ${filterReason}` : ""}`
      );
      summary.notes.push(
        buildResponseGuideNote({
          actionType: "new-buy",
          code: candidate.code,
          basePrice: executionPrice,
          quantity: qty,
          investedAmount,
          takeProfitPct: tradeProfile.takeProfitPct,
          stopLossPct: tradeProfile.stopLossPct,
        })
      );
      await writeActionLog({
        supabase: payload.supabase,
        runId: payload.runId,
        chatId,
        code: candidate.code,
        actionType: "BUY",
        reason: "monday-score-candidate",
        detail: {
          score: candidate.score,
          price: executionPrice,
          priceSource: executionSource,
          qty,
          investedAmount,
          totalBudget: sizing.totalBudget,
          splitCount: sizing.splitCount,
          strategyProfile: tradeProfile.profile,
          tradeId,
          cashAfter: availableCash,
          deployableCashAfter: deployableCash,
          marketMode: marketPolicy.mode,
          marketReason: marketPolicy.reason,
          targetHorizon,
          horizonReason,
          signalTrust: {
            score: signalGate.trustScore,
            grade: signalGate.grade,
            metrics: signalGate.metrics,
          },
        },
      });
      // 결정로그: 월요일 자동 매수
      appendVirtualDecisionLog({
        chatId,
        code: candidate.code,
        action: "BUY",
        strategyId: AUTO_TRADE_STRATEGY_ID,
        strategyVersion: "v1",
        confidence: Math.min(100, Math.max(0, candidate.score)),
        expectedHorizonDays: tradeProfile.expectedHorizonDays,
        reasonSummary: `자동 월요일 매수 (${profileLabel}, 점수 ${candidate.score.toFixed(1)})`,
        reasonDetails: { score: candidate.score, price: executionPrice, priceSource: executionSource, qty, investedAmount, totalBudget: sizing.totalBudget, splitCount: sizing.splitCount, strategyProfile: tradeProfile.profile, trigger: "monday-score-candidate", signalTrust: { score: signalGate.trustScore, grade: signalGate.grade, metrics: signalGate.metrics } },
        linkedTradeId: tradeId ?? undefined,
      }).catch((err: unknown) => console.error("[autoTrade] decision log BUY failed", err));
      slotsLeft -= 1;
    } catch (error: unknown) {
      const message = extractErrorMessage(error);
      summary.errors += 1;
      summary.notes.push(`${candidate.code} 매수 실패: ${message}`);
      await writeActionLog({
        supabase: payload.supabase,
        runId: payload.runId,
        chatId,
        code: candidate.code,
        actionType: "ERROR",
        reason: "monday-buy-failed",
        detail: { error: message },
      });
      slotsLeft -= 1;
    }
  }

  if (insufficientCashCount > 0) {
    summary.notes.push(
      `현금 부족으로 매수 스킵 ${insufficientCashCount}건 (회당 예산/종목가격 조합으로 최소주문 500,000원 미달 포함)`
    );
  }

  if (!payload.dryRun) {
    await setUserInvestmentPrefs(chatId, {
      virtual_seed_capital: seedCapital,
      virtual_cash: Math.max(0, Math.round(availableCash)),
    });
    await syncVirtualPortfolio(chatId, chatId);
  }

  return summary;
}

function getStrategyLabel(strategy?: string | null): string | null {
  if (!strategy) return null;
  const strategyLabels: Record<string, string> = {
    HOLD_SAFE: "안전 포지션",
    REDUCE_TIGHT: "타이트 손절",
    WAIT_AND_DIP_BUY: "매수 기회 대기",
    SHORT_SWING: "단기 스윙",
    SWING: "스윙",
    POSITION_CORE: "중장기 코어",
  };
  return strategyLabels[strategy] || strategy;
}

async function executeAutoTradeSell(payload: {
  supabase: SupabaseClientAny;
  runId: number | null;
  chatId: number;
  holding: HoldingRow;
  close: number;
  buyPrice: number;
  feeRate: number;
  taxRate: number;
  sellQty: number;
  reason: "take-profit-partial" | "take-profit-final" | "stop-loss";
  stopLossContext?: string | null;
  profileLabel: string;
  strategyProfile: string;
  takeProfitTranchesDone: number;
  nextTakeProfitTranchesDone: number;
  dryRun: boolean;
}): Promise<{
  sold: boolean;
  partial: boolean;
  proceeds: number;
  realizedPnlDelta: number;
  note: string;
}> {
  const qty = Math.max(0, Math.floor(toNumber(payload.holding.quantity, 0)));
  const invested = Math.max(
    0,
    toNumber(payload.holding.invested_amount, qty * payload.buyPrice)
  );
  const sellQty = Math.max(0, Math.min(qty, Math.floor(payload.sellQty)));
  const isFullExit = sellQty >= qty;
  const remainQty = Math.max(0, qty - sellQty);

  if (qty <= 0 || sellQty <= 0) {
    return {
      sold: false,
      partial: false,
      proceeds: 0,
      realizedPnlDelta: 0,
      note: `${payload.holding.code} 매도 스킵: 수량 계산 오류`,
    };
  }

  await ensureTradeLotsForHolding({
    chatId: payload.chatId,
    watchlistId: payload.holding.id,
    code: payload.holding.code,
    quantity: qty,
    investedAmount: invested,
    buyPrice: payload.buyPrice,
    acquiredAt: payload.holding.created_at,
    buyDate: payload.holding.buy_date,
  });

  let fifo;
  try {
    fifo = await previewFifoSale({
      chatId: payload.chatId,
      code: payload.holding.code,
      quantity: sellQty,
    });
  } catch (fifoError) {
    try {
      await replaceTradeLotsForHolding({
        chatId: payload.chatId,
        watchlistId: payload.holding.id,
        code: payload.holding.code,
        quantity: qty,
        investedAmount: invested,
        buyPrice: payload.buyPrice,
        acquiredAt: payload.holding.created_at,
        buyDate: payload.holding.buy_date,
        note: "autotrade-fifo-rebuild-before-sell",
      });

      fifo = await previewFifoSale({
        chatId: payload.chatId,
        code: payload.holding.code,
        quantity: sellQty,
      });
    } catch (repairError) {
      const message = repairError instanceof Error ? repairError.message : String(repairError)
      return {
        sold: false,
        partial: false,
        proceeds: 0,
        realizedPnlDelta: 0,
        note: `${payload.holding.code} 매도 중단: FIFO 정합성 자동 복구 실패 (${message})`,
      }
    }
  }
  const soldCost = fifo.totalCost;
  const remainInvested = Math.max(0, invested - soldCost);
  const nextBuyPrice =
    remainQty > 0 && remainInvested > 0
      ? Number((remainInvested / remainQty).toFixed(4))
      : null;
  const gross = Math.round(payload.close * sellQty);
  const feeAmount = Math.round(gross * payload.feeRate);
  const taxAmount = Math.round(gross * payload.taxRate);
  const net = Math.max(0, gross - feeAmount - taxAmount);
  const pnl = net - soldCost;
  const isTakeProfit = payload.reason !== "stop-loss";

  const sellOpKey = `${payload.chatId}:SELL:${payload.holding.code}:${Math.round(payload.close)}:${sellQty}:${new Date().toISOString().slice(0,16)}`;
  const sellRegistered = await tryRegisterOperation({
    supabase: payload.supabase,
    opKey: sellOpKey,
    chatId: payload.chatId,
    strategy: AUTO_TRADE_STRATEGY_ID,
    meta: { event: payload.reason, holdingId: payload.holding.id, runId: payload.runId },
  }).catch((err) => { throw err; });

  if (!sellRegistered) {
    await writeActionLog({
      supabase: payload.supabase,
      runId: payload.runId,
      chatId: payload.chatId,
      code: payload.holding.code,
      actionType: "SKIP",
      reason: "duplicate-execution",
      detail: { opKey: sellOpKey },
    });
    return {
      sold: false,
      partial: false,
      proceeds: 0,
      realizedPnlDelta: 0,
      note: `${payload.holding.code} 매도 스킵: 중복 실행`,
    };
  }

  if (payload.dryRun) {
    await writeActionLog({
      supabase: payload.supabase,
      runId: payload.runId,
      chatId: payload.chatId,
      code: payload.holding.code,
      actionType: "SELL",
      reason: `dry-run-${payload.reason}`,
      detail: {
        qty: sellQty,
        remainQty,
        buyPrice: payload.buyPrice,
        close: payload.close,
        pnl,
        isFullExit,
        stopLossContext: payload.reason === "stop-loss" ? payload.stopLossContext ?? null : null,
        takeProfitTranchesDone: payload.takeProfitTranchesDone,
        nextTakeProfitTranchesDone: payload.nextTakeProfitTranchesDone,
      },
    });
    return {
      sold: true,
      partial: !isFullExit,
      proceeds: net,
      realizedPnlDelta: pnl,
      note: isFullExit
        ? `[테스트 매도안] ${payload.holding.code} ${sellQty}주 전량매도 · 전략 ${payload.profileLabel} · 손익률 ${(((payload.close - payload.buyPrice) / payload.buyPrice) * 100).toFixed(2)}%`
        : `[테스트 부분익절안] ${payload.holding.code} ${sellQty}주 매도 · 잔여 ${remainQty}주 · 전략 ${payload.profileLabel}`,
    };
  }

  if (isFullExit) {
    const { error: deleteError } = await payload.supabase
      .from(PORTFOLIO_TABLES.positions)
      .delete()
      .eq("chat_id", payload.chatId)
      .eq("id", payload.holding.id);

    if (deleteError) throw deleteError;
  } else {
    const nextMemo = buildPositionStrategyMemo({
      event: "partial-take-profit",
      note: "autotrade-partial-take-profit",
      profile: payload.strategyProfile,
      takeProfitTranchesDone: payload.nextTakeProfitTranchesDone,
    });
    const { error: updateError } = await payload.supabase
      .from(PORTFOLIO_TABLES.positions)
      .update({
        quantity: remainQty,
        invested_amount: remainInvested,
        buy_price: nextBuyPrice,
        memo: nextMemo,
        status: "holding",
      })
      .eq("chat_id", payload.chatId)
      .eq("id", payload.holding.id);

    if (updateError) throw updateError;
  }

  const tradeId = await appendTradeLog({
    supabase: payload.supabase,
    chatId: payload.chatId,
    code: payload.holding.code,
    side: "SELL",
    price: payload.close,
    quantity: sellQty,
    grossAmount: gross,
    netAmount: net,
    feeAmount,
    taxAmount,
    pnlAmount: pnl,
    memo: buildStrategyMemo({
      strategyId: AUTO_TRADE_STRATEGY_ID,
      event: payload.reason,
      note: payload.reason,
    }),
    source: "AUTO",
    brokerName: null,
    accountName: null,
  });

  try {
    await applyFifoSale({
      chatId: payload.chatId,
      code: payload.holding.code,
      exitPrice: payload.close,
      tradeId,
      allocations: fifo.allocations,
    });
  } catch (lotError) {
    await replaceTradeLotsForHolding({
      chatId: payload.chatId,
      watchlistId: isFullExit ? null : payload.holding.id,
      code: payload.holding.code,
      quantity: remainQty,
      investedAmount: isFullExit ? 0 : remainInvested,
      buyPrice: isFullExit ? null : nextBuyPrice,
      acquiredAt: payload.holding.created_at,
      buyDate: payload.holding.buy_date,
      note: "autotrade-fifo-rebuilt-after-sell",
    }).catch(() => undefined)
    throw lotError
  }

  await writeActionLog({
    supabase: payload.supabase,
    runId: payload.runId,
    chatId: payload.chatId,
    code: payload.holding.code,
    actionType: "SELL",
    reason: payload.reason,
    detail: {
      qty: sellQty,
      remainQty,
      buyPrice: payload.buyPrice,
      close: payload.close,
      gross,
      net,
      pnl,
      isFullExit,
      stopLossContext: payload.reason === "stop-loss" ? payload.stopLossContext ?? null : null,
      takeProfitTranchesDone: payload.takeProfitTranchesDone,
      nextTakeProfitTranchesDone: payload.nextTakeProfitTranchesDone,
      tradeId,
    },
  });

  appendVirtualDecisionLog({
    chatId: payload.chatId,
    code: payload.holding.code,
    action: "SELL",
    strategyId: AUTO_TRADE_STRATEGY_ID,
    strategyVersion: "v1",
    confidence: isTakeProfit ? 80 : 70,
    expectedHorizonDays: isTakeProfit ? 3 : 1,
    reasonSummary: isTakeProfit
      ? !isFullExit
        ? `자동 부분익절 (${payload.profileLabel})`
        : `자동 익절 완료 (${payload.profileLabel})`
      : `자동 손절 (${payload.profileLabel})`,
    reasonDetails: {
      trigger: payload.reason,
      stopLossContext: payload.reason === "stop-loss" ? payload.stopLossContext ?? null : null,
      sellQty,
      remainQty,
      buyPrice: payload.buyPrice,
      sellPrice: payload.close,
      pnl,
    },
    linkedTradeId: tradeId ?? undefined,
  }).catch((err: unknown) => console.error("[autoTrade] decision log SELL failed", err));

  return {
    sold: true,
    partial: !isFullExit,
    proceeds: net,
    realizedPnlDelta: pnl,
    note: isFullExit
      ? `[실행 매도] ${payload.holding.code} ${sellQty}주 · 전략 ${payload.profileLabel} · 매도가 ${fmtKrw(payload.close)}`
      : `[실행 부분익절] ${payload.holding.code} ${sellQty}주 · 잔여 ${remainQty}주 · 전략 ${payload.profileLabel} · 매도가 ${fmtKrw(payload.close)}`,
  };
}

async function runDailyReviewForUser(payload: {
  supabase: SupabaseClientAny;
  setting: AutoTradeSettingRow;
  runId: number | null;
  dryRun: boolean;
  apiBudget?: ApiBudget;
}): Promise<AutoTradeActionSummary> {
  const chatId = payload.setting.chat_id;
  const prefs = await getUserInvestmentPrefs(chatId);
  const signalTrustThresholds = resolveSignalTrustThresholdsFromPrefs(prefs);
  const discoveryProfile = normalizeDiscoveryProfile(prefs.discovery_profile);
  const summary: AutoTradeActionSummary = {
    chatId,
    buys: 0,
    sells: 0,
    skipped: 0,
    errors: 0,
    notes: [],
  };

  // 크론 공백 감사 (Re-entry Audit): 마지막 daily review 이후 N일 이상 공백이면 경고
  const lastReviewAt = payload.setting.last_daily_review_at;
  if (lastReviewAt) {
    const lastTs = Date.parse(String(lastReviewAt));
    if (Number.isFinite(lastTs)) {
      const gapDays = Math.floor((Date.now() - lastTs) / (24 * 60 * 60 * 1000));
      if (gapDays >= 3) {
        summary.notes.push(
          `[재시작 감사] 마지막 일일점검 ${gapDays}일 경과 · 시간손절/비중조정 우선 적용`
        );
      }
    }
  }

  // 적용된 전략 기록
  const selectedStrategy = payload.setting.selected_strategy;
  const dailySellPerf = await getRecentAutoTradeSellPerformance({
    supabase: payload.supabase,
    chatId,
    windowDays: 45,
  });
  const persistedGateState = await fetchStrategyGateState({
    supabase: payload.supabase,
    chatId,
    strategyId: AUTO_TRADE_STRATEGY_ID,
  }).catch(() => null);

  const perfGuard = applyPerformanceBuyGuard({
    requestedSlots: toPositiveInt(payload.setting.monday_buy_slots, 2),
    baseMinBuyScore: toPositiveInt(payload.setting.min_buy_score, 72),
    perf: dailySellPerf,
  });
  const persistedGuard = applyPersistedGateGuard({
    requestedSlots: perfGuard.requestedSlots,
    baseMinBuyScore: perfGuard.baseMinBuyScore,
    gateStatus: persistedGateState?.status,
  });
  if (perfGuard.note) {
    summary.notes.push(perfGuard.note);
  }
  if (persistedGuard.note) {
    summary.notes.push(persistedGuard.note);
  }

  if (selectedStrategy) {
    summary.notes.push(`기본 전략: ${getStrategyLabel(selectedStrategy) || selectedStrategy}`);
  }
  summary.notes.push(`발굴 소스: ${discoveryProfileLabel(discoveryProfile)}`);
  summary.notes.push(
    `신뢰도 임계값(${signalTrustThresholds.variant}): 신규 ${signalTrustThresholds.newBuy} · 추가 ${signalTrustThresholds.addOn} · 리밸런싱 ${signalTrustThresholds.rebalance}`
  );

  const { data: holdingsData, error: holdingsError } = await fetchLegacyVirtualPositionsForChat({
    supabase: payload.supabase,
    chatId,
    select: "id, code, buy_price, buy_date, created_at, quantity, invested_amount, status, memo",
    status: "holding",
  });

  if (holdingsError) {
    const holdingsErrorMessage = queryErrorMessage(holdingsError);
    summary.errors += 1;
    summary.notes.push(`보유 조회 실패: ${holdingsErrorMessage}`);
    await writeActionLog({
      supabase: payload.supabase,
      runId: payload.runId,
      chatId,
      actionType: "ERROR",
      reason: "daily-holdings-fetch-failed",
      detail: { error: holdingsErrorMessage },
    });
    return summary;
  }

  const holdings = (holdingsData ?? []) as HoldingRow[];
  if (!holdings.length) {
    summary.notes.push("보유 종목 없음");
  }

  const codeList = holdings.map((row) => row.code);
  const holdingScoreSnapshot = codeList.length
    ? await fetchLatestScoresByCodes(payload.supabase, codeList).catch(() => null)
    : null;
  const holdingFactorsByCode = holdingScoreSnapshot?.byCode ?? new Map();

  if ((holdingScoreSnapshot?.fallbackCodes?.length ?? 0) > 0) {
    summary.notes.push(
      `보유 점수 fallback 반영: ${holdingScoreSnapshot?.fallbackCodes?.length ?? 0}종목`
    );
  }

  const { data: stockRows, error: stockError } = await payload.supabase
    .from("stocks")
    .select("code, close, market")
    .in("code", codeList);

  if (stockError) {
    summary.errors += 1;
    summary.notes.push(`시세 조회 실패: ${stockError.message}`);
    return summary;
  }

  const closeByCode = new Map<string, number>();
  const marketByCode = new Map<string, string>();
  for (const row of stockRows ?? []) {
    const code = String((row as Record<string, unknown>).code ?? "");
    const close = toNumber((row as Record<string, unknown>).close, 0);
    const market = String((row as Record<string, unknown>).market ?? "");
    if (code && close > 0) closeByCode.set(code, close);
    if (code && market) marketByCode.set(code, market);
  }

  const feeRate = toNumber(prefs.virtual_fee_rate, 0.00015);
  const taxRate = toNumber(prefs.virtual_tax_rate, 0.0018);
  const rawBaseStopLossPct = Math.abs(toNumber(payload.setting.stop_loss_pct, 4));
  const rawBaseTakeProfitPct = Math.abs(toNumber(payload.setting.take_profit_pct, 8));
  const sellSplitCount = Math.max(1, Math.min(4, toPositiveInt(prefs.virtual_sell_split_count, 2)));

  // 적응형 출구 전략 조정: 최근 성과 기반 손절/익절 기준 자동 조정
  const adaptiveExitGuard = applyAdaptiveExitGuard({
    baseStopLossPct: rawBaseStopLossPct,
    baseTakeProfitPct: rawBaseTakeProfitPct,
    perf: dailySellPerf,
  });
  const baseStopLossPct = adaptiveExitGuard.stopLossPct;
  const baseTakeProfitPct = adaptiveExitGuard.takeProfitPct;
  if (adaptiveExitGuard.note) {
    summary.notes.push(`[출구조정] ${adaptiveExitGuard.note}`);
  }

  let realizedDelta = 0;
  const storedCashRaw = Number(prefs.virtual_cash);
  const storedCash = Number.isFinite(storedCashRaw) ? Math.max(0, storedCashRaw) : null;
  const seedCapital = Math.max(
    0,
    toNumber(prefs.virtual_seed_capital, toNumber(prefs.capital_krw, 0))
  );
  const realizedPnl = toNumber(prefs.virtual_realized_pnl, 0);
  const investedFromHoldings = holdings.reduce((sum, row) => {
    const qty = Math.max(0, Math.floor(toNumber(row.quantity, 0)));
    const buyPrice = Math.max(0, toNumber(row.buy_price, 0));
    const investedAmount = Math.max(0, toNumber(row.invested_amount, 0));
    const fallbackInvested = qty > 0 && buyPrice > 0 ? Math.round(qty * buyPrice) : 0;
    return sum + Math.max(investedAmount, fallbackInvested);
  }, 0);
  const derivedCash = Math.max(0, Math.round(seedCapital + realizedPnl - investedFromHoldings));
  let availableCash = storedCash ?? derivedCash;
  if ((storedCash ?? 0) <= 0 && derivedCash > 0) {
    availableCash = derivedCash;
    summary.notes.push(`가상현금 보정 적용: ${Math.round(availableCash).toLocaleString("ko-KR")}원`);
  }
  const marketOverviewResult = await fetchMarketOverviewWithBudget({
    apiBudget: payload.apiBudget,
  });
  const marketOverview = marketOverviewResult.overview;
  const marketPolicy = detectAutoTradeMarketPolicy({ overview: marketOverview });
  let deployableCash = resolveDeployableCash({
    availableCash,
    seedCapital,
    minCashReservePct: marketPolicy.minCashReservePct,
  });
  summary.notes.push(
    `시장모드: ${marketPolicy.label} · ${marketPolicy.reason} · 최소현금 ${marketPolicy.minCashReservePct}% 유지`
  );
  if (marketOverviewResult.skippedByBudget) {
    summary.notes.push("API 예산 보호: 시장 개요 조회 생략(기본 방어모드 규칙 사용)");
  }
  const dailyLossLimitPct = Math.max(0.5, toNumber(prefs.daily_loss_limit_pct, 5));
  const dailyRealizedPnl = await getDailyRealizedPnl({
    supabase: payload.supabase,
    chatId,
  });
  const dailyRiskBudget = resolveDailyRiskBudget({
    seedCapital,
    dailyLossLimitPct,
    dailyRealizedPnl,
  });
  const dailyBuyBlocked = dailyRiskBudget.blocked;
  if (dailyBuyBlocked) {
    summary.notes.push(
      `신규/추가 매수 차단: 일손실 한도 도달 (${fmtKrw(dailyRealizedPnl)} / 기준 ${fmtKrw(-dailyRiskBudget.lossCapAmount)})`
    );
  } else if (dailyRiskBudget.scale < 1) {
    summary.notes.push(
      `위험예산 축소: 일손실 사용 ${fmtKrw(-dailyRiskBudget.lossUsedAmount)} / 한도 ${fmtKrw(-dailyRiskBudget.lossCapAmount)} -> 매수예산 ${(dailyRiskBudget.scale * 100).toFixed(0)}% 적용`
    );
  }
  let holdCount = 0;
  let takeProfitCount = 0;
  let stopLossCount = 0;
  let addOnBuyCount = 0;
  let rebalanceBuyCount = 0;
  let insufficientCashCount = 0;
  const overweightReducedCodes: string[] = [];
  let holdTakeProfitMin = Number.POSITIVE_INFINITY;
  let holdTakeProfitMax = 0;
  let holdStopLossMin = Number.POSITIVE_INFINITY;
  let holdStopLossMax = 0;

  // 포트폴리오 총 평가액: 보유 종목 현재가 합산 + 가용 현금
  const totalHoldingsValue = holdings.reduce((sum, row) => {
    const qty = Math.max(0, Math.floor(toNumber(row.quantity, 0)));
    const close = closeByCode.get(row.code) ?? 0;
    const invested = Math.max(0, toNumber(row.invested_amount, 0));
    return sum + (close > 0 && qty > 0 ? close * qty : invested);
  }, 0);
  const totalPortfolioValue = totalHoldingsValue + availableCash;
  // 비중 초과 감지 임계값: 단일 종목이 포트폴리오의 25% 이상이면 분할 매도
  const MAX_WEIGHT_PCT = 25;
  const TARGET_WEIGHT_PCT = 20;

  for (const holding of holdings) {
    const qty = Math.max(0, Math.floor(toNumber(holding.quantity, 0)));
    const buyPrice = toNumber(holding.buy_price, 0);
    const close = closeByCode.get(holding.code) ?? 0;

    if (qty <= 0 || buyPrice <= 0 || close <= 0) {
      summary.skipped += 1;
      await writeActionLog({
        supabase: payload.supabase,
        runId: payload.runId,
        chatId,
        code: holding.code,
        actionType: "SKIP",
        reason: "invalid-holding-or-price",
      });
      continue;
    }

    const strategyState = parsePositionStrategyState(holding.memo, selectedStrategy);
    const tradeProfile = resolvePositionTradeProfile({
      accountStrategy: selectedStrategy,
      positionMemo: holding.memo,
      baseTakeProfitPct,
      baseStopLossPct,
      sellSplitCount,
    });
    const pnlPct = ((close - buyPrice) / buyPrice) * 100;
    const holdingScoreRow = holdingFactorsByCode.get(holding.code);
    const holdingSignal = holdingScoreRow?.signal ?? null;
    const holdingMarket = marketByCode.get(holding.code) ?? "";
    const adaptiveExitThreshold = resolveAdaptiveExitThreshold({
      takeProfitPct: tradeProfile.takeProfitPct,
      stopLossPct: tradeProfile.stopLossPct,
      signal: holdingSignal,
      market: holdingMarket,
      marketPolicy,
      pnlPct,
    });
    const baseExitPlan = planAutoTradeExit({
      quantity: qty,
      pnlPct,
      takeProfitPct: adaptiveExitThreshold.takeProfitPct,
      stopLossPct: adaptiveExitThreshold.stopLossPct,
      takeProfitSplitCount: tradeProfile.takeProfitSplitCount,
      takeProfitTranchesDone: strategyState.takeProfitTranchesDone,
    });

    // 트레일링 스탑: 보유 중 최고가 추적 → 고점 대비 -10% 이탈 시 익절
    const prevPeak = strategyState.peakPrice;
    const updatedPeakPrice = prevPeak != null ? Math.max(prevPeak, close) : close;
    const TRAILING_STOP_FROM_PEAK_PCT = 10; // 고점 대비 하락 퍼센트
    const TRAILING_STOP_ARM_PCT = 5;       // 트레일링 활성화 최소 수익 (평단 +5% 이상일 때만)
    const trailingArmed = pnlPct >= TRAILING_STOP_ARM_PCT;
    const trailingStopBreached =
      trailingArmed &&
      updatedPeakPrice > buyPrice &&
      close < updatedPeakPrice * (1 - TRAILING_STOP_FROM_PEAK_PCT / 100);

    // 시장 레짐이 대형주 방어 모드일 때 KOSDAQ 보유 종목의 익절 기준 선제 적용
    const regimeEarlyExit =
      marketPolicy.mode === "large-cap-defense" &&
      holdingMarket.toUpperCase() === "KOSDAQ" &&
      pnlPct > 1.0;
    const trendExitSignal = detectTrendBreakExitSignal({
      currentPrice: close,
      pnlPct,
      factors: extractScoreFactors(holdingScoreRow?.factors),
      signal: holdingSignal,
      trustScore: evaluateAutoTradeSignalGate({
        currentPrice: close,
        score: toNumber(holdingScoreRow?.score, 0),
        factors: extractScoreFactors(holdingScoreRow?.factors),
        minTrustScore: signalTrustThresholds.rebalance,
        requireAboveSma200: false,
      }).trustScore,
      minTrustForOverride: Math.max(signalTrustThresholds.rebalance, 72),
    });
    const exitPlan: PlannedAutoTradeExit =
      trailingStopBreached
        ? {
            action: "TAKE_PROFIT",
            quantityToSell: qty,
            isPartial: false,
            nextTakeProfitTranchesDone: strategyState.takeProfitTranchesDone,
            reason: "take-profit-final",
          }
        : regimeEarlyExit && trendExitSignal.exitAction === "HOLD"
        ? {
            action: "TAKE_PROFIT",
            quantityToSell: qty,
            isPartial: false,
            nextTakeProfitTranchesDone: strategyState.takeProfitTranchesDone,
            reason: "take-profit-final",
          }
        : trendExitSignal.exitAction === "STOP_LOSS"
      ? {
          action: "STOP_LOSS",
          quantityToSell: qty,
          isPartial: false,
          nextTakeProfitTranchesDone: strategyState.takeProfitTranchesDone,
          reason: "stop-loss",
        }
      : trendExitSignal.exitAction === "TAKE_PROFIT"
        ? {
            action: "TAKE_PROFIT",
            quantityToSell: qty,
            isPartial: false,
            nextTakeProfitTranchesDone: strategyState.takeProfitTranchesDone,
            reason: "take-profit-final",
          }
        : baseExitPlan;

    // 비중 초과 감지 + 시간 기반 손절: HOLD인 경우에만 체크 (이미 다른 exit이 결정된 종목은 제외)
    const finalExitPlan: PlannedAutoTradeExit = (() => {
      if (exitPlan.action !== "HOLD") return exitPlan;

      // 1) 시간 기반 손절 (Time-Stop): 장기 물림 손실 종목 단계적 정리
      const timeStop = evaluateTimeStop({
        quantity: qty,
        pnlPct,
        buyDate: holding.buy_date ?? holding.created_at,
      });
      if (timeStop.triggered) {
        return {
          action: timeStop.phase === "full" ? "STOP_LOSS" : "TAKE_PROFIT",
          quantityToSell: timeStop.quantityToSell,
          isPartial: timeStop.phase === "partial",
          nextTakeProfitTranchesDone: strategyState.takeProfitTranchesDone,
          reason: timeStop.phase === "full" ? "stop-loss" : "take-profit-partial",
        } as PlannedAutoTradeExit;
      }

      // 2) 비중 초과 감지: 포트폴리오 내 단일 종목 비중이 MAX_WEIGHT_PCT 초과 시 분할 매도
      if (totalPortfolioValue <= 0) return exitPlan;
      const currentValue = close * qty;
      const currentWeightPct = (currentValue / totalPortfolioValue) * 100;
      if (currentWeightPct <= MAX_WEIGHT_PCT) return exitPlan;
      return planOverweightReduction({
        currentWeightPct,
        maxWeightPct: MAX_WEIGHT_PCT,
        targetWeightPct: TARGET_WEIGHT_PCT,
        quantity: qty,
        currentPrice: close,
        totalPortfolioValue,
        takeProfitTranchesDone: strategyState.takeProfitTranchesDone,
      });
    })();

    if (finalExitPlan.action === "HOLD") {
      holdCount += 1;
      holdTakeProfitMin = Math.min(holdTakeProfitMin, adaptiveExitThreshold.takeProfitPct);
      holdTakeProfitMax = Math.max(holdTakeProfitMax, adaptiveExitThreshold.takeProfitPct);
      holdStopLossMin = Math.min(holdStopLossMin, adaptiveExitThreshold.stopLossPct);
      holdStopLossMax = Math.max(holdStopLossMax, adaptiveExitThreshold.stopLossPct);
      // peak_price 갱신 (HOLD 시에도 최고가 트래킹)
      if (updatedPeakPrice !== prevPeak) {
        const nextMemo = buildPositionStrategyMemo({
          event: "hold-peak-update",
          note: "trailing-stop-track",
          profile: tradeProfile.profile,
          takeProfitTranchesDone: strategyState.takeProfitTranchesDone,
          peakPrice: updatedPeakPrice,
        });
        await payload.supabase
          .from(PORTFOLIO_TABLES.positions)
          .update({ memo: nextMemo })
          .eq("chat_id", chatId)
          .eq("id", holding.id)
          .then(() => { /* peak update - best effort */ })
          .catch(() => { /* ignore */ });
      }
      await writeActionLog({
        supabase: payload.supabase,
        runId: payload.runId,
        chatId,
        code: holding.code,
        actionType: "HOLD",
        reason:
          trendExitSignal.reason === "hold-override-strong-trend"
            ? "hold-override-strong-trend"
            : "within-range",
        detail: {
          strategyProfile: tradeProfile.profile,
          takeProfitPct: adaptiveExitThreshold.takeProfitPct,
          stopLossPct: adaptiveExitThreshold.stopLossPct,
          buyPrice,
          close,
          pnlPct: Number(pnlPct.toFixed(2)),
          signal: holdingSignal,
          market: holdingMarket,
          marketMode: marketPolicy.mode,
          overrideDetails:
            trendExitSignal.reason === "hold-override-strong-trend"
              ? trendExitSignal.overrideDetails ?? []
              : undefined,
        },
      });
      if (trendExitSignal.reason === "hold-override-strong-trend") {
        summary.notes.push(
          `[보유유지 오버라이드] ${holding.code} · 강세 지속으로 즉시 매도 보류 (${(trendExitSignal.overrideDetails ?? []).join(", ") || "조건 충족"})`
        );
      }
      continue;
    }

    // 매도 이유 노트 (signal/regime/time-stop/overweight 기반이면 명시)
    const exitReasonLabel: string = (() => {
      if (trailingStopBreached) return `[트레일링익절] 고점(${fmtKrw(updatedPeakPrice)}) 대비 -${TRAILING_STOP_FROM_PEAK_PCT}% 이탈 · 수익률 ${pnlPct.toFixed(2)}%`;
      if (trendExitSignal.reason === "signal-strong-sell") return "[신호청산] STRONG_SELL 전환";
      if (trendExitSignal.reason === "signal-sell") return pnlPct > 0 ? "[신호익절] SELL 전환 + 수익 중" : "[신호손절] SELL 전환 + 손실 구간";
      if (trendExitSignal.reason === "trend-break-sma200") return "[추세이탈] SMA200 하향이탈";
      if (trendExitSignal.reason === "trend-break-sma50") return "[추세익절] SMA50 하향이탈";
      if (regimeEarlyExit) return "[레짐익절] 방어모드 KOSDAQ 선익절";
      // time-stop: baseExitPlan이 HOLD였다가 finalExitPlan에서 변경된 경우
      if (exitPlan.action === "HOLD" && (finalExitPlan.action === "STOP_LOSS" || finalExitPlan.action === "TAKE_PROFIT")) {
        const timeStop = evaluateTimeStop({ quantity: qty, pnlPct, buyDate: holding.buy_date ?? holding.created_at });
        if (timeStop.triggered) {
          return `[시간손절] ${timeStop.reason}`;
        }
      }
      if (finalExitPlan.action === "OVERWEIGHT_REDUCTION") {
        const currentWeightPct = totalPortfolioValue > 0
          ? ((close * qty) / totalPortfolioValue * 100).toFixed(1)
          : "?";
        return `[비중조정] ${currentWeightPct}% 초과 → ${(finalExitPlan as { targetWeightPct: number }).targetWeightPct}%로 분할 매도`;
      }
      return "";
    })();

    try {
      const stopLossContext = finalExitPlan.action === "STOP_LOSS"
        ? ((): string => {
            if (trendExitSignal.reason === "signal-strong-sell") return "signal-strong-sell";
            if (trendExitSignal.reason === "signal-sell") return "signal-reversal";
            if (trendExitSignal.reason === "trend-break-sma200") return "trend-break-major";
            if (trendExitSignal.reason === "trend-break-sma50") return "trend-break-minor";
            return "hard-stop";
          })()
        : null;
      const result = await executeAutoTradeSell({
        supabase: payload.supabase,
        runId: payload.runId,
        chatId,
        holding,
        close,
        buyPrice,
        feeRate,
        taxRate,
        sellQty: finalExitPlan.quantityToSell,
        reason: finalExitPlan.action === "OVERWEIGHT_REDUCTION" ? "take-profit-partial" : finalExitPlan.reason,
        stopLossContext,
        profileLabel: getStrategyLabel(tradeProfile.profile) || tradeProfile.profile,
        strategyProfile: tradeProfile.profile,
        takeProfitTranchesDone: strategyState.takeProfitTranchesDone,
        nextTakeProfitTranchesDone: finalExitPlan.nextTakeProfitTranchesDone,
        dryRun: payload.dryRun,
      });

      if (!result.sold) {
        holdCount += 1;
        continue;
      }

      realizedDelta += result.realizedPnlDelta;
      availableCash += result.proceeds;
      // 즉시 가상현금 및 실현손익 갱신
      try {
        await setUserInvestmentPrefs(chatId, {
          virtual_realized_pnl: toNumber(prefs.virtual_realized_pnl, 0) + realizedDelta,
          virtual_cash: Math.max(0, Math.round(availableCash)),
        });
      } catch (e) {
        console.error("[autoTrade] update virtual cash/pnl after sell failed", e);
      }
      if (finalExitPlan.action === "STOP_LOSS") {
        stopLossCount += 1;
      } else {
        takeProfitCount += 1;
      }
      if (finalExitPlan.action === "OVERWEIGHT_REDUCTION") {
        overweightReducedCodes.push(holding.code);
      }
      summary.sells += 1;
      summary.notes.push(`${result.note} · 손익률 ${pnlPct.toFixed(2)}%`);
      if (exitReasonLabel) {
        summary.notes.push(exitReasonLabel);
      } else if (trendExitSignal.reason !== "none") {
        summary.notes.push(`[추세이탈 청산] ${holding.code} · ${trendExitSignal.reason}`);
      }
    } catch (error: unknown) {
      const message = extractErrorMessage(error);
      summary.errors += 1;
      summary.notes.push(`${holding.code} 매도 실패: ${message}`);
      await writeActionLog({
        supabase: payload.supabase,
        runId: payload.runId,
        chatId,
        code: holding.code,
        actionType: "ERROR",
        reason: "daily-sell-failed",
        detail: { error: message },
      });
    }
  }

  if (holdCount > 0 && takeProfitCount === 0 && stopLossCount === 0) {
    const takeProfitMin = Number.isFinite(holdTakeProfitMin)
      ? holdTakeProfitMin
      : Math.abs(toNumber(baseTakeProfitPct, 8));
    const takeProfitMax = holdTakeProfitMax > 0
      ? holdTakeProfitMax
      : Math.abs(toNumber(baseTakeProfitPct, 8));
    const stopLossMin = Number.isFinite(holdStopLossMin)
      ? holdStopLossMin
      : Math.abs(toNumber(baseStopLossPct, 4));
    const stopLossMax = holdStopLossMax > 0
      ? holdStopLossMax
      : Math.abs(toNumber(baseStopLossPct, 4));
    summary.notes.push(
      `보유 종목 ${holdCount}건은 적응형 익절 ${takeProfitMin.toFixed(1)}~${takeProfitMax.toFixed(1)}% / 손절 ${stopLossMin.toFixed(1)}~${stopLossMax.toFixed(1)}% 범위 내에서 유지`
    );
  }

  // 매도 이후 재조회 기준으로 추가매수/신규 매수 후보를 판단한다.
  const { data: postHoldings, error: postHoldingsError } = await fetchLegacyVirtualPositionsForChat({
    supabase: payload.supabase,
    chatId,
    select: "id, code, status, quantity, buy_price, invested_amount, created_at, buy_date, memo",
  });

  if (postHoldingsError) {
    const postHoldingsErrorMessage = queryErrorMessage(postHoldingsError);
    summary.errors += 1;
    summary.notes.push(`매도 후 보유 재조회 실패: ${postHoldingsErrorMessage}`);
  } else {
    const activeHoldings = ((postHoldings ?? []) as HoldingRow[]).filter(
      (row) => (row.status ?? "holding") !== "closed"
    );
    const heldCodes = new Set(
      activeHoldings.map((row) => String(row.code))
    );

    const maxPositions = toPositiveInt(payload.setting.max_positions, 10);
    const currentCount = heldCodes.size;
    const room = Math.max(0, maxPositions - currentCount);
    summary.notes.push(`보유 현황: ${currentCount}/${maxPositions}종목 · 신규 여력 ${room}종목`);

    // 계좌 복구 모드: 포트폴리오 전체 수익률이 -5% 이하면 신규/추가 매수 차단
    const RECOVERY_MODE_THRESHOLD_PCT = -5;
    const portfolioReturnPct = seedCapital > 0
      ? ((totalHoldingsValue + availableCash - seedCapital) / seedCapital) * 100
      : 0;
    const recoveryModeActive = portfolioReturnPct <= RECOVERY_MODE_THRESHOLD_PCT;
    if (recoveryModeActive) {
      summary.notes.push(
        `[복구모드] 전체 수익률 ${portfolioReturnPct.toFixed(1)}% · 신규/추가 매수 차단 · 기존 포지션 정리 우선`
      );
    }

    const addOnConstraint = applyStrategyBuyConstraint({
      selectedStrategy: payload.setting.selected_strategy,
      requestedSlots: recoveryModeActive ? 0 : persistedGuard.requestedSlots,
      baseMinBuyScore: persistedGuard.baseMinBuyScore,
      activeCount: currentCount,
    });

    if (!dailyBuyBlocked && availableCash > 0 && addOnConstraint.buySlots > 0 && activeHoldings.length > 0) {
      const addOnSelectionRaw = await selectDailyAddOnCandidates({
        supabase: payload.supabase,
        holdings: activeHoldings,
        limit: addOnConstraint.buySlots,
        minBuyScore: addOnConstraint.minBuyScore,
        accountStrategy: payload.setting.selected_strategy,
        baseTakeProfitPct,
        baseStopLossPct,
        sellSplitCount,
        marketPolicy,
      });
      const addOnNewsAssist = await applyNewsAssistToSelection(addOnSelectionRaw, "추가매수");
      const addOnSelection = addOnNewsAssist.selection;
      summary.notes.push(...addOnNewsAssist.notes);

      if (addOnSelection.latestAsof) {
        summary.notes.push(`보유 추가매수 점수 기준일: ${addOnSelection.latestAsof}`);
      }

      const addOnFilteringLine = formatFilteringMetricsLine({
        label: "추가매수 필터링",
        metrics: addOnSelection.filteringMetrics,
      });
      if (addOnFilteringLine) {
        summary.notes.push(addOnFilteringLine);
      }
      const addOnRejectReasons = formatTopRejectReasons(addOnSelection.filteringMetrics);
      if (addOnRejectReasons) {
        summary.notes.push(`추가매수 탈락 상위: ${addOnRejectReasons}`);
      }

      const addOnBuyPriceResolution = await resolveBuyExecutionPrices(addOnSelection.candidates, {
        apiBudget: payload.apiBudget,
      });
      const addOnScoreSnapshot = addOnSelection.candidates.length
        ? await fetchLatestScoresByCodes(
            payload.supabase,
            addOnSelection.candidates.map((candidate) => candidate.code)
          ).catch(() => null)
        : null;
      const addOnFactorsByCode = addOnScoreSnapshot?.byCode ?? new Map();

      if (addOnSelection.candidates.length > 0) {
        if (addOnBuyPriceResolution.marketPhase === "intraday") {
          if (addOnBuyPriceResolution.realtimeSkippedByBudget) {
            summary.notes.push("추가매수 매수가 기준: API 예산 보호로 장중 종가 스냅샷 기준 적용");
          } else {
            summary.notes.push(
              addOnBuyPriceResolution.realtimeAppliedCount > 0
                ? `추가매수 매수가 기준: 장중 실시간가 우선 (${addOnBuyPriceResolution.realtimeAppliedCount}/${addOnSelection.candidates.length}종목 반영)`
                : "추가매수 매수가 기준: 장중 실시간가 조회 실패로 종가 기준 적용"
            );
          }
        } else {
          summary.notes.push("추가매수 매수가 기준: 장마감 이후 종가 기준 적용");
        }
      }

      if (!addOnSelection.candidates.length && addOnSelection.latestTopScore > 0) {
        summary.notes.push(
          `보유 추가매수 후보 0건 (최신 상위점수 ${addOnSelection.latestTopScore}점 · 기준 ${addOnSelection.thresholdUsed}점)`
        );
      }

      for (const candidate of addOnSelection.candidates) {
        const holding = activeHoldings.find((item) => item.code === candidate.code);
        if (!holding) continue;
        const executionEntry = addOnBuyPriceResolution.priceByCode.get(candidate.code);
        const executionPrice = executionEntry?.price ?? candidate.close;
        const executionSource = executionEntry?.source ?? "close";
        const scoreRow = addOnFactorsByCode.get(candidate.code);
        const signalGate = evaluateAutoTradeSignalGate({
          currentPrice: executionPrice,
          score: candidate.score,
          factors: extractScoreFactors(scoreRow?.factors),
          minTrustScore: signalTrustThresholds.addOn,
          requireAboveSma200: true,
        });

        if (!signalGate.passed) {
          summary.skipped += 1;
          await writeActionLog({
            supabase: payload.supabase,
            runId: payload.runId,
            chatId,
            code: candidate.code,
            actionType: "SKIP",
            reason: "add-on-signal-gate-reject",
            detail: {
              score: candidate.score,
              trustScore: signalGate.trustScore,
              trustGrade: signalGate.grade,
              reasons: signalGate.reasons,
              metrics: signalGate.metrics,
              price: executionPrice,
              priceSource: executionSource,
            },
          });
          continue;
        }

        const currentQty = Math.max(0, Math.floor(toNumber(holding.quantity, 0)));
        const currentBuyPrice = Math.max(0, toNumber(holding.buy_price, 0));
        const currentInvested = Math.max(
          0,
          toNumber(holding.invested_amount, currentQty * currentBuyPrice)
        );
        const holdingProfile = resolvePositionTradeProfile({
          accountStrategy: payload.setting.selected_strategy,
          positionMemo: holding.memo,
          baseTakeProfitPct,
          baseStopLossPct,
          sellSplitCount,
        });
        const sizing = calculateAutoTradeBuySizing({
          availableCash: deployableCash,
          price: executionPrice,
          slotsLeft: 1,
          currentHoldingCount: Math.max(0, currentCount - 1),
          maxPositions: Math.max(1, maxPositions),
          stopLossPct: holdingProfile.stopLossPct,
          riskBudgetScale: dailyRiskBudget.scale,
          prefs,
        });
        const addOnBudget = Math.max(
          0,
          Math.min(sizing.budget, sizing.totalBudget - currentInvested)
        );
        if (addOnBudget > 0 && addOnBudget < sizing.minOrderAmount) {
          continue;
        }
        const addOnQty = Math.max(0, Math.floor(addOnBudget / executionPrice));
        if (addOnQty <= 0) {
          continue;
        }

        const addOnInvested = Math.round(addOnQty * executionPrice);
        const nextQty = currentQty + addOnQty;
        const nextInvested = currentInvested + addOnInvested;
        const nextBuyPrice = Number((nextInvested / nextQty).toFixed(4));
        const todaySignalReason = buildTodaySignalReasonNote({
          signal: candidate.signal,
          stableTurn: candidate.stableTurn,
          signalGate: { trustScore: signalGate.trustScore, grade: signalGate.grade },
        });
        const filterReason = buildAutoTradeFilterReason(candidate);

        try {
          if (payload.dryRun) {
            addOnBuyCount += 1;
            summary.buys += 1;
            summary.notes.push(
              `[테스트 추가매수안] ${candidate.name}(${candidate.code}) +${addOnQty}주 · 총 ${nextQty}주 · 평균단가 ${fmtKrw(nextBuyPrice)} · 투입 ${fmtKrw(addOnInvested)} · ${formatPriceSourceLabel(executionSource)}${todaySignalReason ? ` · ${todaySignalReason}` : ""}${filterReason ? ` · 필터근거 ${filterReason}` : ""}`
            );
            summary.notes.push(
              buildResponseGuideNote({
                actionType: "add-on-buy",
                code: candidate.code,
                basePrice: nextBuyPrice,
                quantity: nextQty,
                investedAmount: nextInvested,
                takeProfitPct: holdingProfile.takeProfitPct,
                stopLossPct: holdingProfile.stopLossPct,
              })
            );
            await writeActionLog({
              supabase: payload.supabase,
              runId: payload.runId,
              chatId,
              code: candidate.code,
              actionType: "BUY",
              reason: "dry-run-add-on-buy",
              detail: {
                addOnQty,
                addOnInvested,
                price: executionPrice,
                priceSource: executionSource,
                nextQty,
                nextInvested,
                nextBuyPrice,
                score: candidate.score,
                signalTrust: {
                  score: signalGate.trustScore,
                  grade: signalGate.grade,
                  metrics: signalGate.metrics,
                },
              },
            });
            availableCash = Math.max(0, availableCash - addOnInvested);
            deployableCash = Math.max(0, deployableCash - addOnInvested);
            continue;
          }

          const opKey = `${chatId}:BUY:${candidate.code}:${Math.round(executionPrice)}:${addOnQty}:${new Date().toISOString().slice(0,16)}`;
          const registered = await tryRegisterOperation({
            supabase: payload.supabase,
            opKey,
            chatId,
            strategy: AUTO_TRADE_STRATEGY_ID,
            meta: { event: "add-on-buy", profile: holdingProfile.profile, runId: payload.runId },
          }).catch((err) => { throw err; });

          if (!registered) {
            summary.skipped += 1;
            await writeActionLog({
              supabase: payload.supabase,
              runId: payload.runId,
              chatId,
              code: candidate.code,
              actionType: "SKIP",
              reason: "duplicate-execution",
              detail: { opKey },
            });
            continue;
          }

          const { error: updateError } = await payload.supabase
            .from(PORTFOLIO_TABLES.positions)
            .update({
              quantity: nextQty,
              invested_amount: nextInvested,
              buy_price: nextBuyPrice,
              memo: buildPositionStrategyMemo({
                event: "add-on-buy",
                note: "autotrade-add-on-buy",
                profile: holdingProfile.profile,
                takeProfitTranchesDone: 0,
              }),
              status: "holding",
            })
            .eq("chat_id", chatId)
            .eq("id", holding.id);

          if (updateError) {
            throw updateError;
          }

          const tradeId = await appendTradeLog({
            supabase: payload.supabase,
            chatId,
            code: candidate.code,
            side: "BUY",
            price: executionPrice,
            quantity: addOnQty,
            grossAmount: addOnInvested,
            netAmount: addOnInvested,
            memo: buildStrategyMemo({
              strategyId: AUTO_TRADE_STRATEGY_ID,
              event: "add-on-buy",
              note: "autotrade-add-on-buy",
            }),
            source: "AUTO",
            brokerName: null,
            accountName: null,
          });

          try {
            await setUserInvestmentPrefs(chatId, {
              virtual_cash: Math.max(0, Math.round(availableCash)),
            });
          } catch (e) {
            console.error("[autoTrade] update virtual_cash after add-on buy failed", e);
          }

          try {
            await setUserInvestmentPrefs(chatId, {
              virtual_cash: Math.max(0, Math.round(availableCash)),
            });
          } catch (e) {
            console.error("[autoTrade] update virtual_cash after rebalance buy failed", e);
          }

          await appendTradeLotsForHolding({
            chatId,
            watchlistId: holding.id,
            code: candidate.code,
            quantity: addOnQty,
            investedAmount: addOnInvested,
            buyPrice: executionPrice,
            acquiredAt: new Date().toISOString(),
            note: "autotrade-add-on-buy",
            sourceTradeId: tradeId,
          });

          availableCash = Math.max(0, availableCash - addOnInvested);
          deployableCash = Math.max(0, deployableCash - addOnInvested);
          addOnBuyCount += 1;
          summary.buys += 1;
          summary.notes.push(
            `[실행 추가매수] ${candidate.name}(${candidate.code}) +${addOnQty}주 · 총 ${nextQty}주 · 평균단가 ${fmtKrw(nextBuyPrice)} · 투입 ${fmtKrw(addOnInvested)} · 점수 ${candidate.score.toFixed(1)} · ${formatPriceSourceLabel(executionSource)}${todaySignalReason ? ` · ${todaySignalReason}` : ""}${filterReason ? ` · 필터근거 ${filterReason}` : ""}`
          );
          summary.notes.push(
            buildResponseGuideNote({
              actionType: "add-on-buy",
              code: candidate.code,
              basePrice: nextBuyPrice,
              quantity: nextQty,
              investedAmount: nextInvested,
              takeProfitPct: holdingProfile.takeProfitPct,
              stopLossPct: holdingProfile.stopLossPct,
            })
          );
          await writeActionLog({
            supabase: payload.supabase,
            runId: payload.runId,
            chatId,
            code: candidate.code,
            actionType: "BUY",
            reason: "add-on-buy",
            detail: {
              addOnQty,
              addOnInvested,
              price: executionPrice,
              priceSource: executionSource,
              nextQty,
              nextInvested,
              nextBuyPrice,
              score: candidate.score,
              tradeId,
              cashAfter: availableCash,
              deployableCashAfter: deployableCash,
              marketMode: marketPolicy.mode,
              marketReason: marketPolicy.reason,
              signalTrust: {
                score: signalGate.trustScore,
                grade: signalGate.grade,
                metrics: signalGate.metrics,
              },
            },
          });
          appendVirtualDecisionLog({
            chatId,
            code: candidate.code,
            action: "BUY",
            strategyId: AUTO_TRADE_STRATEGY_ID,
            strategyVersion: "v1",
            confidence: Math.min(100, Math.max(0, candidate.score)),
            expectedHorizonDays: 5,
            reasonSummary: `보유 종목 추가매수 (점수 ${candidate.score.toFixed(1)})`,
            reasonDetails: {
              trigger: "add-on-buy",
              addOnQty,
              addOnInvested,
              price: executionPrice,
              priceSource: executionSource,
              nextQty,
              nextBuyPrice,
              score: candidate.score,
              signalTrust: {
                score: signalGate.trustScore,
                grade: signalGate.grade,
                metrics: signalGate.metrics,
              },
            },
            linkedTradeId: tradeId ?? undefined,
          }).catch((err: unknown) => console.error("[autoTrade] decision log add-on BUY failed", err));
        } catch (error: unknown) {
          const message = extractErrorMessage(error);
          summary.errors += 1;
          summary.notes.push(`${candidate.code} 추가매수 실패: ${message}`);
          await writeActionLog({
            supabase: payload.supabase,
            runId: payload.runId,
            chatId,
            code: candidate.code,
            actionType: "ERROR",
            reason: "add-on-buy-failed",
            detail: { error: message },
          });
        }
      }
    }

    // 기존 monday_buy_slots를 회차당 신규매수 상한으로 재사용한다.
    const maxNewBuysPerRun = toPositiveInt(payload.setting.monday_buy_slots, 2);
    // 복구 모드 시 신규 매수 슬롯을 0으로 강제
    const rawBuySlots = recoveryModeActive ? 0 : Math.min(room, maxNewBuysPerRun);
    const perfAdjustedRebalance = applyPerformanceBuyGuard({
      requestedSlots: rawBuySlots,
      baseMinBuyScore: toPositiveInt(payload.setting.min_buy_score, 72),
      perf: dailySellPerf,
    });
    const persistedRebalanceGuard = applyPersistedGateGuard({
      requestedSlots: perfAdjustedRebalance.requestedSlots,
      baseMinBuyScore: perfAdjustedRebalance.baseMinBuyScore,
      gateStatus: persistedGateState?.status,
    });
    const buyConstraint = applyStrategyBuyConstraint({
      selectedStrategy: payload.setting.selected_strategy,
      requestedSlots: persistedRebalanceGuard.requestedSlots,
      baseMinBuyScore: persistedRebalanceGuard.baseMinBuyScore,
      activeCount: currentCount,
    });

    if (perfAdjustedRebalance.note) {
      summary.notes.push(perfAdjustedRebalance.note);
    }
    if (persistedRebalanceGuard.note) {
      summary.notes.push(persistedRebalanceGuard.note);
    }
    const buySlots = buyConstraint.buySlots;

    if (buyConstraint.note) {
      summary.notes.push(buyConstraint.note);
    }

    if (buySlots <= 0) {
      if (!buyConstraint.note) {
        summary.notes.push("신규 매수 불가: 추가 매수 슬롯 0건");
      }
      await writeActionLog({
        supabase: payload.supabase,
        runId: payload.runId,
        chatId,
        actionType: "SKIP",
        reason: buyConstraint.reason === "default"
          ? "no-buy-slots"
          : buyConstraint.reason,
        detail: {
          buySlots,
          rawBuySlots,
          room,
          maxPositions,
          currentCount,
          selectedStrategy: payload.setting.selected_strategy ?? null,
        },
      });
    } else if (dailyBuyBlocked) {
      summary.notes.push("신규 매수 차단: 일손실 한도 도달");
      await writeActionLog({
        supabase: payload.supabase,
        runId: payload.runId,
        chatId,
        actionType: "SKIP",
        reason: "daily-loss-limit-reached",
        detail: {
          dailyRealizedPnl,
          dailyLossLimitPct,
          lossCapAmount: dailyRiskBudget.lossCapAmount,
        },
      });
    } else if (availableCash <= 0) {
      summary.notes.push("신규 매수 불가: 투자 가능 현금 0원");
      await writeActionLog({
        supabase: payload.supabase,
        runId: payload.runId,
        chatId,
        actionType: "SKIP",
        reason: "no-available-cash",
        detail: { availableCash, buySlots },
      });
    } else if (deployableCash <= 0) {
      summary.notes.push("신규 매수 보류: 현금 하한 유지 구간");
      await writeActionLog({
        supabase: payload.supabase,
        runId: payload.runId,
        chatId,
        actionType: "SKIP",
        reason: "cash-reserve-floor",
        detail: {
          availableCash,
          deployableCash,
          seedCapital,
          minCashReservePct: marketPolicy.minCashReservePct,
          marketMode: marketPolicy.mode,
          marketReason: marketPolicy.reason,
          buySlots,
        },
      });
    } else {
      const candidateSelectionRaw = await selectMondayCandidates({
        supabase: payload.supabase,
        chatId,
        minBuyScore: buyConstraint.minBuyScore,
        limit: resolveCandidateProbeLimit(buySlots),
        heldCodes,
        marketPolicy,
        selectedStrategy: payload.setting.selected_strategy,
        riskProfile: prefs.risk_profile ?? null,
        discoveryProfile,
      });
      const rebalanceNewsAssist = await applyNewsAssistToSelection(candidateSelectionRaw, "리밸런싱 신규매수");
      const candidateSelection = rebalanceNewsAssist.selection;
      summary.notes.push(...rebalanceNewsAssist.notes);
      const candidates = candidateSelection.candidates;
      const rebalanceBuyPriceResolution = await resolveBuyExecutionPrices(candidates, {
        apiBudget: payload.apiBudget,
      });
      const rebalanceScoreSnapshot = candidates.length
        ? await fetchLatestScoresByCodes(payload.supabase, candidates.map((candidate) => candidate.code)).catch(
            () => null
          )
        : null;
      const rebalanceFactorsByCode = rebalanceScoreSnapshot?.byCode ?? new Map();

      if (candidateSelection.latestAsof) {
        summary.notes.push(`점수 기준일: ${candidateSelection.latestAsof}`);
      }

      if (candidateSelection.selectionMode === "signal-relaxed") {
        summary.notes.push(
          `후보 기준 완화: 최신 상위점수 ${candidateSelection.latestTopScore}점 기준으로 ${candidateSelection.thresholdUsed}점 이상 BUY 계열 종목 선별`
        );
      }
      if (candidateSelection.selectionMode === "top-score-fallback") {
        summary.notes.push(
          `후보 대체선별: BUY 신호 부족으로 상위 점수대 ${candidateSelection.thresholdUsed}점 이상 종목 선별`
        );
      }

      if (candidates.length > 0) {
        if (rebalanceBuyPriceResolution.marketPhase === "intraday") {
          if (rebalanceBuyPriceResolution.realtimeSkippedByBudget) {
            summary.notes.push("신규매수 매수가 기준: API 예산 보호로 장중 종가 스냅샷 기준 적용");
          } else {
            summary.notes.push(
              rebalanceBuyPriceResolution.realtimeAppliedCount > 0
                ? `신규매수 매수가 기준: 장중 실시간가 우선 (${rebalanceBuyPriceResolution.realtimeAppliedCount}/${candidates.length}종목 반영)`
                : "신규매수 매수가 기준: 장중 실시간가 조회 실패로 종가 기준 적용"
            );
          }
        } else {
          summary.notes.push("신규매수 매수가 기준: 장마감 이후 종가 기준 적용");
        }
      }

      if (!candidates.length) {
        summary.notes.push(
          candidateSelection.latestTopScore > 0
            ? `신규 매수 후보 0건 (최신 상위점수 ${candidateSelection.latestTopScore}점 · 기준 ${candidateSelection.thresholdUsed}점)`
            : `신규 매수 후보 0건 (min_buy_score ${toPositiveInt(payload.setting.min_buy_score, 72)} · 신호 BUY/STRONG_BUY/WATCH)`
        );
      }

      let slotsLeft = buySlots;
      let plannedHoldingCount = currentCount;
      let sizingNoteAdded = false;
      for (const candidate of candidates) {
        if (slotsLeft <= 0) break;

        const scoreRow = rebalanceFactorsByCode.get(candidate.code);
        const rebalanceFactors = extractScoreFactors(scoreRow?.factors);
        const newsBias = resolveNewsBiasFromFactors(rebalanceFactors);

        const candidateProfile = classifyAutoTradeEntryProfile({
          accountStrategy: payload.setting.selected_strategy,
          riskProfile: prefs.risk_profile,
          marketMode: marketPolicy.mode,
          newsBias,
          candidate: {
            ...candidate,
            stableTurn: candidate.stableTurn ?? null,
            stableTrust: candidate.stableTrust ?? null,
          },
        });
        const entryProfile = resolvePositionTradeProfile({
          accountStrategy: candidateProfile,
          baseTakeProfitPct,
          baseStopLossPct,
          sellSplitCount,
        });
        const adjustedEntryProfile = applyDynamicTradeProfileAdjustments({
          tradeProfile: entryProfile,
          context: {
            score: candidate.score,
            signal: candidate.signal,
            rsi14: candidate.rsi14,
            liquidity: candidate.liquidity,
            stableTurn: candidate.stableTurn,
            stableTrust: candidate.stableTrust,
            marketMode: marketPolicy.mode,
            isSectorLeader: candidate.isSectorLeader,
          },
        });
        const profileLabel = getStrategyLabel(adjustedEntryProfile.profile) || adjustedEntryProfile.profile;
        const executionEntry = rebalanceBuyPriceResolution.priceByCode.get(candidate.code);
        const executionPrice = executionEntry?.price ?? candidate.close;
        const executionSource = executionEntry?.source ?? "close";
        const signalGate = evaluateAutoTradeSignalGate({
          currentPrice: executionPrice,
          score: candidate.score,
          factors: rebalanceFactors,
          minTrustScore: signalTrustThresholds.rebalance,
          requireAboveSma200: true,
        });

        if (!signalGate.passed) {
          summary.skipped += 1;
          await writeActionLog({
            supabase: payload.supabase,
            runId: payload.runId,
            chatId,
            code: candidate.code,
            actionType: "SKIP",
            reason: "rebalance-signal-gate-reject",
            detail: {
              score: candidate.score,
              trustScore: signalGate.trustScore,
              trustGrade: signalGate.grade,
              reasons: signalGate.reasons,
              metrics: signalGate.metrics,
              price: executionPrice,
              priceSource: executionSource,
            },
          });
          continue;
        }

        const sizing = calculateAutoTradeBuySizing({
          availableCash: deployableCash,
          price: executionPrice,
          slotsLeft,
          currentHoldingCount: plannedHoldingCount,
          maxPositions,
          stopLossPct: adjustedEntryProfile.stopLossPct,
          riskBudgetScale: dailyRiskBudget.scale,
          prefs,
        });

        if (!sizingNoteAdded) {
          const riskCapText = sizing.maxBudgetByRisk
            ? ` · 손절기준 상한 ${fmtKrw(sizing.maxBudgetByRisk)}`
            : "";
          summary.notes.push(
            `사이징 기준: 목표보유 ${sizing.targetPositions}종목 · 분할 1/${sizing.splitCount} · 회당 ${fmtKrw(sizing.budget)} (총 목표 ${fmtKrw(sizing.totalBudget)})${riskCapText}`
          );
          sizingNoteAdded = true;
        }

        const qty = sizing.quantity;
        if (qty <= 0) {
          insufficientCashCount += 1;
          summary.skipped += 1;
          // 슬롯을 소모하여 다음 후보가 더 큰 예산을 배정받도록 함
          slotsLeft -= 1;
          await writeActionLog({
            supabase: payload.supabase,
            runId: payload.runId,
            chatId,
            code: candidate.code,
            actionType: "SKIP",
            reason: "insufficient-cash",
            detail: {
              availableCash,
              budget: sizing.budget,
              totalBudget: sizing.totalBudget,
              budgetPerSlot: sizing.budgetPerSlot,
              budgetPerTargetPosition: sizing.budgetPerTargetPosition,
              maxBudgetByRisk: sizing.maxBudgetByRisk,
              splitCount: sizing.splitCount,
              price: executionPrice,
            },
          });
          continue;
        }

        const investedAmount = sizing.investedAmount;
        const todaySignalReason = buildTodaySignalReasonNote({
          signal: candidate.signal,
          stableTurn: candidate.stableTurn,
          signalGate: { trustScore: signalGate.trustScore, grade: signalGate.grade },
        });
        const filterReason = buildAutoTradeFilterReason(candidate);

        try {
          if (payload.dryRun) {
            const targetPct = Math.abs(toNumber(adjustedEntryProfile.takeProfitPct, 8));
            const targetPrice = Math.round(executionPrice * (1 + targetPct / 100));
            const expectedPnl = Math.max(0, Math.round((targetPrice - executionPrice) * qty));
            rebalanceBuyCount += 1;
            summary.buys += 1;
            summary.notes.push(
              `[테스트 매수안] ${candidate.name}(${candidate.code}) ${qty}주 · 전략 ${profileLabel} · 매수가 ${fmtKrw(executionPrice)} · 목표가 ${fmtKrw(targetPrice)} · 기대수익 ${fmtKrw(expectedPnl)} (${targetPct.toFixed(1)}%) · ${formatPriceSourceLabel(executionSource)}${todaySignalReason ? ` · ${todaySignalReason}` : ""}${filterReason ? ` · 필터근거 ${filterReason}` : ""}`
            );
            summary.notes.push(
              buildResponseGuideNote({
                actionType: "new-buy",
                code: candidate.code,
                basePrice: executionPrice,
                quantity: qty,
                investedAmount,
                takeProfitPct: adjustedEntryProfile.takeProfitPct,
                stopLossPct: adjustedEntryProfile.stopLossPct,
              })
            );
            await writeActionLog({
              supabase: payload.supabase,
              runId: payload.runId,
              chatId,
              code: candidate.code,
              actionType: "BUY",
              reason: "dry-run-rebalance-buy",
              detail: {
                qty,
                price: executionPrice,
                priceSource: executionSource,
                investedAmount,
                totalBudget: sizing.totalBudget,
                splitCount: sizing.splitCount,
                score: candidate.score,
                strategyProfile: adjustedEntryProfile.profile,
                targetPrice,
                expectedPnl,
                signalTrust: {
                  score: signalGate.trustScore,
                  grade: signalGate.grade,
                  metrics: signalGate.metrics,
                },
              },
            });
            plannedHoldingCount += 1;
            availableCash = Math.max(0, availableCash - investedAmount);
            deployableCash = Math.max(0, deployableCash - investedAmount);
            slotsLeft -= 1;
            continue;
          }

          const opKey = `${chatId}:BUY:${candidate.code}:${Math.round(executionPrice)}:${qty}:${new Date().toISOString().slice(0,16)}`;
          const registered = await tryRegisterOperation({
            supabase: payload.supabase,
            opKey,
            chatId,
            strategy: AUTO_TRADE_STRATEGY_ID,
            meta: { event: "rebalance-buy", profile: adjustedEntryProfile.profile, runId: payload.runId },
          }).catch((err) => { throw err; });

          if (!registered) {
            summary.skipped += 1;
            await writeActionLog({
              supabase: payload.supabase,
              runId: payload.runId,
              chatId,
              code: candidate.code,
              actionType: "SKIP",
              reason: "duplicate-execution",
              detail: { opKey },
            });
            continue;
          }

          const { data: existingPositionForCode, error: existingPositionForCodeError } = await fetchLegacyPositionByCode({
            supabase: payload.supabase,
            chatId,
            code: candidate.code,
          });

          if (existingPositionForCodeError) {
            throw existingPositionForCodeError;
          }

          const hasNonVirtualPositionForCode =
            !!existingPositionForCode &&
            (existingPositionForCode.broker_name != null || existingPositionForCode.account_name != null);

          if (hasNonVirtualPositionForCode) {
            summary.skipped += 1;
            summary.notes.push(
              `${candidate.code} 신규 매수 스킵: 실계좌 보유 종목과 코드 충돌(가상 전용 보호)`
            );
            await writeActionLog({
              supabase: payload.supabase,
              runId: payload.runId,
              chatId,
              code: candidate.code,
              actionType: "SKIP",
              reason: "non-virtual-position-exists",
              detail: {
                opKey,
                existingPositionId: Number(existingPositionForCode.id ?? 0) || null,
              },
            });
            continue;
          }

          const targetHorizon = resolveTargetHorizon({
            profile: adjustedEntryProfile.profile,
            expectedHorizonDays: adjustedEntryProfile.expectedHorizonDays,
          });
          const horizonReason = `profile=${entryProfile.profile};market=${marketPolicy.mode};news=${newsBias};signal=${String(candidate.signal ?? "").trim() || "NA"}`;
          const positionUpsertPayload: Record<string, unknown> = {
            chat_id: chatId,
            code: candidate.code,
            buy_price: executionPrice,
            buy_date: new Date().toISOString().slice(0, 10),
            quantity: qty,
            invested_amount: investedAmount,
            bucket: resolvePositionBucketFromProfile(adjustedEntryProfile.profile),
            broker_name: null,
            account_name: null,
            memo: buildPositionStrategyMemo({
              event: "rebalance-buy",
              note: "autotrade-rebalance-buy",
              profile: adjustedEntryProfile.profile,
              takeProfitTranchesDone: 0,
            }),
            status: "holding",
            target_horizon: targetHorizon,
            horizon_reason: horizonReason,
            macro_context_at_entry: {
              mode: marketPolicy.mode,
              label: marketPolicy.label,
              reason: marketPolicy.reason,
              minCashReservePct: marketPolicy.minCashReservePct,
            },
            news_context_at_entry: {
              bias: newsBias,
              signal: candidate.signal ?? null,
              stableTurn: candidate.stableTurn ?? null,
              stableTrust: candidate.stableTrust ?? null,
            },
            planned_review_at: resolvePlannedReviewAt(adjustedEntryProfile.expectedHorizonDays),
          };

          let upserted: Record<string, unknown> | null = null;
          const upsertTry = await payload.supabase
            .from(PORTFOLIO_TABLES.positions)
            .upsert(positionUpsertPayload, { onConflict: "chat_id,code", ignoreDuplicates: true })
            .select("id, created_at, buy_date")
            .maybeSingle();

          if (upsertTry.error && isMissingVirtualPositionHorizonColumns(upsertTry.error)) {
            const fallbackPayload = { ...positionUpsertPayload };
            delete fallbackPayload.target_horizon;
            delete fallbackPayload.horizon_reason;
            delete fallbackPayload.macro_context_at_entry;
            delete fallbackPayload.news_context_at_entry;
            delete fallbackPayload.planned_review_at;

            const fallbackTry = await payload.supabase
              .from(PORTFOLIO_TABLES.positions)
              .upsert(fallbackPayload, { onConflict: "chat_id,code", ignoreDuplicates: true })
              .select("id, created_at, buy_date")
              .maybeSingle();
            if (fallbackTry.error) {
              throw fallbackTry.error;
            }
            upserted = (fallbackTry.data as Record<string, unknown> | null) ?? null;
          } else {
            if (upsertTry.error) {
              throw upsertTry.error;
            }
            upserted = (upsertTry.data as Record<string, unknown> | null) ?? null;
          }

          const tradeId = await appendTradeLog({
            supabase: payload.supabase,
            chatId,
            code: candidate.code,
            side: "BUY",
            price: executionPrice,
            quantity: qty,
            grossAmount: investedAmount,
            netAmount: investedAmount,
            memo: buildStrategyMemo({
              strategyId: AUTO_TRADE_STRATEGY_ID,
              event: "rebalance-buy",
              note: "autotrade-rebalance-buy",
            }),
            source: "AUTO",
            brokerName: null,
            accountName: null,
          });

          const positionId = Number((upserted as Record<string, unknown> | null)?.id ?? 0) || null;
          if (positionId) {
            await ensureTradeLotsForHolding({
              chatId,
              watchlistId: positionId,
              code: candidate.code,
              quantity: qty,
              investedAmount,
              buyPrice: executionPrice,
              acquiredAt: String((upserted as Record<string, unknown> | null)?.created_at ?? "") || null,
              buyDate: String((upserted as Record<string, unknown> | null)?.buy_date ?? "") || null,
            });
          }

          availableCash = Math.max(0, availableCash - investedAmount);
          deployableCash = Math.max(0, deployableCash - investedAmount);
          plannedHoldingCount += 1;
          rebalanceBuyCount += 1;
          summary.buys += 1;
          summary.notes.push(
            `[실행 매수] ${candidate.name}(${candidate.code}) ${qty}주 · 전략 ${profileLabel} · 매수가 ${fmtKrw(executionPrice)} · 투입 ${fmtKrw(investedAmount)} · 점수 ${candidate.score.toFixed(1)} · ${formatPriceSourceLabel(executionSource)}${todaySignalReason ? ` · ${todaySignalReason}` : ""}${filterReason ? ` · 필터근거 ${filterReason}` : ""}`
          );
          summary.notes.push(
            buildResponseGuideNote({
              actionType: "new-buy",
              code: candidate.code,
              basePrice: executionPrice,
              quantity: qty,
              investedAmount,
              takeProfitPct: entryProfile.takeProfitPct,
              stopLossPct: entryProfile.stopLossPct,
            })
          );
          await writeActionLog({
            supabase: payload.supabase,
            runId: payload.runId,
            chatId,
            code: candidate.code,
            actionType: "BUY",
            reason: "rebalance-buy",
            detail: {
              qty,
              price: executionPrice,
              priceSource: executionSource,
              investedAmount,
              totalBudget: sizing.totalBudget,
              splitCount: sizing.splitCount,
              score: candidate.score,
              strategyProfile: entryProfile.profile,
              tradeId,
              cashAfter: availableCash,
              deployableCashAfter: deployableCash,
              marketMode: marketPolicy.mode,
              marketReason: marketPolicy.reason,
              targetHorizon,
              horizonReason,
              signalTrust: {
                score: signalGate.trustScore,
                grade: signalGate.grade,
                metrics: signalGate.metrics,
              },
            },
          });
          // 결정로그: 일일 리밸런싱 재매수
          appendVirtualDecisionLog({
            chatId,
            code: candidate.code,
            action: "BUY",
            strategyId: AUTO_TRADE_STRATEGY_ID,
            strategyVersion: "v1",
            confidence: Math.min(100, Math.max(0, candidate.score)),
            expectedHorizonDays: entryProfile.expectedHorizonDays,
            reasonSummary: `자동 리밸런싱 재매수 (${profileLabel}, 점수 ${candidate.score.toFixed(1)})`,
            reasonDetails: { score: candidate.score, price: executionPrice, priceSource: executionSource, qty, investedAmount, totalBudget: sizing.totalBudget, splitCount: sizing.splitCount, strategyProfile: entryProfile.profile, trigger: "rebalance-buy", signalTrust: { score: signalGate.trustScore, grade: signalGate.grade, metrics: signalGate.metrics } },
            linkedTradeId: tradeId ?? undefined,
          }).catch((err: unknown) => console.error("[autoTrade] decision log rebalance BUY failed", err));
        } catch (error: unknown) {
          const message = extractErrorMessage(error);
          summary.errors += 1;
          summary.notes.push(`${candidate.code} 신규 매수 실패: ${message}`);
          await writeActionLog({
            supabase: payload.supabase,
            runId: payload.runId,
            chatId,
            code: candidate.code,
            actionType: "ERROR",
            reason: "rebalance-buy-failed",
            detail: { error: message },
          });
        }

        slotsLeft -= 1;
      }
    }
  }

  summary.notes.push(
    `일일판단 요약: 보유유지 ${holdCount}건 · 익절 ${takeProfitCount}건 · 손절 ${stopLossCount}건 · 추가매수 ${addOnBuyCount}건 · 신규매수 ${rebalanceBuyCount}건`
  );
  if (insufficientCashCount > 0) {
    summary.notes.push(`현금 부족으로 매수 스킵 ${insufficientCashCount}건`);
  }

  if (!payload.dryRun) {
    await setUserInvestmentPrefs(chatId, {
      virtual_realized_pnl: toNumber(prefs.virtual_realized_pnl, 0) + realizedDelta,
      virtual_cash: Math.max(0, Math.round(availableCash)),
    });
    await syncVirtualPortfolio(chatId, chatId);
  }

  if (overweightReducedCodes.length > 0) {
    summary.overweightReducedCodes = overweightReducedCodes;
  }

  return summary;
}

function buildDefaultSettingForChat(chatId: number, riskProfile?: "safe" | "balanced" | "active"): AutoTradeSettingRow {
  if (riskProfile === "active") {
    return {
      chat_id: chatId,
      is_enabled: true,
      monday_buy_slots: 3,
      max_positions: 10,
      min_buy_score: 74,
      take_profit_pct: 10,
      stop_loss_pct: 5,
      long_term_ratio: 55,
      selected_strategy: "POSITION_CORE",
    };
  }
  if (riskProfile === "balanced") {
    return {
      chat_id: chatId,
      is_enabled: true,
      monday_buy_slots: 2,
      max_positions: 8,
      min_buy_score: 72,
      take_profit_pct: 9,
      stop_loss_pct: 4,
      long_term_ratio: 65,
      selected_strategy: "SWING",
    };
  }
  return {
    chat_id: chatId,
    is_enabled: true,
    monday_buy_slots: 2,
    max_positions: 6,
    min_buy_score: 70,
    take_profit_pct: 8,
    stop_loss_pct: 4,
    long_term_ratio: 75,
    selected_strategy: "HOLD_SAFE",
  };
}

export async function runVirtualAutoTradingForChat(input: {
  chatId: number;
  mode?: RunMode;
  dryRun?: boolean;
  ensureEnabled?: boolean;
}): Promise<ChatAutoTradeRunSummary> {
  const mode = input.mode ?? "auto";
  let dryRun = Boolean(input.dryRun);
  const ensureEnabled = input.ensureEnabled !== false;

  const supabase: SupabaseClientAny = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const runType = selectRunType(mode);
  const runKey = `${kstDateKey()}-${Date.now()}`;

  const { data: settingRow } = await supabase
    .from("virtual_autotrade_settings")
    .select(
      "chat_id, is_enabled, monday_buy_slots, max_positions, min_buy_score, take_profit_pct, stop_loss_pct, long_term_ratio, last_monday_buy_at, last_daily_review_at, selected_strategy"
    )
    .eq("chat_id", input.chatId)
    .maybeSingle();

  const prefs = await getUserInvestmentPrefs(input.chatId);
  if (prefs.virtual_shadow_mode && !dryRun) {
    dryRun = true;
  }
  const defaultSetting = buildDefaultSettingForChat(input.chatId, prefs.risk_profile);

  const setting: AutoTradeSettingRow = {
    ...defaultSetting,
    ...(settingRow as Partial<AutoTradeSettingRow> | null ?? {}),
    chat_id: input.chatId,
    long_term_ratio: normalizeLongTermRatio(
      (settingRow as Partial<AutoTradeSettingRow> | null)?.long_term_ratio,
      defaultSetting.long_term_ratio ?? 70
    ),
    is_enabled: ensureEnabled ? true : Boolean((settingRow as any)?.is_enabled ?? defaultSetting.is_enabled),
  };

  if (ensureEnabled) {
    await supabase.from("virtual_autotrade_settings").upsert(
      {
        chat_id: setting.chat_id,
        is_enabled: setting.is_enabled,
        monday_buy_slots: setting.monday_buy_slots,
        max_positions: setting.max_positions,
        min_buy_score: setting.min_buy_score,
        take_profit_pct: setting.take_profit_pct,
        stop_loss_pct: setting.stop_loss_pct,
        long_term_ratio: setting.long_term_ratio,
        selected_strategy: setting.selected_strategy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "chat_id" }
    );
  }

  const runStart = await startRun({
    supabase,
    runType: "MANUAL",
    runKey,
    chatId: input.chatId,
  });
  const runId = runStart.runId;

  const action = runType === "MONDAY_BUY"
    ? await runMondayBuyForUser({
        supabase,
        setting,
        runId,
        dryRun,
      })
    : await runDailyReviewForUser({
        supabase,
        setting,
        runId,
        dryRun,
      });

  if (prefs.virtual_shadow_mode) {
    action.notes.unshift("[SHADOW] 실반영 없이 신호 동시 검증 모드");
  }

  const status = action.errors > 0
    ? "FAILED"
    : action.buys + action.sells > 0
      ? "SUCCESS"
      : "SKIPPED";

  await finishRun({
    supabase,
    runId,
    status,
    summary: {
      mode,
      runType,
      buys: action.buys,
      sells: action.sells,
      skipped: action.skipped,
      errors: action.errors,
      notes: action.notes,
      dryRun,
    },
  });

  const recentMetrics = await getRecentAutoTradeMetrics({
    supabase,
    chatId: input.chatId,
    windowDays: 7,
  });

  const sellPerf = await getRecentAutoTradeSellPerformance({
    supabase,
    chatId: input.chatId,
    windowDays: 45,
  });
  if (sellPerf) {
    const gateStatus = resolveStrategyGateStatus({
      sellCount: sellPerf.sellCount,
      winRate: sellPerf.winRate,
      profitFactor: sellPerf.profitFactor,
      maxLossStreak: sellPerf.maxLossStreak,
      windowDays: sellPerf.windowDays,
    });
    await upsertStrategyGateState({
      supabase,
      chatId: input.chatId,
      strategyId: AUTO_TRADE_STRATEGY_ID,
      strategyProfile: setting.selected_strategy ?? null,
      metrics: {
        sellCount: sellPerf.sellCount,
        winRate: sellPerf.winRate,
        profitFactor: sellPerf.profitFactor,
        maxLossStreak: sellPerf.maxLossStreak,
        windowDays: sellPerf.windowDays,
      },
      status: gateStatus,
      meta: {
        mode,
        runType,
        dryRun,
      },
    });
    action.notes.push(
      `전략게이트: ${toGateLabel(gateStatus)} (PF ${sellPerf.profitFactor != null ? sellPerf.profitFactor.toFixed(2) : "N/A"}, 승률 ${sellPerf.winRate.toFixed(1)}%, 연속손실 ${sellPerf.maxLossStreak}회)`
    );
  }

  return {
    mode,
    runType,
    runKey,
    dryRun,
    action,
    recentMetrics,
  };
}

async function startRun(payload: {
  supabase: SupabaseClientAny;
  runType: RunType;
  runKey: string;
  chatId: number;
}): Promise<{ runId: number | null; shouldSkip: boolean }> {
  const { data: existing } = await payload.supabase
    .from("virtual_autotrade_runs")
    .select("id")
    .eq("run_type", payload.runType)
    .eq("run_key", payload.runKey)
    .eq("chat_id", payload.chatId)
    .maybeSingle();

  const existingId = Number((existing as Record<string, unknown> | null)?.id ?? 0) || null;
  if (existingId) {
    return { runId: existingId, shouldSkip: true };
  }

  const { data, error } = await payload.supabase
    .from("virtual_autotrade_runs")
    .upsert(
      {
        run_type: payload.runType,
        run_key: payload.runKey,
        chat_id: payload.chatId,
        status: "SKIPPED",
        started_at: new Date().toISOString(),
      },
      { onConflict: "run_type,run_key,chat_id" }
    )
    .select("id")
    .maybeSingle();

  if (error) return { runId: null, shouldSkip: false };
  return {
    runId: Number((data as Record<string, unknown> | null)?.id ?? 0) || null,
    shouldSkip: false,
  };
}

async function finishRun(payload: {
  supabase: SupabaseClientAny;
  runId: number | null;
  status: "SUCCESS" | "SKIPPED" | "FAILED";
  summary: Record<string, unknown>;
}): Promise<void> {
  if (!payload.runId) return;
  await payload.supabase
    .from("virtual_autotrade_runs")
    .update({
      status: payload.status,
      summary: payload.summary,
      finished_at: new Date().toISOString(),
    })
    .eq("id", payload.runId);
}

export async function runVirtualAutoTradingCycle(input?: {
  mode?: RunMode;
  maxUsers?: number;
  dryRun?: boolean;
  intradayOnly?: boolean;
  windowMinutes?: number;
  now?: Date;
}): Promise<AutoTradeRunSummary> {
  const mode = input?.mode ?? "auto";
  // intradayOnly: 수동 버튼 트리거 용 (빠른 응답) → maxUsers 기본값 5
  // 일반 cron: 모든 사용자 처리 → maxUsers 기본값 200
  const defaultMaxUsers = input?.intradayOnly ? 5 : 200;
  const maxUsers = Math.max(1, Math.floor(input?.maxUsers ?? defaultMaxUsers));
  const dryRun = Boolean(input?.dryRun);
  const intradayOnly = Boolean(input?.intradayOnly);
  const now = input?.now ?? new Date();
  const windowMinutes = Math.max(1, Math.floor(input?.windowMinutes ?? 10));
  const apiBudget = createApiBudget(resolveApiBudgetLimit({ intradayOnly }));

  const supabase: SupabaseClientAny = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const runType = selectRunType(mode);
  const runKey = intradayOnly ? kstWindowKey(now, windowMinutes) : kstDateKey(now);

  if (intradayOnly && !isKrxIntradayAutoTradeWindow(now)) {
    return {
      mode,
      runType,
      runKey,
      totalUsers: 0,
      processedUsers: 0,
      buyCount: 0,
      sellCount: 0,
      skippedCount: 0,
      errorCount: 0,
      skipReasonStats: [
        { code: "out_of_session", label: "장중 외 시간 스킵", count: 1 },
      ],
      actions: [],
    };
  }

  const { data: settingsData, error: settingsError } = await supabase
    .from("virtual_autotrade_settings")
    .select(
      "chat_id, is_enabled, monday_buy_slots, max_positions, min_buy_score, take_profit_pct, stop_loss_pct, long_term_ratio, last_long_term_coach_at, last_monday_buy_at, last_daily_review_at, selected_strategy"
    )
    .eq("is_enabled", true)
    .order("chat_id", { ascending: true })
    .limit(maxUsers);

  if (settingsError) {
    throw settingsError;
  }

  const settings = (settingsData ?? []) as AutoTradeSettingRow[];
  const summary: AutoTradeRunSummary = {
    mode,
    runType,
    runKey,
    totalUsers: settings.length,
    processedUsers: 0,
    buyCount: 0,
    sellCount: 0,
    skippedCount: 0,
    errorCount: 0,
    skipReasonStats: [],
    actions: [],
  };

  for (const setting of settings) {
    const lockKey = `${runKey}:${setting.chat_id}`;
    let locked = false;
    let runId: number | null = null;
    try {
      locked = await tryAcquireRunLock(supabase, lockKey).catch((err) => {
        throw err;
      });

      if (!locked) {
        summary.processedUsers += 1;
        summary.skippedCount += 1;
        summary.actions.push({
          chatId: setting.chat_id,
          buys: 0,
          sells: 0,
          skipped: 1,
          errors: 0,
          notes: [`[자동사이클] 동일 실행창(${runKey}) 다른 프로세스가 실행중`],
        });
        continue;
      }

      const runStart = await startRun({
        supabase,
        runType,
        runKey,
        chatId: setting.chat_id,
      });
      runId = runStart.runId;

      if (runStart.shouldSkip) {
        summary.processedUsers += 1;
        summary.skippedCount += 1;
        summary.actions.push({
          chatId: setting.chat_id,
          buys: 0,
          sells: 0,
          skipped: 1,
          errors: 0,
          notes: [`[자동사이클] 동일 실행창(${runKey}) 이미 처리됨`],
        });
        continue;
      }

      const prefs = await getUserInvestmentPrefs(setting.chat_id);
      const userDryRun = dryRun || Boolean(prefs.virtual_shadow_mode);
      const actionSummary = runType === "MONDAY_BUY"
        ? await runMondayBuyForUser({
            supabase,
            setting,
            runId,
            dryRun: userDryRun,
            apiBudget,
          })
        : await runDailyReviewForUser({
            supabase,
            setting,
            runId,
            dryRun: userDryRun,
            apiBudget,
          });

      actionSummary.notes.push(
        `API 예산 사용: ${apiBudget.used}/${apiBudget.limit} (시장개요 ${apiBudget.usageByScope.market_overview}, 실시간시세 ${apiBudget.usageByScope.realtime_price_batch})`
      );

      if (prefs.virtual_shadow_mode) {
        actionSummary.notes.unshift("[SHADOW] 실반영 없이 신호 동시 검증");
      }

      const status = actionSummary.errors > 0
        ? "FAILED"
        : actionSummary.buys + actionSummary.sells > 0
          ? "SUCCESS"
          : "SKIPPED";

      const sellPerf = await getRecentAutoTradeSellPerformance({
        supabase,
        chatId: setting.chat_id,
        windowDays: 45,
      });
      if (sellPerf) {
        const gateStatus = resolveStrategyGateStatus({
          sellCount: sellPerf.sellCount,
          winRate: sellPerf.winRate,
          profitFactor: sellPerf.profitFactor,
          maxLossStreak: sellPerf.maxLossStreak,
          windowDays: sellPerf.windowDays,
        });
        await upsertStrategyGateState({
          supabase,
          chatId: setting.chat_id,
          strategyId: AUTO_TRADE_STRATEGY_ID,
          strategyProfile: setting.selected_strategy ?? null,
          metrics: {
            sellCount: sellPerf.sellCount,
            winRate: sellPerf.winRate,
            profitFactor: sellPerf.profitFactor,
            maxLossStreak: sellPerf.maxLossStreak,
            windowDays: sellPerf.windowDays,
          },
          status: gateStatus,
          meta: {
            mode,
            runType,
            dryRun: userDryRun,
          },
        });
        actionSummary.notes.push(
          `전략게이트: ${toGateLabel(gateStatus)} (PF ${sellPerf.profitFactor != null ? sellPerf.profitFactor.toFixed(2) : "N/A"}, 승률 ${sellPerf.winRate.toFixed(1)}%, 연속손실 ${sellPerf.maxLossStreak}회)`
        );
      }

      await finishRun({
        supabase,
        runId,
        status,
        summary: {
          buys: actionSummary.buys,
          sells: actionSummary.sells,
          skipped: actionSummary.skipped,
          errors: actionSummary.errors,
          notes: actionSummary.notes,
          dryRun: userDryRun,
        },
      });

      const isShadowRun = !userDryRun ? false : Boolean(prefs.virtual_shadow_mode);

      if (!userDryRun) {
        if (runType === "MONDAY_BUY") {
          await supabase
            .from("virtual_autotrade_settings")
            .update({ last_monday_buy_at: new Date().toISOString() })
            .eq("chat_id", setting.chat_id);
        } else {
          await supabase
            .from("virtual_autotrade_settings")
            .update({ last_daily_review_at: new Date().toISOString() })
            .eq("chat_id", setting.chat_id);
        }
      }

      // 실행 알림: 실제 체결 또는 섀도우 모드 체결 시 모두 발송
      {
        const executionAlert = buildAutoTradeExecutionAlert({
          runType,
          action: actionSummary,
          isShadow: isShadowRun,
        });
        if (executionAlert) {
          const holdingSnippet = await buildRealHoldingResponseSnippet({
            supabase,
            chatId: setting.chat_id,
            overweightReducedCodes: actionSummary.overweightReducedCodes,
          }).catch(() => null);
          const combinedAlert = holdingSnippet
            ? `${executionAlert}\n\n${holdingSnippet}`
            : executionAlert;

          await sendMessage(
            setting.chat_id,
            combinedAlert,
            actionButtons(buildAutoTradeExecutionButtons(actionSummary.notes || []))
          ).catch((err: unknown) => {
            console.error("[autoTrade] execution alert send failed", err);
          });
        }
      }

      if (!userDryRun && runType !== "MONDAY_BUY") {
        const coach = await runLongTermCoachForChat({
          supabase,
          chatId: setting.chat_id,
          lastCoachAt: setting.last_long_term_coach_at,
        }).catch(() => null);

        if (coach?.shouldNotify && coach.text) {
          await sendMessage(setting.chat_id, coach.text).catch((err: unknown) => {
            console.error("[autoTrade] long-term coach send failed", err);
          });
          await supabase
            .from("virtual_autotrade_settings")
            .update({ last_long_term_coach_at: new Date().toISOString() })
            .eq("chat_id", setting.chat_id);
        }
      }

      summary.processedUsers += 1;
      summary.buyCount += actionSummary.buys;
      summary.sellCount += actionSummary.sells;
      summary.skippedCount += actionSummary.skipped;
      summary.errorCount += actionSummary.errors;
      summary.actions.push(actionSummary);
    } catch (error: unknown) {
      const message = extractErrorMessage(error);
      await finishRun({
        supabase,
        runId,
        status: "FAILED",
        summary: {
          error: message,
          dryRun,
        },
      });

      summary.processedUsers += 1;
      summary.errorCount += 1;
      summary.actions.push({
        chatId: setting.chat_id,
        buys: 0,
        sells: 0,
        skipped: 0,
        errors: 1,
        notes: [message],
      });
    } finally {
      if (locked) {
        await releaseRunLock(supabase, lockKey).catch(() => null);
      }
    }
  }

  summary.skipReasonStats = buildAutoTradeSkipReasonStats({
    actions: summary.actions,
  });

  return summary;
}

// ---------------------------------------------------------------------------
// 자동매매 진단 리포트
// ---------------------------------------------------------------------------

export type AutoTradeDiagnosticReport = {
  windowDays: number;
  metrics: AutoTradeRecentMetrics | null;
  backtest: {
    months: 3 | 6;
    winRatePct: number;
    profitFactor: number;
    avgWin: number;
    avgLoss: number;
    realizedPnl: number;
    sellTrades: number;
  } | null;
  holdingCount: number;
  availableCash: number;
  marketMode: string;
  marketModeReason: string;
  settings: {
    isEnabled: boolean;
    isShadow: boolean;
    minBuyScore: number;
    stopLossPct: number;
    takeProfitPct: number;
  } | null;
};

export async function generateAutoTradeDiagnosticReport(
  chatId: number
): Promise<AutoTradeDiagnosticReport> {
  const supabase: SupabaseClientAny = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const [metricsResult, settingResp, holdingsResp, backtestResult] = await Promise.all([
    getRecentAutoTradeMetrics({ supabase, chatId, windowDays: 7 }),
    supabase
      .from("virtual_autotrade_settings")
      .select("is_enabled, min_buy_score, stop_loss_pct, take_profit_pct")
      .eq("chat_id", chatId)
      .maybeSingle(),
    supabase
      .from("virtual_positions")
      .select("code, quantity, buy_price, invested_amount")
      .eq("chat_id", chatId)
      .gt("quantity", 0),
    generateAutoTradeBacktestReportForChat({ chatId, months: 3 }).catch(() => null),
  ]);

  const settingRow = settingResp.data as
    | {
        is_enabled?: boolean | null;
        min_buy_score?: number | null;
        stop_loss_pct?: number | null;
        take_profit_pct?: number | null;
      }
    | null
    | undefined;

  const holdings = (holdingsResp.data ?? []) as Array<{
    quantity?: number | null;
    buy_price?: number | null;
    invested_amount?: number | null;
  }>;

  const investedFromHoldings = holdings.reduce((sum, row) => {
    const qty = Math.max(0, Math.floor(toNumber(row.quantity, 0)));
    const buyPrice = Math.max(0, toNumber(row.buy_price, 0));
    const investedAmount = Math.max(0, toNumber(row.invested_amount, 0));
    const fallback = qty > 0 && buyPrice > 0 ? Math.round(qty * buyPrice) : 0;
    return sum + Math.max(investedAmount, fallback);
  }, 0);

  const prefsResult = await supabase
    .from("user_investment_prefs")
    .select("virtual_cash, virtual_seed_capital, capital_krw, virtual_realized_pnl, virtual_shadow_mode")
    .eq("tg_id", chatId)
    .maybeSingle();

  const prefs = (prefsResult.data ?? {}) as Record<string, unknown>;
  const storedCash = toNumber(prefs.virtual_cash, 0);
  const seedCapital = toNumber(prefs.virtual_seed_capital, toNumber(prefs.capital_krw, 0));
  const realizedPnl = toNumber(prefs.virtual_realized_pnl, 0);
  const derivedCash = Math.max(0, Math.round(seedCapital + realizedPnl - investedFromHoldings));
  const availableCash = storedCash > 0 ? storedCash : derivedCash;

  // 시장 레짐 감지
  let marketMode = "balanced";
  let marketModeReason = "";
  try {
    const overview = await fetchAllMarketData().catch(() => null);
    const policy = detectAutoTradeMarketPolicy({ overview });
    marketMode = policy.mode;
    marketModeReason = policy.reason;
  } catch {
    // 시장 데이터 미수신 시 기본값 유지
  }

  return {
    windowDays: 7,
    metrics: metricsResult,
    backtest: backtestResult
      ? {
          months: backtestResult.months,
          winRatePct: backtestResult.winRatePct,
          profitFactor: backtestResult.profitFactor,
          avgWin: backtestResult.avgWin,
          avgLoss: backtestResult.avgLoss,
          realizedPnl: backtestResult.realizedPnl,
          sellTrades: backtestResult.sellTrades,
        }
      : null,
    holdingCount: holdings.length,
    availableCash,
    marketMode,
    marketModeReason,
    settings: settingRow
      ? {
          isEnabled: Boolean(settingRow.is_enabled),
          isShadow: Boolean(prefs.virtual_shadow_mode),
          minBuyScore: toNumber(settingRow.min_buy_score, 60),
          stopLossPct: Math.abs(toNumber(settingRow.stop_loss_pct, 4)),
          takeProfitPct: Math.abs(toNumber(settingRow.take_profit_pct, 8)),
        }
      : null,
  };
}