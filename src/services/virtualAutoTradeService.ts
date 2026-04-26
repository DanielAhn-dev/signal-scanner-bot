import { createClient } from "@supabase/supabase-js";
import { PORTFOLIO_TABLES } from "../db/portfolioSchema";
import {
  applyFifoSale,
  appendTradeLotsForHolding,
  ensureTradeLotsForHolding,
  previewFifoSale,
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
  classifyAutoTradeEntryProfile,
  buildPositionStrategyMemo,
  parsePositionStrategyState,
  planAutoTradeExit,
  resolvePositionBucketFromProfile,
  resolvePositionTradeProfile,
  type PlannedAutoTradeExit,
} from "./virtualAutoTradePositionStrategy";
import {
  applyStrategyBuyConstraint,
  deriveEntryProfile,
  detectAutoTradeMarketPolicy,
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
import { computeAutoTradePacingMetrics } from "./virtualAutoTradePacingService";
import {
  fetchRealtimePriceBatch,
  type RealtimeStockData,
} from "../utils/fetchRealtimePrice";
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
import { upsertStrategyGateState, resolveStrategyGateStatus } from "./strategyGateStateService";

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
};

const AUTO_TRADE_STRATEGY_ID = "core.autotrade.v1";

type SignalTrustThresholds = {
  variant: "A" | "B" | "CUSTOM";
  newBuy: number;
  addOn: number;
  rebalance: number;
};

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

  const lines = [
    `${shadowPrefix}[자동사이클 체결 알림] ${runLabel}`,
    `매수 ${input.action.buys}건 · 매도 ${input.action.sells}건 · 미체결 ${input.action.skipped}건`,
    ...pickExecutionLines(input.action.notes || []).map((line) => `- ${line}`),
    input.isShadow ? "※ 섀도우 모드: 실반영 없음. 실전 전환은 /섀도우 off" : "다음 점검: /보유 · /보유대응",
  ];

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
  candidates: RankedCandidate[]
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

