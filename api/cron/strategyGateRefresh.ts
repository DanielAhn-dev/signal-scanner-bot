import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { parseStrategyMemo } from "../../src/lib/strategyMemo";
import {
  resolveStrategyGateStatus,
  upsertStrategyGateState,
  type StrategyGateMetrics,
} from "../../src/services/strategyGateStateService";

const CRON_SECRET = process.env.CRON_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const AUTO_TRADE_STRATEGY_ID = "core.autotrade.v1";
const AUTO_TUNE_ENABLED = String(process.env.CRON_AUTO_TUNE ?? "true").toLowerCase() !== "false";

export const config = {
  maxDuration: 60,
};

type SettingRow = {
  chat_id: number;
  selected_strategy?: string | null;
  min_buy_score?: number | null;
  monday_buy_slots?: number | null;
  is_enabled?: boolean | null;
};

type SellRow = {
  chat_id: number;
  pnl_amount?: number | null;
  memo?: string | null;
};

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function buildMetrics(rows: SellRow[], windowDays: number): StrategyGateMetrics {
  const pnls: number[] = [];
  for (const row of rows) {
    const strategyId = parseStrategyMemo(row.memo).strategyId;
    if (strategyId !== AUTO_TRADE_STRATEGY_ID) continue;
    pnls.push(toNumber(row.pnl_amount, 0));
  }

  if (!pnls.length) {
    return {
      sellCount: 0,
      winRate: 0,
      profitFactor: null,
      maxLossStreak: 0,
      windowDays,
    };
  }

  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const grossWin = wins.reduce((acc, cur) => acc + cur, 0);
  const grossLossAbs = Math.abs(losses.reduce((acc, cur) => acc + cur, 0));

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
    sellCount: pnls.length,
    winRate: (wins.length / pnls.length) * 100,
    profitFactor: grossLossAbs > 0 ? grossWin / grossLossAbs : null,
    maxLossStreak,
    windowDays,
  };
}

function resolveAdaptiveSettingPatch(input: {
  status: "promote" | "hold" | "watch" | "pause";
  setting: SettingRow;
}): Partial<SettingRow> | null {
  const selectedStrategy = String(input.setting.selected_strategy ?? "HOLD_SAFE").toUpperCase();
  const minBuyScore = clampInt(toNumber(input.setting.min_buy_score, 72), 50, 95);
  const mondayBuySlots = clampInt(toNumber(input.setting.monday_buy_slots, 2), 1, 4);

  if (input.status === "pause") {
    return {
      selected_strategy: "WAIT_AND_DIP_BUY",
      min_buy_score: clampInt(minBuyScore + 2, 50, 95),
      monday_buy_slots: 1,
    };
  }

  if (input.status === "watch") {
    return {
      selected_strategy: selectedStrategy === "WAIT_AND_DIP_BUY" ? "WAIT_AND_DIP_BUY" : "HOLD_SAFE",
      min_buy_score: clampInt(minBuyScore + 1, 50, 95),
      monday_buy_slots: Math.min(mondayBuySlots, 2),
    };
  }

  if (input.status === "promote") {
    return {
      selected_strategy: selectedStrategy === "WAIT_AND_DIP_BUY" ? "HOLD_SAFE" : selectedStrategy,
      min_buy_score: clampInt(minBuyScore - 1, 50, 95),
      monday_buy_slots: Math.max(mondayBuySlots, 2),
    };
  }

  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).send("Method Not Allowed");
  }

  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).send("Unauthorized");
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ ok: false, error: "Missing Supabase credentials" });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false },
    });

    const windowDays = 45;
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: settings, error: settingsError } = await supabase
      .from("virtual_autotrade_settings")
      .select("chat_id, is_enabled, selected_strategy, min_buy_score, monday_buy_slots")
      .eq("is_enabled", true)
      .limit(2000)
      .returns<SettingRow[]>();

    if (settingsError) {
      throw new Error(`settings fetch failed: ${settingsError.message}`);
    }

    const settingRows = settings ?? [];
    const chatIds = settingRows.map((row) => row.chat_id).filter((id) => Number.isFinite(id));

    if (!chatIds.length) {
      return res.status(200).json({ ok: true, total: 0, refreshed: 0, tuned: 0 });
    }

    const { data: sellRows, error: sellError } = await supabase
      .from("virtual_trades")
      .select("chat_id, pnl_amount, memo")
      .eq("side", "SELL")
      .gte("traded_at", since)
      .in("chat_id", chatIds)
      .limit(20000)
      .returns<SellRow[]>();

    if (sellError) {
      throw new Error(`sell rows fetch failed: ${sellError.message}`);
    }

    const byChat = new Map<number, SellRow[]>();
    for (const row of sellRows ?? []) {
      const chatId = Number(row.chat_id);
      if (!byChat.has(chatId)) byChat.set(chatId, []);
      byChat.get(chatId)!.push(row);
    }

    let refreshed = 0;
    let tuned = 0;

    for (const row of settingRows) {
      const chatId = Number(row.chat_id);
      const metrics = buildMetrics(byChat.get(chatId) ?? [], windowDays);
      const status = resolveStrategyGateStatus(metrics);

      await upsertStrategyGateState({
        supabase,
        chatId,
        strategyId: AUTO_TRADE_STRATEGY_ID,
        strategyProfile: row.selected_strategy ?? null,
        metrics,
        status,
        meta: {
          source: "strategyGateRefreshCron",
          autoTuneEnabled: AUTO_TUNE_ENABLED,
        },
      });
      refreshed += 1;

      if (AUTO_TUNE_ENABLED) {
        const patch = resolveAdaptiveSettingPatch({ status, setting: row });
        if (patch) {
          const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
          const nextStrategy = String(patch.selected_strategy ?? row.selected_strategy ?? "");
          const nextMin = toNumber(patch.min_buy_score, row.min_buy_score ?? 72);
          const nextSlots = toNumber(patch.monday_buy_slots, row.monday_buy_slots ?? 2);

          if (nextStrategy && nextStrategy !== String(row.selected_strategy ?? "")) {
            updates.selected_strategy = nextStrategy;
          }
          if (nextMin !== toNumber(row.min_buy_score, 72)) {
            updates.min_buy_score = clampInt(nextMin, 50, 95);
          }
          if (nextSlots !== toNumber(row.monday_buy_slots, 2)) {
            updates.monday_buy_slots = clampInt(nextSlots, 1, 4);
          }

          if (Object.keys(updates).length > 1) {
            await supabase
              .from("virtual_autotrade_settings")
              .update(updates)
              .eq("chat_id", chatId);
            tuned += 1;
          }
        }
      }
    }

    return res.status(200).json({
      ok: true,
      total: settingRows.length,
      refreshed,
      tuned,
      autoTuneEnabled: AUTO_TUNE_ENABLED,
    });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: error?.message ?? String(error),
    });
  }
}
