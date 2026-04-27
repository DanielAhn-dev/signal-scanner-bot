type SupabaseClientAny = any;

export type StrategyGateStatus = "promote" | "hold" | "watch" | "pause";

export type StrategyGateMetrics = {
  sellCount: number;
  winRate: number;
  profitFactor: number | null;
  maxLossStreak: number;
  windowDays: number;
};

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function resolveStrategyGateStatus(metrics: StrategyGateMetrics): StrategyGateStatus {
  if (metrics.sellCount < 8) return "watch";
  if ((metrics.profitFactor != null && metrics.profitFactor < 0.9) || metrics.maxLossStreak >= 4) {
    return "pause";
  }
  if (metrics.profitFactor != null && metrics.profitFactor >= 1.2 && metrics.winRate >= 55) {
    return "promote";
  }
  return "hold";
}

export async function upsertStrategyGateState(input: {
  supabase: SupabaseClientAny;
  chatId: number;
  strategyId: string;
  strategyProfile?: string | null;
  metrics: StrategyGateMetrics;
  status?: StrategyGateStatus;
  meta?: Record<string, unknown> | null;
}): Promise<void> {
  const status = input.status ?? resolveStrategyGateStatus(input.metrics);
  await input.supabase.from("virtual_strategy_gate_states").upsert(
    {
      chat_id: input.chatId,
      strategy_id: input.strategyId,
      strategy_profile: input.strategyProfile ?? null,
      gate_status: status,
      sell_count: Math.max(0, Math.floor(toNumber(input.metrics.sellCount, 0))),
      win_rate: Number(toNumber(input.metrics.winRate, 0).toFixed(2)),
      profit_factor:
        input.metrics.profitFactor != null && Number.isFinite(input.metrics.profitFactor)
          ? Number(Number(input.metrics.profitFactor).toFixed(4))
          : null,
      max_loss_streak: Math.max(0, Math.floor(toNumber(input.metrics.maxLossStreak, 0))),
      window_days: Math.max(1, Math.floor(toNumber(input.metrics.windowDays, 45))),
      asof: new Date().toISOString(),
      meta: input.meta ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "chat_id,strategy_id" }
  );
}

export async function fetchStrategyGateState(input: {
  supabase: SupabaseClientAny;
  chatId: number;
  strategyId: string;
}): Promise<{
  status: StrategyGateStatus;
  sellCount: number;
  winRate: number;
  profitFactor: number | null;
  maxLossStreak: number;
  windowDays: number;
  strategyProfile?: string | null;
  asof?: string | null;
} | null> {
  const { data, error } = await input.supabase
    .from("virtual_strategy_gate_states")
    .select(
      "gate_status, sell_count, win_rate, profit_factor, max_loss_streak, window_days, strategy_profile, asof"
    )
    .eq("chat_id", input.chatId)
    .eq("strategy_id", input.strategyId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    status: String((data as any).gate_status) as StrategyGateStatus,
    sellCount: Math.max(0, Math.floor(toNumber((data as any).sell_count, 0))),
    winRate: toNumber((data as any).win_rate, 0),
    profitFactor:
      (data as any).profit_factor == null ? null : toNumber((data as any).profit_factor, 0),
    maxLossStreak: Math.max(0, Math.floor(toNumber((data as any).max_loss_streak, 0))),
    windowDays: Math.max(1, Math.floor(toNumber((data as any).window_days, 45))),
    strategyProfile: String((data as any).strategy_profile ?? "") || null,
    asof: String((data as any).asof ?? "") || null,
  };
}
