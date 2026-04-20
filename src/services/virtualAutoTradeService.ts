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
import { appendVirtualDecisionLog } from "./decisionLogService";
import { calculateAutoTradeBuySizing } from "./virtualAutoTradeSizing";
import {
  applyStrategyBuyConstraint,
  pickAutoTradeAddOnCandidates,
  pickAutoTradeCandidates,
  selectRunType,
  type AutoTradeCandidateSelectionResult,
  type AutoTradeRunMode as SelectionAutoTradeRunMode,
  type AutoTradeRunType,
  type RankedCandidate,
} from "./virtualAutoTradeSelection";

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
  last_monday_buy_at?: string | null;
  last_daily_review_at?: string | null;
  selected_strategy?: string | null;
};

const AUTO_TRADE_STRATEGY_ID = "core.autotrade.v1";

export type AutoTradeRunMode = SelectionAutoTradeRunMode;

export type ChatAutoTradeRunSummary = {
  mode: RunMode;
  runType: RunType;
  runKey: string;
  dryRun: boolean;
  action: AutoTradeActionSummary;
};

type HoldingRow = {
  id: number;
  code: string;
  buy_price: number | null;
  buy_date?: string | null;
  created_at?: string | null;
  quantity: number | null;
  invested_amount: number | null;
  status?: string | null;
};

