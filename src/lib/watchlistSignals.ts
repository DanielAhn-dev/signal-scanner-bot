import type { SupabaseClient } from "@supabase/supabase-js";
import type { InvestmentPlan } from "./investPlan";

export type ResponseAction = "HOLD" | "TAKE_PROFIT" | "STOP_LOSS";

interface StockDailyRow {
  ticker: string;
  date: string;
  value: number | null;
}

interface InvestorDailyRow {
  ticker: string;
  date: string;
  foreign: number | null;
  institution: number | null;
}

export interface WatchMicroSignal {
  valueRatio: number | null;
  valueZ: number | null;
  valueAnomaly: boolean;
  flowShift: boolean;
  foreign5d: number;
  institution5d: number;
  triggerReasons: string[];
}

export interface WatchDecision {
  action: ResponseAction;
  reason: string;
  pnlPct: number;
  triggerReasons: string[];
  executionGuardPassed: boolean;
  confidence: number;
    /** STOP_LOSS 조건은 충족했지만 수급/거래대금 트리거 미충족으로 억제된 경우 true */
    blockedStopLoss?: boolean;
}

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stddev(values: number[], mean: number): number {
  if (!values.length) return 0;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function rollingSums(rows: InvestorDailyRow[]): {
  foreign5d: number;
  institution5d: number;
  net3d: number;
  netPrev5d: number;
} {
  const recent = rows.slice(0, 3);
  const prev = rows.slice(3, 8);
  const f5 = rows.slice(0, 5).reduce((sum, r) => sum + toNum(r.foreign), 0);
  const i5 = rows.slice(0, 5).reduce((sum, r) => sum + toNum(r.institution), 0);
  const net3d = recent.reduce((sum, r) => sum + toNum(r.foreign) + toNum(r.institution), 0);
  const netPrev5d = prev.reduce((sum, r) => sum + toNum(r.foreign) + toNum(r.institution), 0);

  return {
    foreign5d: f5,
    institution5d: i5,
    net3d,
    netPrev5d,
  };
}

function analyzeMicroSignal(dailyRows: StockDailyRow[], flowRows: InvestorDailyRow[]): WatchMicroSignal {
  const sortedDaily = [...dailyRows].sort((a, b) => b.date.localeCompare(a.date));
  const values = sortedDaily.map((r) => toNum(r.value)).filter((v) => v > 0);
  const latest = values[0] ?? 0;
  const baselineWindow = values.slice(1, 21);
  const baselineMean = average(baselineWindow);
  const baselineStd = stddev(baselineWindow, baselineMean);
  const valueRatio = baselineMean > 0 ? latest / baselineMean : null;
  const valueZ = baselineStd > 0 ? (latest - baselineMean) / baselineStd : null;
  const valueAnomaly = Boolean(
    (valueRatio != null && valueRatio >= 1.8) ||
      (valueZ != null && valueZ >= 2.0)
  );

  const sortedFlow = [...flowRows].sort((a, b) => b.date.localeCompare(a.date));
  const { foreign5d, institution5d, net3d, netPrev5d } = rollingSums(sortedFlow);

  const flippedDirection =
    net3d !== 0 &&
    netPrev5d !== 0 &&
    Math.sign(net3d) !== Math.sign(netPrev5d) &&
    Math.abs(net3d) >= Math.abs(netPrev5d) * 0.6;

  const accelerated =
    Math.abs(net3d) >= Math.max(3_000_000_000, Math.abs(netPrev5d) * 2);

  const flowShift = flippedDirection || accelerated;

  const triggerReasons: string[] = [];
  if (valueAnomaly && valueRatio != null) {
    triggerReasons.push(`거래대금 급증(${valueRatio.toFixed(1)}배)`);
  }
  if (flowShift) {
    if (net3d < 0) triggerReasons.push("외국인·기관 수급 급랭");
    else triggerReasons.push("외국인·기관 수급 유입 강화");
  }

  return {
    valueRatio,
    valueZ,
    valueAnomaly,
    flowShift,
    foreign5d,
    institution5d,
    triggerReasons,
  };
}

function baseAction(close: number, buyPrice: number, plan: InvestmentPlan): Omit<WatchDecision, "triggerReasons" | "executionGuardPassed" | "confidence"> {
  const pnlPct = buyPrice > 0 ? ((close - buyPrice) / buyPrice) * 100 : 0;

  if (close <= plan.stopPrice) {
    return {
      action: "STOP_LOSS",
      reason: `손절 기준(${Math.round(plan.stopPrice)}원) 하회`,
      pnlPct,
    };
  }

  if (close >= plan.target1) {
    return {
      action: "TAKE_PROFIT",
      reason: `1차 목표가(${Math.round(plan.target1)}원) 도달`,
      pnlPct,
    };
  }

  return {
    action: "HOLD",
    reason:
      plan.status === "buy-on-pullback"
        ? `눌림 대기(${Math.round(plan.entryLow)}~${Math.round(plan.entryHigh)}원)`
        : `보유 유지(손절 ${Math.round(plan.stopPrice)}원 / 목표 ${Math.round(plan.target1)}원)`,
    pnlPct,
  };
}

export function resolveWatchDecision(payload: {
  close: number;
  buyPrice: number;
  plan: InvestmentPlan;
  microSignal?: WatchMicroSignal | null;
}): WatchDecision {
  const base = baseAction(payload.close, payload.buyPrice, payload.plan);
  const micro = payload.microSignal;
  const hasMicroTrigger = Boolean(micro?.valueAnomaly || micro?.flowShift);
  const stopLossBypass = base.action === "STOP_LOSS";

  let confidence = 45;
  if (base.action !== "HOLD") confidence += 10;
  if (micro?.valueAnomaly) confidence += 20;
  if (micro?.flowShift) confidence += 20;
  if (micro?.valueAnomaly && micro?.flowShift) confidence += 5;
  confidence = Math.max(30, Math.min(95, confidence));

  if (!stopLossBypass && base.action !== "HOLD" && !hasMicroTrigger) {
    return {
      action: "HOLD",
      reason: `${base.reason} 대기 (거래대금/수급 트리거 미충족)`,
      pnlPct: base.pnlPct,
      triggerReasons: [],
      executionGuardPassed: false,
        confidence,
        blockedStopLoss: base.action === "STOP_LOSS",
    };
  }

  return {
    action: base.action,
    reason: base.reason,
    pnlPct: base.pnlPct,
    triggerReasons: micro?.triggerReasons ?? [],
    executionGuardPassed:
      base.action === "HOLD" ? false : stopLossBypass ? true : hasMicroTrigger,
    confidence,
  };
}

export async function fetchWatchMicroSignalsByCodes(
  supabase: SupabaseClient,
  codes: string[]
): Promise<Map<string, WatchMicroSignal>> {
  const uniqCodes = [...new Set(codes.filter(Boolean))];
  const result = new Map<string, WatchMicroSignal>();

  if (!uniqCodes.length) return result;

  const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const [{ data: dailyRows }, { data: flowRows }] = await Promise.all([
    supabase
      .from("stock_daily")
      .select("ticker, date, value")
      .in("ticker", uniqCodes)
      .gte("date", since90),
    supabase
      .from("investor_daily")
      .select("ticker, date, foreign, institution")
      .in("ticker", uniqCodes)
      .gte("date", since30),
  ]);

  const dailyByCode = new Map<string, StockDailyRow[]>();
  const flowByCode = new Map<string, InvestorDailyRow[]>();

  for (const row of (dailyRows ?? []) as StockDailyRow[]) {
    const list = dailyByCode.get(row.ticker) ?? [];
    list.push(row);
    dailyByCode.set(row.ticker, list);
  }
  for (const row of (flowRows ?? []) as InvestorDailyRow[]) {
    const list = flowByCode.get(row.ticker) ?? [];
    list.push(row);
    flowByCode.set(row.ticker, list);
  }

  for (const code of uniqCodes) {
    const signal = analyzeMicroSignal(
      dailyByCode.get(code) ?? [],
      flowByCode.get(code) ?? []
    );
    result.set(code, signal);
  }

  return result;
}
