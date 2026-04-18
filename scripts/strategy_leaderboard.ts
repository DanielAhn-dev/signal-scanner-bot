import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { parseStrategyMemo } from "../src/lib/strategyMemo";

type TradeRow = {
  chat_id: number;
  side: "BUY" | "SELL" | "ADJUST";
  pnl_amount: number | null;
  memo: string | null;
  traded_at: string;
};

type StrategyStats = {
  strategyId: string;
  sells: number;
  wins: number;
  losses: number;
  totalPnl: number;
  avgPnl: number;
  winRate: number;
  profitFactor: number | null;
  maxDrawdown: number;
  lastTradeAt: string | null;
};

function toNum(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseArgs(argv: string[]): { chatId?: number; days: number; top: number } {
  let chatId: number | undefined;
  let days = 120;
  let top = 10;

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === "--chatId" && next) {
      const n = Number(next);
      if (Number.isFinite(n) && n > 0) chatId = n;
      i += 1;
    } else if (key === "--days" && next) {
      const n = Number(next);
      if (Number.isFinite(n) && n > 0) days = Math.floor(n);
      i += 1;
    } else if (key === "--top" && next) {
      const n = Number(next);
      if (Number.isFinite(n) && n > 0) top = Math.floor(n);
      i += 1;
    }
  }

  return { chatId, days, top };
}

function calcMaxDrawdown(pnlSeries: number[]): number {
  let peak = 0;
  let equity = 0;
  let maxDd = 0;
  for (const pnl of pnlSeries) {
    equity += pnl;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

function summarize(rows: TradeRow[]): StrategyStats[] {
  const byStrategy = new Map<string, TradeRow[]>();
  for (const row of rows) {
    if (row.side !== "SELL") continue;
    const memo = parseStrategyMemo(row.memo);
    const key = memo.strategyId;
    const list = byStrategy.get(key) ?? [];
    list.push(row);
    byStrategy.set(key, list);
  }

  const out: StrategyStats[] = [];
  for (const [strategyId, list] of byStrategy.entries()) {
    const sorted = [...list].sort((a, b) => a.traded_at.localeCompare(b.traded_at));
    const pnls = sorted.map((r) => toNum(r.pnl_amount));
    const sells = pnls.length;
    const wins = pnls.filter((v) => v > 0).length;
    const losses = pnls.filter((v) => v < 0).length;
    const totalPnl = pnls.reduce((acc, v) => acc + v, 0);
    const avgPnl = sells ? totalPnl / sells : 0;
    const winPnl = pnls.filter((v) => v > 0).reduce((acc, v) => acc + v, 0);
    const lossPnlAbs = Math.abs(pnls.filter((v) => v < 0).reduce((acc, v) => acc + v, 0));
    const profitFactor = lossPnlAbs > 0 ? winPnl / lossPnlAbs : null;
    const maxDrawdown = calcMaxDrawdown(pnls);

    out.push({
      strategyId,
      sells,
      wins,
      losses,
      totalPnl,
      avgPnl,
      winRate: sells ? (wins / sells) * 100 : 0,
      profitFactor,
      maxDrawdown,
      lastTradeAt: sorted[sorted.length - 1]?.traded_at ?? null,
    });
  }

  return out.sort((a, b) => b.totalPnl - a.totalPnl);
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString("ko-KR");
}

async function main() {
  const { chatId, days, top } = parseArgs(process.argv.slice(2));

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) are required");
  }

  const supabase = createClient(url, key);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let query = supabase
    .from("virtual_trades")
    .select("chat_id, side, pnl_amount, memo, traded_at")
    .gte("traded_at", since)
    .order("traded_at", { ascending: true })
    .limit(10000);

  if (chatId) query = query.eq("chat_id", chatId);

  const { data, error } = await query.returns<TradeRow[]>();
  if (error) throw new Error(`virtual_trades query failed: ${error.message}`);

  const rows = data ?? [];
  const stats = summarize(rows).slice(0, top);

  console.log("=== Strategy Leaderboard (Live) ===");
  console.log(`window: last ${days} days${chatId ? ` | chat_id=${chatId}` : ""}`);
  if (!stats.length) {
    console.log("No SELL trades found in the selected window.");
    return;
  }

  for (const [idx, s] of stats.entries()) {
    console.log([
      `${idx + 1}. ${s.strategyId}`,
      `PnL ${s.totalPnl >= 0 ? "+" : ""}${fmt(s.totalPnl)}원`,
      `WinRate ${s.winRate.toFixed(1)}% (${s.wins}/${s.sells})`,
      `PF ${s.profitFactor != null ? s.profitFactor.toFixed(2) : "N/A"}`,
      `Avg ${s.avgPnl >= 0 ? "+" : ""}${fmt(s.avgPnl)}원`,
      `MDD ${fmt(s.maxDrawdown)}원`,
      `Last ${s.lastTradeAt ?? "-"}`,
    ].join(" | "));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