type ScoreCandidateRow = {
  code: string;
  total_score: number | null;
  signal?: string | null;
  stock: {
    code: string;
    name: string | null;
    close: number | null;
  } | Array<{
    code: string;
    name: string | null;
    close: number | null;
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

function fmtKrw(value: number): string {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function kstDateKey(base = new Date()): string {
  const d = new Date(base.getTime() + 9 * 60 * 60 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normalizeStock(input: ScoreCandidateRow["stock"]): {
  name: string;
  close: number;
} | null {
  const row = Array.isArray(input) ? input[0] : input;
  if (!row) return null;
  const close = toNumber(row.close, 0);
  if (close <= 0) return null;
  return {
    name: String(row.name ?? ""),
    close,
  };
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
    "stock:stocks!inner(code, name, close)",
  ].join(",");
  const selectWithoutSignal = [
    "code",
    "total_score",
    "stock:stocks!inner(code, name, close)",
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

    rankedRows.push({
      code: row.code,
      close: stock.close,
      score: toNumber(row.total_score, 0),
      name: stock.name || row.code,
      signal: row.signal ?? null,
    });
  }

  return { rows: rankedRows, latestAsof };
}

async function selectDailyAddOnCandidates(payload: {
  supabase: SupabaseClientAny;
  holdings: HoldingRow[];
  limit: number;
  minBuyScore: number;
}): Promise<AutoTradeCandidateSelectionResult> {
  const codes = payload.holdings.map((holding) => holding.code).filter(Boolean);
  const { rows, latestAsof } = await fetchLatestRankedRows({
    supabase: payload.supabase,
    limit: Math.max(payload.limit * 5, codes.length || 1),
    codes,
  });

  const holdingsByCode = new Map(
    payload.holdings.map((holding) => [
      holding.code,
      { code: holding.code, buyPrice: toNumber(holding.buy_price, 0) },
    ])
  );

  const selection = pickAutoTradeAddOnCandidates({
    rows,
    preferredMinBuyScore: payload.minBuyScore,
    limit: payload.limit,
    holdingsByCode,
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
}): Promise<AutoTradeCandidateSelectionResult> {
  const { rows: rankedRows, latestAsof } = await fetchLatestRankedRows({
    supabase: payload.supabase,
    limit: Math.max(payload.limit * 10, 30),
  });
  if (!latestAsof) {
    return {
      candidates: [],
      selectionMode: "none",
      thresholdUsed: toPositiveInt(payload.minBuyScore, 70),
      latestTopScore: 0,
      latestAsof: null,
    };
  }

  const selection = pickAutoTradeCandidates({
    rows: rankedRows,
    preferredMinBuyScore: payload.minBuyScore,
    limit: payload.limit,
    heldCodes: payload.heldCodes,
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
    const strategyLabels: Record<string, string> = {
      HOLD_SAFE: "안전 포지션",
      REDUCE_TIGHT: "타이트 손절",
      WAIT_AND_DIP_BUY: "매수 기회 대기",
    };
    summary.notes.push(`전략: ${strategyLabels[selectedStrategy] || selectedStrategy}`);
  }

  const activeCount = heldCodes.size;
  const maxPositions = toPositiveInt(payload.setting.max_positions, 10);
  const rawRemainSlots = Math.max(0, Math.min(toPositiveInt(payload.setting.monday_buy_slots, 2), maxPositions - activeCount));
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

  const buyConstraint = applyStrategyBuyConstraint({
    selectedStrategy,
    requestedSlots: rawRemainSlots,
    baseMinBuyScore: toPositiveInt(payload.setting.min_buy_score, 72),
    activeCount,
  });
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

  const candidateSelection = await selectMondayCandidates({
    supabase: payload.supabase,
    minBuyScore: buyConstraint.minBuyScore,
    limit: remainSlots,
    heldCodes,
  });
  const candidates = candidateSelection.candidates;

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
      },
    });
    return summary;
  }

  let plannedHoldingCount = activeCount;
  let sizingNoteAdded = false;
  let slotsLeft = remainSlots;

  for (const candidate of candidates) {
    if (slotsLeft <= 0) break;

    try {
      const sizing = calculateAutoTradeBuySizing({
        availableCash,
        price: candidate.close,
        slotsLeft,
        currentHoldingCount: plannedHoldingCount,
        maxPositions,
        stopLossPct: Math.abs(toNumber(payload.setting.stop_loss_pct, 4)),
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
      const investedAmount = sizing.investedAmount;
      if (qty <= 0 || investedAmount <= 0) {
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
            price: candidate.close,
          },
        });
        slotsLeft -= 1;
        continue;
      }

      if (payload.dryRun) {
        const targetPrice = Math.round(candidate.close * (1 + Math.abs(toNumber(payload.setting.take_profit_pct, 8)) / 100));
        const expectedPnl = Math.max(0, Math.round((targetPrice - candidate.close) * qty));
        summary.buys += 1;
        summary.notes.push(
          `[테스트 매수안] ${candidate.name}(${candidate.code}) ${qty}주 · 매수가 ${fmtKrw(candidate.close)} · 투입 ${fmtKrw(investedAmount)} · 목표가 ${fmtKrw(targetPrice)} · 기대수익 ${fmtKrw(expectedPnl)} (${Math.abs(toNumber(payload.setting.take_profit_pct, 8)).toFixed(1)}%)`
        );
        await writeActionLog({
          supabase: payload.supabase,
          runId: payload.runId,
          chatId,
          code: candidate.code,
          actionType: "BUY",
          reason: "dry-run-monday-buy",
          detail: {
            price: candidate.close,
            score: candidate.score,
            quantity: qty,
            investedAmount,
            totalBudget: sizing.totalBudget,
            splitCount: sizing.splitCount,
            targetPrice,
            expectedPnl,
          },
        });
        plannedHoldingCount += 1;
        availableCash = Math.max(0, availableCash - investedAmount);
        slotsLeft -= 1;
        continue;
      }

      const { data: upserted, error: upsertError } = await payload.supabase
        .from(PORTFOLIO_TABLES.positionsLegacy)
        .upsert(
          {
            chat_id: chatId,
            code: candidate.code,
            buy_price: candidate.close,
            buy_date: new Date().toISOString().slice(0, 10),
            quantity: qty,
            invested_amount: investedAmount,
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
        price: candidate.close,
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
          buyPrice: candidate.close,
          acquiredAt: String((upserted as Record<string, unknown> | null)?.created_at ?? "") || null,
          buyDate: String((upserted as Record<string, unknown> | null)?.buy_date ?? "") || null,
        });
      }

      summary.buys += 1;
      plannedHoldingCount += 1;
      availableCash = Math.max(0, availableCash - investedAmount);
      summary.notes.push(
        `[실행 매수] ${candidate.name}(${candidate.code}) ${qty}주 · 매수가 ${fmtKrw(candidate.close)} · 투입 ${fmtKrw(investedAmount)} · 점수 ${candidate.score.toFixed(1)}`
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
          price: candidate.close,
          qty,
          investedAmount,
          totalBudget: sizing.totalBudget,
          splitCount: sizing.splitCount,
          tradeId,
          cashAfter: availableCash,
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
        expectedHorizonDays: 5,
        reasonSummary: `자동 월요일 매수 (점수 ${candidate.score.toFixed(1)})`,
        reasonDetails: { score: candidate.score, price: candidate.close, qty, investedAmount, totalBudget: sizing.totalBudget, splitCount: sizing.splitCount, trigger: "monday-score-candidate" },
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

  if (!payload.dryRun) {
    await setUserInvestmentPrefs(chatId, {
      virtual_seed_capital: seedCapital,
      virtual_cash: Math.max(0, Math.round(availableCash)),
    });
    await syncVirtualPortfolio(chatId, chatId);
  }

  return summary;
}

async function runDailyReviewForUser(payload: {
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

  // 적용된 전략 기록
  const selectedStrategy = payload.setting.selected_strategy;
  if (selectedStrategy) {
    const strategyLabels: Record<string, string> = {
      HOLD_SAFE: "안전 포지셀",
      REDUCE_TIGHT: "타이트 손절",
      WAIT_AND_DIP_BUY: "매수 기회 대기",
    };
    summary.notes.push(`전략: ${strategyLabels[selectedStrategy] || selectedStrategy}`);
  }

  const { data: holdingsData, error: holdingsError } = await payload.supabase
    .from(PORTFOLIO_TABLES.positionsLegacy)
    .select("id, code, buy_price, buy_date, created_at, quantity, invested_amount, status")
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
  const { data: stockRows, error: stockError } = await payload.supabase
    .from("stocks")
    .select("code, close")
    .in("code", codeList);

  if (stockError) {
    summary.errors += 1;
    summary.notes.push(`시세 조회 실패: ${stockError.message}`);
    return summary;
  }

  const closeByCode = new Map<string, number>();
  for (const row of stockRows ?? []) {
    const code = String((row as Record<string, unknown>).code ?? "");
    const close = toNumber((row as Record<string, unknown>).close, 0);
    if (code && close > 0) closeByCode.set(code, close);
  }

  const prefs = await getUserInvestmentPrefs(chatId);
  const feeRate = toNumber(prefs.virtual_fee_rate, 0.00015);
  const taxRate = toNumber(prefs.virtual_tax_rate, 0.0018);
  let stopLossPct = Math.abs(toNumber(payload.setting.stop_loss_pct, 4));
  let takeProfitPct = Math.abs(toNumber(payload.setting.take_profit_pct, 8));

  // 선택된 전략에 따라 손절/익절 조정
  if (selectedStrategy === "REDUCE_TIGHT") {
    stopLossPct = 2;
    takeProfitPct = 4;
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

    const pnlPct = ((close - buyPrice) / buyPrice) * 100;
    const shouldTakeProfit = pnlPct >= takeProfitPct;
    const shouldStopLoss = pnlPct <= -stopLossPct;

    if (!shouldTakeProfit && !shouldStopLoss) {
      holdCount += 1;
      await writeActionLog({
        supabase: payload.supabase,
        runId: payload.runId,
        chatId,
        code: holding.code,
        actionType: "HOLD",
        reason: "within-range",
        detail: {
          buyPrice,
          close,
          pnlPct: Number(pnlPct.toFixed(2)),
        },
      });
      continue;
    }

    const gross = Math.round(close * qty);
    const feeAmount = Math.round(gross * feeRate);
    const taxAmount = Math.round(gross * taxRate);
    const net = Math.max(0, gross - feeAmount - taxAmount);

    try {
      if (payload.dryRun) {
        if (shouldTakeProfit) takeProfitCount += 1;
        else if (shouldStopLoss) stopLossCount += 1;
        summary.sells += 1;
        await writeActionLog({
          supabase: payload.supabase,
          runId: payload.runId,
          chatId,
          code: holding.code,
          actionType: "SELL",
          reason: shouldTakeProfit ? "dry-run-take-profit" : "dry-run-stop-loss",
          detail: { qty, buyPrice, close, pnlPct: Number(pnlPct.toFixed(2)) },
        });
        continue;
      }

      await ensureTradeLotsForHolding({
        chatId,
        watchlistId: holding.id,
        code: holding.code,
        quantity: qty,
        investedAmount: holding.invested_amount,
        buyPrice,
        acquiredAt: holding.created_at,
        buyDate: holding.buy_date,
      });

      const fifo = await previewFifoSale({
        chatId,
        code: holding.code,
        quantity: qty,
      });

      const pnl = net - fifo.totalCost;
      realizedDelta += pnl;
      availableCash += net;

      const tradeId = await appendTradeLog({
        supabase: payload.supabase,
        chatId,
        code: holding.code,
        side: "SELL",
        price: close,
        quantity: qty,
        grossAmount: gross,
        netAmount: net,
        feeAmount,
        taxAmount,
        pnlAmount: pnl,
        memo: buildStrategyMemo({
          strategyId: AUTO_TRADE_STRATEGY_ID,
          event: shouldTakeProfit ? "daily-take-profit" : "daily-stop-loss",
          note: shouldTakeProfit ? "autotrade-take-profit" : "autotrade-stop-loss",
        }),
      });

      const { error: deleteError } = await payload.supabase
        .from(PORTFOLIO_TABLES.positionsLegacy)
        .delete()
        .eq("chat_id", chatId)
        .eq("id", holding.id);

      if (deleteError) {
        throw deleteError;
      }

      await applyFifoSale({
        chatId,
        code: holding.code,
        exitPrice: close,
        tradeId,
        allocations: fifo.allocations,
      });

      if (shouldTakeProfit) takeProfitCount += 1;
      else if (shouldStopLoss) stopLossCount += 1;
      summary.sells += 1;
      summary.notes.push(
        `[실행 매도] ${holding.code} ${qty}주 · 매도가 ${fmtKrw(close)} · 손익률 ${pnlPct.toFixed(2)}%`
      );
      await writeActionLog({
        supabase: payload.supabase,
        runId: payload.runId,
        chatId,
        code: holding.code,
        actionType: "SELL",
        reason: shouldTakeProfit ? "take-profit" : "stop-loss",
        detail: {
          qty,
          buyPrice,
          close,
          gross,
          net,
          pnl,
          pnlPct: Number(pnlPct.toFixed(2)),
          tradeId,
        },
      });
      // 결정로그: 일일 자동 매도 (익절/손절)
      appendVirtualDecisionLog({
        chatId,
        code: holding.code,
        action: "SELL",
        strategyId: AUTO_TRADE_STRATEGY_ID,
        strategyVersion: "v1",
        confidence: shouldTakeProfit ? 80 : 70,
        reasonSummary: shouldTakeProfit
          ? `자동 익절 (수익률 +${pnlPct.toFixed(1)}%)`
          : `자동 손절 (수익률 ${pnlPct.toFixed(1)}%)`,
        reasonDetails: {
          trigger: shouldTakeProfit ? "take-profit" : "stop-loss",
          pnlPct: Number(pnlPct.toFixed(2)),
          pnl,
          buyPrice,
          sellPrice: close,
        },
        linkedTradeId: tradeId ?? undefined,
      }).catch((err: unknown) => console.error("[autoTrade] decision log SELL failed", err));
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
      `보유 종목 ${holdCount}건은 익절 ${takeProfitPct.toFixed(1)}% / 손절 ${stopLossPct.toFixed(1)}% 범위 미도달로 유지`
    );
  }

  // 매도 이후 재조회 기준으로 추가매수/신규 매수 후보를 판단한다.
  const { data: postHoldings, error: postHoldingsError } = await payload.supabase
    .from(PORTFOLIO_TABLES.positionsLegacy)
    .select("id, code, status, quantity, buy_price, invested_amount, created_at, buy_date")
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
      requestedSlots: toPositiveInt(payload.setting.monday_buy_slots, 2),
      baseMinBuyScore: toPositiveInt(payload.setting.min_buy_score, 72),
      activeCount: currentCount,
    });

    if (availableCash > 0 && addOnConstraint.buySlots > 0 && activeHoldings.length > 0) {
      const addOnSelection = await selectDailyAddOnCandidates({
        supabase: payload.supabase,
        holdings: activeHoldings,
        limit: addOnConstraint.buySlots,
        minBuyScore: addOnConstraint.minBuyScore,
      });

      if (addOnSelection.latestAsof) {
        summary.notes.push(`보유 추가매수 점수 기준일: ${addOnSelection.latestAsof}`);
      }

      if (!addOnSelection.candidates.length && addOnSelection.latestTopScore > 0) {
        summary.notes.push(
          `보유 추가매수 후보 0건 (최신 상위점수 ${addOnSelection.latestTopScore}점 · 기준 ${addOnSelection.thresholdUsed}점)`
        );
      }

      for (const candidate of addOnSelection.candidates) {
        const holding = activeHoldings.find((item) => item.code === candidate.code);
        if (!holding) continue;

        const currentQty = Math.max(0, Math.floor(toNumber(holding.quantity, 0)));
        const currentBuyPrice = Math.max(0, toNumber(holding.buy_price, 0));
        const currentInvested = Math.max(
          0,
          toNumber(holding.invested_amount, currentQty * currentBuyPrice)
        );
        const sizing = calculateAutoTradeBuySizing({
          availableCash,
          price: candidate.close,
          slotsLeft: 1,
          currentHoldingCount: Math.max(0, currentCount - 1),
          maxPositions: Math.max(1, maxPositions),
          stopLossPct,
          prefs,
        });
        const addOnBudget = Math.max(
          0,
          Math.min(sizing.budget, sizing.totalBudget - currentInvested)
        );
        const addOnQty = Math.max(0, Math.floor(addOnBudget / candidate.close));
        if (addOnQty <= 0) {
          continue;
        }

        const addOnInvested = Math.round(addOnQty * candidate.close);
        const nextQty = currentQty + addOnQty;
        const nextInvested = currentInvested + addOnInvested;
        const nextBuyPrice = Number((nextInvested / nextQty).toFixed(4));

        try {
          if (payload.dryRun) {
            addOnBuyCount += 1;
            summary.buys += 1;
            summary.notes.push(
              `[테스트 추가매수안] ${candidate.name}(${candidate.code}) +${addOnQty}주 · 총 ${nextQty}주 · 평균단가 ${fmtKrw(nextBuyPrice)} · 투입 ${fmtKrw(addOnInvested)}`
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
                nextQty,
                nextInvested,
                nextBuyPrice,
                score: candidate.score,
              },
            });
            availableCash = Math.max(0, availableCash - addOnInvested);
            continue;
          }

          const { error: updateError } = await payload.supabase
            .from(PORTFOLIO_TABLES.positionsLegacy)
            .update({
              quantity: nextQty,
              invested_amount: nextInvested,
              buy_price: nextBuyPrice,
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
            price: candidate.close,
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
            buyPrice: candidate.close,
            acquiredAt: new Date().toISOString(),
            note: "autotrade-add-on-buy",
            sourceTradeId: tradeId,
          });

          availableCash = Math.max(0, availableCash - addOnInvested);
          addOnBuyCount += 1;
          summary.buys += 1;
          summary.notes.push(
            `[실행 추가매수] ${candidate.name}(${candidate.code}) +${addOnQty}주 · 총 ${nextQty}주 · 평균단가 ${fmtKrw(nextBuyPrice)} · 투입 ${fmtKrw(addOnInvested)} · 점수 ${candidate.score.toFixed(1)}`
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
              nextQty,
              nextInvested,
              nextBuyPrice,
              score: candidate.score,
              tradeId,
              cashAfter: availableCash,
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
              nextQty,
              nextBuyPrice,
              score: candidate.score,
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
    const buyConstraint = applyStrategyBuyConstraint({
      selectedStrategy: payload.setting.selected_strategy,
      requestedSlots: rawBuySlots,
      baseMinBuyScore: toPositiveInt(payload.setting.min_buy_score, 72),
      activeCount: currentCount,
    });
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
    } else {
      const candidateSelection = await selectMondayCandidates({
        supabase: payload.supabase,
        minBuyScore: buyConstraint.minBuyScore,
        limit: buySlots,
        heldCodes,
      });
      const candidates = candidateSelection.candidates;

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

        const sizing = calculateAutoTradeBuySizing({
          availableCash,
          price: candidate.close,
          slotsLeft,
          currentHoldingCount: plannedHoldingCount,
          maxPositions,
          stopLossPct,
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
              price: candidate.close,
            },
          });
          slotsLeft -= 1;
          continue;
        }

        const investedAmount = sizing.investedAmount;

        try {
          if (payload.dryRun) {
            const targetPct = Math.abs(toNumber(payload.setting.take_profit_pct, 8));
            const targetPrice = Math.round(candidate.close * (1 + targetPct / 100));
            const expectedPnl = Math.max(0, Math.round((targetPrice - candidate.close) * qty));
            rebalanceBuyCount += 1;
            summary.buys += 1;
            summary.notes.push(
              `[테스트 매수안] ${candidate.name}(${candidate.code}) ${qty}주 · 매수가 ${fmtKrw(candidate.close)} · 목표가 ${fmtKrw(targetPrice)} · 기대수익 ${fmtKrw(expectedPnl)} (${targetPct.toFixed(1)}%)`
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
                price: candidate.close,
                investedAmount,
                totalBudget: sizing.totalBudget,
                splitCount: sizing.splitCount,
                score: candidate.score,
                targetPrice,
                expectedPnl,
              },
            });
            plannedHoldingCount += 1;
            availableCash = Math.max(0, availableCash - investedAmount);
            slotsLeft -= 1;
            continue;
          }

          const { data: upserted, error: upsertError } = await payload.supabase
            .from(PORTFOLIO_TABLES.positionsLegacy)
            .upsert(
              {
                chat_id: chatId,
                code: candidate.code,
                buy_price: candidate.close,
                buy_date: new Date().toISOString().slice(0, 10),
                quantity: qty,
                invested_amount: investedAmount,
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
            price: candidate.close,
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
              buyPrice: candidate.close,
              acquiredAt: String((upserted as Record<string, unknown> | null)?.created_at ?? "") || null,
              buyDate: String((upserted as Record<string, unknown> | null)?.buy_date ?? "") || null,
            });
          }

          availableCash = Math.max(0, availableCash - investedAmount);
          plannedHoldingCount += 1;
          rebalanceBuyCount += 1;
          summary.buys += 1;
          summary.notes.push(
            `[실행 매수] ${candidate.name}(${candidate.code}) ${qty}주 · 매수가 ${fmtKrw(candidate.close)} · 투입 ${fmtKrw(investedAmount)} · 점수 ${candidate.score.toFixed(1)}`
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
              price: candidate.close,
              investedAmount,
              totalBudget: sizing.totalBudget,
              splitCount: sizing.splitCount,
              score: candidate.score,
              tradeId,
              cashAfter: availableCash,
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
            expectedHorizonDays: 5,
            reasonSummary: `자동 리밸런싱 재매수 (점수 ${candidate.score.toFixed(1)})`,
            reasonDetails: { score: candidate.score, price: candidate.close, qty, investedAmount, totalBudget: sizing.totalBudget, splitCount: sizing.splitCount, trigger: "rebalance-buy" },
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
  };
}

