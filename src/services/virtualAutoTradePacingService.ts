import type { InvestmentPrefs } from "./userService";

type SupabaseClientAny = any;

export type AutoTradePacingState = "behind" | "on-track" | "ahead";

export type AutoTradePacingMetrics = {
  targetAnnualPct: number;
  targetMonthlyPct: number;
  monthReturnPct: number;
  monthRealizedPnl: number;
  seedCapital: number;
  state: AutoTradePacingState;
  relaxLevel: 0 | 1 | 2;
};

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getKstMonthStartIso(base = new Date()): string {
  const offsetMs = 9 * 60 * 60 * 1000;
  const kst = new Date(base.getTime() + offsetMs);
  const year = kst.getUTCFullYear();
  const month = kst.getUTCMonth();
  const utcMonthStart = Date.UTC(year, month, 1) - offsetMs;
  return new Date(utcMonthStart).toISOString();
}

export function derivePacingState(input: {
  monthReturnPct: number;
  targetMonthlyPct: number;
}): AutoTradePacingState {
  const target = Math.max(0.1, toNumber(input.targetMonthlyPct, 0.8));
  const monthReturnPct = toNumber(input.monthReturnPct, 0);

  if (monthReturnPct >= target * 1.1) return "ahead";
  if (monthReturnPct >= target * 0.6) return "on-track";
  return "behind";
}

export function derivePacingRelaxLevel(input: {
  state: AutoTradePacingState;
  runCount?: number;
  buyActions?: number;
}): 0 | 1 | 2 {
  if (input.state !== "behind") return 0;

  const runCount = Math.max(0, Math.floor(toNumber(input.runCount, 0)));
  const buyActions = Math.max(0, Math.floor(toNumber(input.buyActions, 0)));

  if (runCount >= 8 && buyActions <= 0) return 2;
  return 1;
}

export async function computeAutoTradePacingMetrics(input: {
  supabase: SupabaseClientAny;
  chatId: number;
  prefs: InvestmentPrefs;
  recentRunCount?: number;
  recentBuyActions?: number;
}): Promise<AutoTradePacingMetrics> {
  const seedCapital = Math.max(
    0,
    toNumber(input.prefs.virtual_seed_capital, toNumber(input.prefs.capital_krw, 0))
  );
  const targetAnnualPct = Math.max(1, toNumber((input.prefs as Record<string, unknown>).pacing_target_annual_pct, 10));
  const configuredMonthlyPct = toNumber(
    (input.prefs as Record<string, unknown>).pacing_target_monthly_pct,
    targetAnnualPct / 12
  );
  const targetMonthlyPct = Math.max(0.2, configuredMonthlyPct);

  const monthStartIso = getKstMonthStartIso();
  const { data } = await input.supabase
    .from("virtual_trades")
    .select("pnl_amount, side, traded_at")
    .eq("chat_id", input.chatId)
    .eq("side", "SELL")
    .gte("traded_at", monthStartIso)
    .limit(3000);

  const monthRealizedPnl = (data ?? []).reduce((sum: number, row: Record<string, unknown>) => {
    return sum + toNumber(row.pnl_amount, 0);
  }, 0);

  const monthReturnPct = seedCapital > 0 ? (monthRealizedPnl / seedCapital) * 100 : 0;
  const state = derivePacingState({ monthReturnPct, targetMonthlyPct });
  const relaxLevel = derivePacingRelaxLevel({
    state,
    runCount: input.recentRunCount,
    buyActions: input.recentBuyActions,
  });

  return {
    targetAnnualPct,
    targetMonthlyPct,
    monthReturnPct,
    monthRealizedPnl,
    seedCapital,
    state,
    relaxLevel,
  };
}
