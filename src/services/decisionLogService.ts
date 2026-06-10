import { createClient } from "@supabase/supabase-js";
import { PORTFOLIO_TABLES } from "../db/portfolioSchema";
import { chunkValues, selectPaged } from "./supabasePaging";

export type DecisionAction = "BUY" | "SELL" | "ADJUST" | "HOLD" | "SKIP";

export type DecisionLogInput = {
  chatId: number;
  code: string;
  action: DecisionAction;
  strategyId?: string | null;
  strategyVersion?: string | null;
  marketRegime?: string | null;
  confidence?: number | null;
  expectedHorizonDays?: number | null;
  expectedRr?: number | null;
  reasonSummary?: string | null;
  reasonDetails?: Record<string, unknown> | null;
  linkedTradeId?: number | null;
  decisionAt?: string | null;
};

export type DecisionReliabilitySummary = {
  windowDays: number;
  totalDecisions: number;
  executedDecisions: number;
  explanationCoveragePct: number;
  averageConfidencePct: number | null;
  linkedSellCount: number;
  linkedSellWinRatePct: number | null;
  linkedRealizedPnl: number;
  strategyVersionCount: number;
  trustScore: number | null;
};

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function normalizeConfidence(value: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num <= 0) return 0;
  if (num <= 1) return num * 100;
  return Math.min(100, num);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export async function appendVirtualDecisionLog(
  payload: DecisionLogInput
): Promise<{ ok: boolean; id?: number; error?: string }> {
  try {
    const confidencePct = normalizeConfidence(payload.confidence);

    const { data, error } = await supabase
      .from(PORTFOLIO_TABLES.decisionLogs)
      .insert({
        chat_id: payload.chatId,
        code: payload.code,
        action: payload.action,
        strategy_id: payload.strategyId ?? null,
        strategy_version: payload.strategyVersion ?? null,
        market_regime: payload.marketRegime ?? null,
        confidence: confidencePct,
        expected_horizon_days:
          Number.isFinite(Number(payload.expectedHorizonDays)) && Number(payload.expectedHorizonDays) > 0
            ? Math.floor(Number(payload.expectedHorizonDays))
            : null,
        expected_rr:
          Number.isFinite(Number(payload.expectedRr)) && Number(payload.expectedRr) > 0
            ? Number(payload.expectedRr)
            : null,
        reason_summary: payload.reasonSummary ?? null,
        reason_details:
          payload.reasonDetails && typeof payload.reasonDetails === "object"
            ? payload.reasonDetails
            : null,
        linked_trade_id:
          Number.isFinite(Number(payload.linkedTradeId)) && Number(payload.linkedTradeId) > 0
            ? Math.floor(Number(payload.linkedTradeId))
            : null,
        decision_at: payload.decisionAt ?? new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      console.error("appendVirtualDecisionLog error:", error);
      return { ok: false, error: error.message };
    }

    return { ok: true, id: Number((data as any)?.id) || undefined };
  } catch (e) {
    console.error("appendVirtualDecisionLog error:", e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getDecisionReliabilitySummary(
  chatId: number,
  windowDays = 90
): Promise<DecisionReliabilitySummary | null> {
  const safeWindowDays = Math.max(7, Math.min(365, Math.floor(windowDays)));
  const sinceIso = new Date(
    Date.now() - safeWindowDays * 24 * 60 * 60 * 1000
  ).toISOString();

  const decisionRows = await selectPaged<Record<string, unknown>>(
    async (from, to) =>
      await supabase
        .from(PORTFOLIO_TABLES.decisionLogs)
        .select("id, action, confidence, reason_summary, strategy_version, linked_trade_id")
        .eq("chat_id", chatId)
        .gte("decision_at", sinceIso)
        .order("decision_at", { ascending: false })
        .range(from, to),
    { pageSize: 800, maxRows: 30000, logLabel: "decision.reliability_logs" }
  ).catch((e) => {
    console.error("getDecisionReliabilitySummary decision query error:", e);
    return null;
  });

  if (!decisionRows) {
    return null;
  }

  const decisions = (decisionRows ?? []) as Array<{
    id?: number;
    action?: string;
    confidence?: number | null;
    reason_summary?: string | null;
    strategy_version?: string | null;
    linked_trade_id?: number | null;
  }>;

  if (!decisions.length) {
    return {
      windowDays: safeWindowDays,
      totalDecisions: 0,
      executedDecisions: 0,
      explanationCoveragePct: 0,
      averageConfidencePct: null,
      linkedSellCount: 0,
      linkedSellWinRatePct: null,
      linkedRealizedPnl: 0,
      strategyVersionCount: 0,
      trustScore: null,
    };
  }

  const linkedTradeIds = Array.from(
    new Set(
      decisions
        .map((row) => Number(row.linked_trade_id ?? 0))
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  );

  const tradeMap = new Map<number, { side: string; pnlAmount: number }>();
  if (linkedTradeIds.length) {
    for (const ids of chunkValues(linkedTradeIds)) {
      const { data: tradeRows, error: tradeError } = await supabase
        .from(PORTFOLIO_TABLES.trades)
        .select("id, side, pnl_amount")
        .in("id", ids);

      if (tradeError) {
        console.error("getDecisionReliabilitySummary trade query error:", tradeError);
        return null;
      }

      for (const row of tradeRows ?? []) {
        const id = Number((row as any).id ?? 0);
        if (!id) continue;
        tradeMap.set(id, {
          side: String((row as any).side ?? "").toUpperCase(),
          pnlAmount: Number((row as any).pnl_amount ?? 0),
        });
      }
    }
  }

  const totalDecisions = decisions.length;
  const executedDecisions = decisions.filter((row) => Number(row.linked_trade_id ?? 0) > 0).length;

  const explanationCoverageCount = decisions.filter((row) =>
    Boolean(String(row.reason_summary ?? "").trim())
  ).length;
  const explanationCoveragePct = round1((explanationCoverageCount / totalDecisions) * 100);

  const confidenceValues = decisions
    .map((row) => normalizeConfidence(row.confidence))
    .filter((v): v is number => v != null);
  const averageConfidencePct = confidenceValues.length
    ? round1(confidenceValues.reduce((acc, cur) => acc + cur, 0) / confidenceValues.length)
    : null;

  const linkedSellPnls = decisions
    .map((row) => tradeMap.get(Number(row.linked_trade_id ?? 0)))
    .filter((trade): trade is { side: string; pnlAmount: number } => Boolean(trade && trade.side === "SELL"))
    .map((trade) => trade.pnlAmount);

  const linkedSellCount = linkedSellPnls.length;
  const linkedSellWins = linkedSellPnls.filter((pnl) => pnl > 0).length;
  const linkedSellWinRatePct = linkedSellCount
    ? round1((linkedSellWins / linkedSellCount) * 100)
    : null;
  const linkedRealizedPnl = Math.round(linkedSellPnls.reduce((acc, cur) => acc + cur, 0));

  const strategyVersionCount = new Set(
    decisions
      .map((row) => String(row.strategy_version ?? "").trim())
      .filter(Boolean)
  ).size;

  const confidenceComponent = averageConfidencePct == null ? 0 : averageConfidencePct * 0.3;
  const explanationComponent = explanationCoveragePct * 0.3;
  const outcomeComponent = (linkedSellWinRatePct ?? 0) * 0.4;
  const trustScoreRaw = confidenceComponent + explanationComponent + outcomeComponent;
  const trustScore =
    linkedSellCount > 0 || executedDecisions > 0
      ? Math.max(0, Math.min(100, Math.round(trustScoreRaw)))
      : null;

  return {
    windowDays: safeWindowDays,
    totalDecisions,
    executedDecisions,
    explanationCoveragePct,
    averageConfidencePct,
    linkedSellCount,
    linkedSellWinRatePct,
    linkedRealizedPnl,
    strategyVersionCount,
    trustScore,
  };
}

export type FactorWinRateBucket = {
  label: string;
  wins: number;
  total: number;
  winRatePct: number | null;
  avgPnl: number | null;
};

export type FactorWinRateSummary = {
  windowDays: number;
  scoreBands: FactorWinRateBucket[];
  signalTrustGrades: FactorWinRateBucket[];
  strategyProfiles: FactorWinRateBucket[];
};

/**
 * 팩터별 승률 분석: 진입 당시 점수대, 신호 신뢰등급, 전략 프로파일별
 * 수익 거래 비율과 평균 P&L을 반환한다.
 * weekly report에서 "어떤 조건에서 진입한 거래가 수익이 났는가"를 파악하는 용도.
 */
export async function getFactorWinRateSummary(
  chatId: number,
  windowDays = 90
): Promise<FactorWinRateSummary | null> {
  const safeWindowDays = Math.max(14, Math.min(365, Math.floor(windowDays)));
  const sinceIso = new Date(
    Date.now() - safeWindowDays * 24 * 60 * 60 * 1000
  ).toISOString();

  const decisionRows = await selectPaged<Record<string, unknown>>(
    async (from, to) =>
      await supabase
        .from(PORTFOLIO_TABLES.decisionLogs)
        .select("action, reason_details, linked_trade_id")
        .eq("chat_id", chatId)
        .eq("action", "BUY")
        .gte("decision_at", sinceIso)
        .not("linked_trade_id", "is", null)
        .range(from, to),
    { pageSize: 500, maxRows: 5000, logLabel: "decision.factor_winrate" }
  ).catch(() => null);

  if (!decisionRows || !decisionRows.length) return null;

  const linkedIds = Array.from(
    new Set(decisionRows.map((r) => Number(r.linked_trade_id ?? 0)).filter((n) => n > 0))
  );
  if (!linkedIds.length) return null;

  const tradeMap = new Map<number, { pnl: number }>();
  for (const ids of chunkValues(linkedIds)) {
    const { data } = await supabase
      .from(PORTFOLIO_TABLES.trades)
      .select("id, pnl_amount")
      .in("id", ids);
    for (const row of data ?? []) {
      const id = Number((row as any).id ?? 0);
      const pnl = Number((row as any).pnl_amount ?? NaN);
      if (id > 0 && Number.isFinite(pnl)) tradeMap.set(id, { pnl });
    }
  }

  type Bucket = { wins: number; total: number; pnlSum: number };
  const scoreBands: Record<string, Bucket> = {
    "70+": { wins: 0, total: 0, pnlSum: 0 },
    "60-69": { wins: 0, total: 0, pnlSum: 0 },
    "50-59": { wins: 0, total: 0, pnlSum: 0 },
    "40-49": { wins: 0, total: 0, pnlSum: 0 },
    "~39": { wins: 0, total: 0, pnlSum: 0 },
  };
  const trustGrades: Record<string, Bucket> = {};
  const profiles: Record<string, Bucket> = {};

  for (const row of decisionRows) {
    const tradeId = Number(row.linked_trade_id ?? 0);
    const trade = tradeMap.get(tradeId);
    if (!trade) continue;

    const details = (row.reason_details ?? {}) as Record<string, unknown>;
    const score = Number(details.score ?? NaN);
    const grade = String((details.signalTrust as any)?.grade ?? details.trustGrade ?? "?");
    const profile = String(details.strategyProfile ?? "?");
    const pnl = trade.pnl;
    const win = pnl > 0;

    // 점수대
    let band = "~39";
    if (Number.isFinite(score)) {
      if (score >= 70) band = "70+";
      else if (score >= 60) band = "60-69";
      else if (score >= 50) band = "50-59";
      else if (score >= 40) band = "40-49";
    }
    scoreBands[band].total += 1;
    if (win) scoreBands[band].wins += 1;
    scoreBands[band].pnlSum += pnl;

    // 신호 신뢰등급
    if (grade) {
      if (!trustGrades[grade]) trustGrades[grade] = { wins: 0, total: 0, pnlSum: 0 };
      trustGrades[grade].total += 1;
      if (win) trustGrades[grade].wins += 1;
      trustGrades[grade].pnlSum += pnl;
    }

    // 전략 프로파일
    if (profile) {
      if (!profiles[profile]) profiles[profile] = { wins: 0, total: 0, pnlSum: 0 };
      profiles[profile].total += 1;
      if (win) profiles[profile].wins += 1;
      profiles[profile].pnlSum += pnl;
    }
  }

  const toBuckets = (map: Record<string, Bucket>): FactorWinRateBucket[] =>
    Object.entries(map)
      .filter(([, b]) => b.total > 0)
      .map(([label, b]) => ({
        label,
        wins: b.wins,
        total: b.total,
        winRatePct: round1((b.wins / b.total) * 100),
        avgPnl: Math.round(b.pnlSum / b.total),
      }))
      .sort((a, b) => b.total - a.total);

  return {
    windowDays: safeWindowDays,
    scoreBands: toBuckets(scoreBands),
    signalTrustGrades: toBuckets(trustGrades),
    strategyProfiles: toBuckets(profiles),
  };
}