export async function runVirtualAutoTradingForChat(input: {
  chatId: number;
  mode?: RunMode;
  dryRun?: boolean;
  ensureEnabled?: boolean;
}): Promise<ChatAutoTradeRunSummary> {
  const mode = input.mode ?? "auto";
  const dryRun = Boolean(input.dryRun);
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
      "chat_id, is_enabled, monday_buy_slots, max_positions, min_buy_score, take_profit_pct, stop_loss_pct, last_monday_buy_at, last_daily_review_at, selected_strategy"
    )
    .eq("chat_id", input.chatId)
    .maybeSingle();

  const prefs = await getUserInvestmentPrefs(input.chatId);
  const defaultSetting = buildDefaultSettingForChat(input.chatId, prefs.risk_profile);

  const setting: AutoTradeSettingRow = {
    ...defaultSetting,
    ...(settingRow as Partial<AutoTradeSettingRow> | null ?? {}),
    chat_id: input.chatId,
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
        updated_at: new Date().toISOString(),
      },
      { onConflict: "chat_id" }
    );
  }

  const runId = await startRun({
    supabase,
    runType: "MANUAL",
    runKey,
    chatId: input.chatId,
  });

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

  return {
    mode,
    runType,
    runKey,
    dryRun,
    action,
  };
}