async function appendTradeLog(payload: {
  supabase: SupabaseClientAny;
  chatId: number;
  code: string;
  side: "BUY" | "SELL";
  price: number;
  quantity: number;
  grossAmount: number;
  netAmount: number;
  feeAmount?: number;
  taxAmount?: number;
  pnlAmount?: number;
  memo?: string;
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
      traded_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  return Number((data as Record<string, unknown> | null)?.id ?? 0) || null;
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
  return (data as { asof?: string } | null)?.asof ?? null;
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

  const queryLimit = Math.max(payload.limit, 30);
  const selectWithSignal = [
    "code",
    "total_score",
    "signal",
    "factors",
    "stock:stocks!inner(code, name, close, rsi14, liquidity, market, market_cap, universe_level)",
  ].join(",");
  const selectWithoutSignal = [
    "code",
    "total_score",
    "factors",
    "stock:stocks!inner(code, name, close, rsi14, liquidity, market, market_cap, universe_level)",
  ].join(",");

  const buildQuery = (selectClause: string) => {
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

    rankedRows.push({
      code: row.code,
      close: stock.close,
      score: toNumber(row.total_score, 0),
      name: stock.name || row.code,
      signal: row.signal ?? null,
      rsi14: stock.rsi14 ?? null,
      liquidity: stock.liquidity ?? null,
      market: stock.market ?? null,
      marketCap: stock.marketCap ?? null,
      universeLevel: stock.universeLevel ?? null,
      stableTurn: String(rawFactors.stable_turn ?? "").trim() || null,
      stableTrust: Number.isFinite(Number(rawFactors.stable_turn_trust))
        ? Number(rawFactors.stable_turn_trust)
        : null,
      stableAboveAvg: typeof rawFactors.stable_above_avg === "boolean"
        ? rawFactors.stable_above_avg
        : null,
      stableAccumulation: typeof rawFactors.stable_accumulation === "boolean"
        ? rawFactors.stable_accumulation
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
  minBuyScore: number;
  limit: number;
  heldCodes: Set<string>;
  marketPolicy?: AutoTradeMarketPolicy;
  selectedStrategy?: string | null;
  riskProfile?: string | null;
}): Promise<AutoTradeCandidateSelectionResult> {
  const { rows: rankedRows, latestAsof } = await fetchLatestRankedRows({
    supabase: payload.supabase,
    limit: Math.max(payload.limit * 20, 300),
  });
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

  const entryProfile = deriveEntryProfile({
    selectedStrategy: payload.selectedStrategy,
    riskProfile: payload.riskProfile,
  });
  const pullbackCandidateCodes =
    entryProfile === "pullback-first"
      ? await fetchLatestPullbackCandidateCodes({
          supabase: payload.supabase,
          limit: Math.max(payload.limit * 4, 20),
        })
      : undefined;

  const selection = pickAutoTradeCandidates({
    rows: rankedRows,
    preferredMinBuyScore: payload.minBuyScore,
    limit: payload.limit,
    heldCodes: payload.heldCodes,
    marketPolicy: payload.marketPolicy,
    entryProfile,
    pullbackCandidateCodes,
  });

  return {
    ...selection,
    latestAsof,
  };
}

async function runMondayBuyForUser(payload: {
  supabase: SupabaseClientAny;
  setting: AutoTradeSettingRow;
  runId: number | null;
  dryRun: boolean;
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
  const signalTrustThresholds = resolveSignalTrustThresholdsFromPrefs(prefs);

  const { data: holdingRows, error: holdingError } = await payload.supabase
    .from(PORTFOLIO_TABLES.positionsLegacy)
    .select("id, code, status")
    .eq("chat_id", chatId);

  if (holdingError) {
    summary.errors += 1;
    summary.notes.push(`보유 조회 실패: ${holdingError.message}`);
    await writeActionLog({
      supabase: payload.supabase,
      runId: payload.runId,
      chatId,
      actionType: "ERROR",
      reason: "holdings-fetch-failed",
      detail: { error: holdingError.message },
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

  const marketOverview = await fetchAllMarketData().catch(() => null);
  const marketPolicy = detectAutoTradeMarketPolicy({ overview: marketOverview });
  let deployableCash = resolveDeployableCash({
    availableCash,
    seedCapital,
    minCashReservePct: marketPolicy.minCashReservePct,
  });
  summary.notes.push(
    `시장모드: ${marketPolicy.label} · ${marketPolicy.reason} · 최소현금 ${marketPolicy.minCashReservePct}% 유지`
  );

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

  const perfGuardForMonday = applyPerformanceBuyGuard({
    requestedSlots: rawRemainSlots,
    baseMinBuyScore: toPositiveInt(payload.setting.min_buy_score, 72),
    perf: mondaySellPerf,
  });

  const buyConstraint = applyStrategyBuyConstraint({
    selectedStrategy,
    requestedSlots: perfGuardForMonday.requestedSlots,
    baseMinBuyScore: perfGuardForMonday.baseMinBuyScore,
    activeCount,
    pacingRelaxLevel: pacingMetrics.relaxLevel,
  });

  if (perfGuardForMonday.note) {
    summary.notes.push(perfGuardForMonday.note);
  }

  if (pacingMetrics.relaxLevel > 0) {
    summary.notes.push(`페이싱 보정: 기준점수 완화 레벨 ${pacingMetrics.relaxLevel}`);
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

  const candidateSelection = await selectMondayCandidates({
    supabase: payload.supabase,
    minBuyScore: buyConstraint.minBuyScore,
    limit: resolveCandidateProbeLimit(remainSlots),
    heldCodes,
    marketPolicy,
    selectedStrategy,
    riskProfile: prefs.risk_profile ?? null,
  });
  const candidates = candidateSelection.candidates;
  const buyPriceResolution = await resolveBuyExecutionPrices(candidates);
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
    summary.notes.push(
      buyPriceResolution.realtimeAppliedCount > 0
        ? `매수가 기준: 장중 실시간가 우선 (${buyPriceResolution.realtimeAppliedCount}/${candidates.length}종목 반영)`
        : "매수가 기준: 장중 실시간가 조회 실패로 종가 기준 적용"
    );
  } else {
    summary.notes.push("매수가 기준: 장마감 이후 종가 기준 적용");
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
      const signalGate = evaluateAutoTradeSignalGate({
        currentPrice: executionPrice,
        score: candidate.score,
        factors: extractScoreFactors(scoreRow?.factors),
        minTrustScore: signalTrustThresholds.newBuy,
        requireAboveSma200: true,
      });

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
      const candidateProfile = classifyAutoTradeEntryProfile({
        accountStrategy: selectedStrategy,
        riskProfile: prefs.risk_profile,
        candidate,
      });
      const tradeProfile = resolvePositionTradeProfile({
        accountStrategy: candidateProfile,
        baseTakeProfitPct: Math.abs(toNumber(payload.setting.take_profit_pct, 8)),
        baseStopLossPct: Math.abs(toNumber(payload.setting.stop_loss_pct, 4)),
        sellSplitCount: Math.max(1, Math.min(4, toPositiveInt(prefs.virtual_sell_split_count, 2))),
      });
      const profileLabel = getStrategyLabel(tradeProfile.profile) || tradeProfile.profile;
      if (qty <= 0 || investedAmount <= 0) {
        summary.skipped += 1;
        insufficientCashCount += 1;
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
        const targetPrice = Math.round(executionPrice * (1 + Math.abs(toNumber(payload.setting.take_profit_pct, 8)) / 100));
        const expectedPnl = Math.max(0, Math.round((targetPrice - executionPrice) * qty));
        summary.buys += 1;
        summary.notes.push(
          `[테스트 매수안] ${candidate.name}(${candidate.code}) ${qty}주 · 전략 ${profileLabel} · 매수가 ${fmtKrw(executionPrice)} · 투입 ${fmtKrw(investedAmount)} · 목표가 ${fmtKrw(targetPrice)} · 기대수익 ${fmtKrw(expectedPnl)} (${Math.abs(toNumber(payload.setting.take_profit_pct, 8)).toFixed(1)}%) · ${formatPriceSourceLabel(executionSource)}`
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

      const { data: upserted, error: upsertError } = await payload.supabase
        .from(PORTFOLIO_TABLES.positionsLegacy)
        .upsert(
          {
            chat_id: chatId,
            code: candidate.code,
            buy_price: executionPrice,
            buy_date: new Date().toISOString().slice(0, 10),
            quantity: qty,
            invested_amount: investedAmount,
            bucket: resolvePositionBucketFromProfile(tradeProfile.profile),
            status: "holding",
            memo: buildPositionStrategyMemo({
              event: "monday-buy",
              note: "autotrade-monday-buy",
              profile: tradeProfile.profile,
              takeProfitTranchesDone: 0,
            }),
          },
          { onConflict: "chat_id,code", ignoreDuplicates: true }
        )
        .select("id, created_at, buy_date")
        .maybeSingle();

      if (upsertError) {
        throw upsertError;
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

      summary.buys += 1;
      plannedHoldingCount += 1;
      availableCash = Math.max(0, availableCash - investedAmount);
      deployableCash = Math.max(0, deployableCash - investedAmount);
      summary.notes.push(
        `[실행 매수] ${candidate.name}(${candidate.code}) ${qty}주 · 전략 ${profileLabel} · 매수가 ${fmtKrw(executionPrice)} · 투입 ${fmtKrw(investedAmount)} · 점수 ${candidate.score.toFixed(1)} · ${formatPriceSourceLabel(executionSource)}`
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
      const message = error instanceof Error ? error.message : String(error);
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

  const fifo = await previewFifoSale({
    chatId: payload.chatId,
    code: payload.holding.code,
    quantity: sellQty,
  });
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
      .from(PORTFOLIO_TABLES.positionsLegacy)
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
      .from(PORTFOLIO_TABLES.positionsLegacy)
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
  });

  await applyFifoSale({
    chatId: payload.chatId,
    code: payload.holding.code,
    exitPrice: payload.close,
    tradeId,
    allocations: fifo.allocations,
  });

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
}): Promise<AutoTradeActionSummary> {
  const chatId = payload.setting.chat_id;
  const prefs = await getUserInvestmentPrefs(chatId);
  const signalTrustThresholds = resolveSignalTrustThresholdsFromPrefs(prefs);
  const summary: AutoTradeActionSummary = {
    chatId,
    buys: 0,
    sells: 0,
    skipped: 0,
    errors: 0,
    notes: [],
  };

  // 적용된 전략 기록
  const selectedStrategy = payload.setting.selected_strategy;
  const dailySellPerf = await getRecentAutoTradeSellPerformance({
    supabase: payload.supabase,
    chatId,
    windowDays: 45,
  });

  const perfGuard = applyPerformanceBuyGuard({
    requestedSlots: toPositiveInt(payload.setting.monday_buy_slots, 2),
    baseMinBuyScore: toPositiveInt(payload.setting.min_buy_score, 72),
    perf: dailySellPerf,
  });
  if (perfGuard.note) {
    summary.notes.push(perfGuard.note);
  }
  if (selectedStrategy) {
    summary.notes.push(`기본 전략: ${getStrategyLabel(selectedStrategy) || selectedStrategy}`);
  }
  summary.notes.push(
    `신뢰도 임계값(${signalTrustThresholds.variant}): 신규 ${signalTrustThresholds.newBuy} · 추가 ${signalTrustThresholds.addOn} · 리밸런싱 ${signalTrustThresholds.rebalance}`
  );

  const { data: holdingsData, error: holdingsError } = await payload.supabase
    .from(PORTFOLIO_TABLES.positionsLegacy)
    .select("id, code, buy_price, buy_date, created_at, quantity, invested_amount, status, memo")
    .eq("chat_id", chatId)
    .eq("status", "holding");

  if (holdingsError) {
    summary.errors += 1;
    summary.notes.push(`보유 조회 실패: ${holdingsError.message}`);
    await writeActionLog({
      supabase: payload.supabase,
      runId: payload.runId,
      chatId,
      actionType: "ERROR",
      reason: "daily-holdings-fetch-failed",
      detail: { error: holdingsError.message },
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
  const baseStopLossPct = Math.abs(toNumber(payload.setting.stop_loss_pct, 4));
  const baseTakeProfitPct = Math.abs(toNumber(payload.setting.take_profit_pct, 8));
  const sellSplitCount = Math.max(1, Math.min(4, toPositiveInt(prefs.virtual_sell_split_count, 2)));

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
  const marketOverview = await fetchAllMarketData().catch(() => null);
  const marketPolicy = detectAutoTradeMarketPolicy({ overview: marketOverview });
  let deployableCash = resolveDeployableCash({
    availableCash,
    seedCapital,
    minCashReservePct: marketPolicy.minCashReservePct,
  });
  summary.notes.push(
    `시장모드: ${marketPolicy.label} · ${marketPolicy.reason} · 최소현금 ${marketPolicy.minCashReservePct}% 유지`
  );
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
    const baseExitPlan = planAutoTradeExit({
      quantity: qty,
      pnlPct,
      takeProfitPct: tradeProfile.takeProfitPct,
      stopLossPct: tradeProfile.stopLossPct,
      takeProfitSplitCount: tradeProfile.takeProfitSplitCount,
      takeProfitTranchesDone: strategyState.takeProfitTranchesDone,
    });
    const holdingScoreRow = holdingFactorsByCode.get(holding.code);
    const holdingSignal = holdingScoreRow?.signal ?? null;
    const holdingMarket = marketByCode.get(holding.code) ?? "";
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
    });
    const exitPlan: PlannedAutoTradeExit =
      regimeEarlyExit && trendExitSignal.exitAction === "HOLD"
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

    if (exitPlan.action === "HOLD") {
      holdCount += 1;
      await writeActionLog({
        supabase: payload.supabase,
        runId: payload.runId,
        chatId,
        code: holding.code,
        actionType: "HOLD",
        reason: "within-range",
        detail: {
          strategyProfile: tradeProfile.profile,
          takeProfitPct: tradeProfile.takeProfitPct,
          stopLossPct: tradeProfile.stopLossPct,
          buyPrice,
          close,
          pnlPct: Number(pnlPct.toFixed(2)),
          signal: holdingSignal,
          market: holdingMarket,
          marketMode: marketPolicy.mode,
        },
      });
      continue;
    }

    // 매도 이유 노트 (signal/regime 기반이면 명시)
    const exitReasonLabel: string = (() => {
      if (trendExitSignal.reason === "signal-strong-sell") return "[신호청산] STRONG_SELL 전환";
      if (trendExitSignal.reason === "signal-sell") return "[신호익절] SELL 전환 + 수익 중";
      if (trendExitSignal.reason === "trend-break-sma200") return "[추세이탈] SMA200 하향이탈";
      if (trendExitSignal.reason === "trend-break-sma50") return "[추세익절] SMA50 하향이탈";
      if (regimeEarlyExit) return "[레짐익절] 방어모드 KOSDAQ 선익절";
      return "";
    })();

    try {
      const result = await executeAutoTradeSell({
        supabase: payload.supabase,
        runId: payload.runId,
        chatId,
        holding,
        close,
        buyPrice,
        feeRate,
        taxRate,
        sellQty: exitPlan.quantityToSell,
        reason: exitPlan.reason,
        profileLabel: getStrategyLabel(tradeProfile.profile) || tradeProfile.profile,
        strategyProfile: tradeProfile.profile,
        takeProfitTranchesDone: strategyState.takeProfitTranchesDone,
        nextTakeProfitTranchesDone: exitPlan.nextTakeProfitTranchesDone,
        dryRun: payload.dryRun,
      });

      if (!result.sold) {
        holdCount += 1;
        continue;
      }

      realizedDelta += result.realizedPnlDelta;
      availableCash += result.proceeds;
      if (exitPlan.action === "STOP_LOSS") {
        stopLossCount += 1;
      } else {
        takeProfitCount += 1;
      }
      summary.sells += 1;
      summary.notes.push(`${result.note} · 손익률 ${pnlPct.toFixed(2)}%`);
      if (exitReasonLabel) {
        summary.notes.push(exitReasonLabel);
      } else if (trendExitSignal.reason !== "none") {
        summary.notes.push(`[추세이탈 청산] ${holding.code} · ${trendExitSignal.reason}`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
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
    summary.notes.push(
      `보유 종목 ${holdCount}건은 기본 익절 ${baseTakeProfitPct.toFixed(1)}% / 손절 ${baseStopLossPct.toFixed(1)}% 범위 내에서 유지`
    );
  }

  // 매도 이후 재조회 기준으로 추가매수/신규 매수 후보를 판단한다.
  const { data: postHoldings, error: postHoldingsError } = await payload.supabase
    .from(PORTFOLIO_TABLES.positionsLegacy)
    .select("id, code, status, quantity, buy_price, invested_amount, created_at, buy_date, memo")
    .eq("chat_id", chatId);

  if (postHoldingsError) {
    summary.errors += 1;
    summary.notes.push(`매도 후 보유 재조회 실패: ${postHoldingsError.message}`);
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
    const addOnConstraint = applyStrategyBuyConstraint({
      selectedStrategy: payload.setting.selected_strategy,
      requestedSlots: perfGuard.requestedSlots,
      baseMinBuyScore: perfGuard.baseMinBuyScore,
      activeCount: currentCount,
    });

    if (!dailyBuyBlocked && availableCash > 0 && addOnConstraint.buySlots > 0 && activeHoldings.length > 0) {
      const addOnSelection = await selectDailyAddOnCandidates({
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

      const addOnBuyPriceResolution = await resolveBuyExecutionPrices(addOnSelection.candidates);
      const addOnScoreSnapshot = addOnSelection.candidates.length
        ? await fetchLatestScoresByCodes(
            payload.supabase,
            addOnSelection.candidates.map((candidate) => candidate.code)
          ).catch(() => null)
        : null;
      const addOnFactorsByCode = addOnScoreSnapshot?.byCode ?? new Map();

      if (addOnSelection.candidates.length > 0) {
        if (addOnBuyPriceResolution.marketPhase === "intraday") {
          summary.notes.push(
            addOnBuyPriceResolution.realtimeAppliedCount > 0
              ? `추가매수 매수가 기준: 장중 실시간가 우선 (${addOnBuyPriceResolution.realtimeAppliedCount}/${addOnSelection.candidates.length}종목 반영)`
              : "추가매수 매수가 기준: 장중 실시간가 조회 실패로 종가 기준 적용"
          );
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

        try {
          if (payload.dryRun) {
            addOnBuyCount += 1;
            summary.buys += 1;
            summary.notes.push(
              `[테스트 추가매수안] ${candidate.name}(${candidate.code}) +${addOnQty}주 · 총 ${nextQty}주 · 평균단가 ${fmtKrw(nextBuyPrice)} · 투입 ${fmtKrw(addOnInvested)} · ${formatPriceSourceLabel(executionSource)}`
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

          const { error: updateError } = await payload.supabase
            .from(PORTFOLIO_TABLES.positionsLegacy)
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
          });

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
            `[실행 추가매수] ${candidate.name}(${candidate.code}) +${addOnQty}주 · 총 ${nextQty}주 · 평균단가 ${fmtKrw(nextBuyPrice)} · 투입 ${fmtKrw(addOnInvested)} · 점수 ${candidate.score.toFixed(1)} · ${formatPriceSourceLabel(executionSource)}`
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
          const message = error instanceof Error ? error.message : String(error);
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
    const rawBuySlots = Math.min(room, maxNewBuysPerRun);
    const perfAdjustedRebalance = applyPerformanceBuyGuard({
      requestedSlots: rawBuySlots,
      baseMinBuyScore: toPositiveInt(payload.setting.min_buy_score, 72),
      perf: dailySellPerf,
    });
    const buyConstraint = applyStrategyBuyConstraint({
      selectedStrategy: payload.setting.selected_strategy,
      requestedSlots: perfAdjustedRebalance.requestedSlots,
      baseMinBuyScore: perfAdjustedRebalance.baseMinBuyScore,
      activeCount: currentCount,
    });

    if (perfAdjustedRebalance.note) {
      summary.notes.push(perfAdjustedRebalance.note);
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
      const candidateSelection = await selectMondayCandidates({
        supabase: payload.supabase,
        minBuyScore: buyConstraint.minBuyScore,
        limit: resolveCandidateProbeLimit(buySlots),
        heldCodes,
        marketPolicy,
      });
      const candidates = candidateSelection.candidates;
      const rebalanceBuyPriceResolution = await resolveBuyExecutionPrices(candidates);
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
          summary.notes.push(
            rebalanceBuyPriceResolution.realtimeAppliedCount > 0
              ? `신규매수 매수가 기준: 장중 실시간가 우선 (${rebalanceBuyPriceResolution.realtimeAppliedCount}/${candidates.length}종목 반영)`
              : "신규매수 매수가 기준: 장중 실시간가 조회 실패로 종가 기준 적용"
          );
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

        const candidateProfile = classifyAutoTradeEntryProfile({
          accountStrategy: payload.setting.selected_strategy,
          riskProfile: prefs.risk_profile,
          candidate,
        });
        const entryProfile = resolvePositionTradeProfile({
          accountStrategy: candidateProfile,
          baseTakeProfitPct,
          baseStopLossPct,
          sellSplitCount,
        });
        const profileLabel = getStrategyLabel(entryProfile.profile) || entryProfile.profile;
        const executionEntry = rebalanceBuyPriceResolution.priceByCode.get(candidate.code);
        const executionPrice = executionEntry?.price ?? candidate.close;
        const executionSource = executionEntry?.source ?? "close";
        const scoreRow = rebalanceFactorsByCode.get(candidate.code);
        const signalGate = evaluateAutoTradeSignalGate({
          currentPrice: executionPrice,
          score: candidate.score,
          factors: extractScoreFactors(scoreRow?.factors),
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
          stopLossPct: entryProfile.stopLossPct,
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

        try {
          if (payload.dryRun) {
            const targetPct = Math.abs(toNumber(payload.setting.take_profit_pct, 8));
            const targetPrice = Math.round(executionPrice * (1 + targetPct / 100));
            const expectedPnl = Math.max(0, Math.round((targetPrice - executionPrice) * qty));
            rebalanceBuyCount += 1;
            summary.buys += 1;
            summary.notes.push(
              `[테스트 매수안] ${candidate.name}(${candidate.code}) ${qty}주 · 전략 ${profileLabel} · 매수가 ${fmtKrw(executionPrice)} · 목표가 ${fmtKrw(targetPrice)} · 기대수익 ${fmtKrw(expectedPnl)} (${targetPct.toFixed(1)}%) · ${formatPriceSourceLabel(executionSource)}`
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
              reason: "dry-run-rebalance-buy",
              detail: {
                qty,
                price: executionPrice,
                priceSource: executionSource,
                investedAmount,
                totalBudget: sizing.totalBudget,
                splitCount: sizing.splitCount,
                score: candidate.score,
                strategyProfile: entryProfile.profile,
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

          const { data: upserted, error: upsertError } = await payload.supabase
            .from(PORTFOLIO_TABLES.positionsLegacy)
            .upsert(
              {
                chat_id: chatId,
                code: candidate.code,
                buy_price: executionPrice,
                buy_date: new Date().toISOString().slice(0, 10),
                quantity: qty,
                invested_amount: investedAmount,
                bucket: resolvePositionBucketFromProfile(entryProfile.profile),
                memo: buildPositionStrategyMemo({
                  event: "rebalance-buy",
                  note: "autotrade-rebalance-buy",
                  profile: entryProfile.profile,
                  takeProfitTranchesDone: 0,
                }),
                status: "holding",
              },
              { onConflict: "chat_id,code", ignoreDuplicates: true }
            )
            .select("id, created_at, buy_date")
            .maybeSingle();

          if (upsertError) {
            throw upsertError;
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
            `[실행 매수] ${candidate.name}(${candidate.code}) ${qty}주 · 전략 ${profileLabel} · 매수가 ${fmtKrw(executionPrice)} · 투입 ${fmtKrw(investedAmount)} · 점수 ${candidate.score.toFixed(1)} · ${formatPriceSourceLabel(executionSource)}`
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
          const message = error instanceof Error ? error.message : String(error);
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

  return summary;
}

function buildDefaultSettingForChat(chatId: number, riskProfile?: "safe" | "balanced" | "active"): AutoTradeSettingRow {
  if (riskProfile === "active") {
    return {
      chat_id: chatId,
      is_enabled: true,
      monday_buy_slots: 3,
      max_positions: 12,
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
      max_positions: 10,
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
    max_positions: 8,
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
  const maxUsers = Math.max(1, Math.floor(input?.maxUsers ?? 200));
  const dryRun = Boolean(input?.dryRun);
  const intradayOnly = Boolean(input?.intradayOnly);
  const now = input?.now ?? new Date();
  const windowMinutes = Math.max(1, Math.floor(input?.windowMinutes ?? 10));

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
    const runStart = await startRun({
      supabase,
      runType,
      runKey,
      chatId: setting.chat_id,
    });
    const runId = runStart.runId;

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

    try {
      const prefs = await getUserInvestmentPrefs(setting.chat_id);
      const userDryRun = dryRun || Boolean(prefs.virtual_shadow_mode);
      const actionSummary = runType === "MONDAY_BUY"
        ? await runMondayBuyForUser({
            supabase,
            setting,
            runId,
            dryRun: userDryRun,
          })
        : await runDailyReviewForUser({
            supabase,
            setting,
            runId,
            dryRun: userDryRun,
          });

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
          await sendMessage(
            setting.chat_id,
            executionAlert,
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
      const message = error instanceof Error ? error.message : String(error);
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