async function startRun(payload: {
  supabase: SupabaseClientAny;
  runType: RunType;
  runKey: string;
  chatId: number;
}): Promise<number | null> {
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

  if (error) return null;
  return Number((data as Record<string, unknown> | null)?.id ?? 0) || null;
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
}): Promise<AutoTradeRunSummary> {
  const mode = input?.mode ?? "auto";
  const maxUsers = Math.max(1, Math.floor(input?.maxUsers ?? 200));
  const dryRun = Boolean(input?.dryRun);

  const supabase: SupabaseClientAny = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const runType = selectRunType(mode);
  const runKey = kstDateKey();

  const { data: settingsData, error: settingsError } = await supabase
    .from("virtual_autotrade_settings")
    .select(
      "chat_id, is_enabled, monday_buy_slots, max_positions, min_buy_score, take_profit_pct, stop_loss_pct, last_monday_buy_at, last_daily_review_at, selected_strategy"
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
    actions: [],
  };

  for (const setting of settings) {
    const runId = await startRun({
      supabase,
      runType,
      runKey,
      chatId: setting.chat_id,
    });

    try {
      const actionSummary = runType === "MONDAY_BUY"
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

      const status = actionSummary.errors > 0
        ? "FAILED"
        : actionSummary.buys + actionSummary.sells > 0
          ? "SUCCESS"
          : "SKIPPED";

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
          dryRun,
        },
      });

      if (!dryRun) {
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

  return summary;
}
