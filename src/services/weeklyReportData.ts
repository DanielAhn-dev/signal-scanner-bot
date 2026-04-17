import { shiftDays, toNum } from "./weeklyReportShared";

export type TradeRow = {
  side: "BUY" | "SELL" | "ADJUST";
  code: string;
  price: number | null;
  quantity: number | null;
  pnl_amount: number | null;
  traded_at: string;
};

export type WatchlistRow = {
  code: string;
  buy_price: number | null;
  quantity: number | null;
  invested_amount: number | null;
  status: string | null;
  stock:
    | { code: string; name: string; close: number | null }
    | { code: string; name: string; close: number | null }[]
    | null;
};

export type WindowSummary = {
  buyCount: number;
  sellCount: number;
  tradeCount: number;
  realizedPnl: number;
  winRate: number;
};

export type TradeWindows = {
  current14: TradeRow[];
  prev14: TradeRow[];
  recent: TradeRow[];
};

export function summarizeWindow(rows: TradeRow[]): WindowSummary {
  const executedRows = rows.filter((r) => r.side === "BUY" || r.side === "SELL");
  const buys = executedRows.filter((r) => r.side === "BUY");
  const sells = executedRows.filter((r) => r.side === "SELL");
  const realized = sells.reduce((acc, r) => acc + toNum(r.pnl_amount), 0);
  const winCount = sells.filter((r) => toNum(r.pnl_amount) > 0).length;
  const winRate = sells.length ? (winCount / sells.length) * 100 : 0;
  return {
    buyCount: buys.length,
    sellCount: sells.length,
    tradeCount: executedRows.length,
    realizedPnl: realized,
    winRate,
  };
}

export function unwrapStock(
  stock: WatchlistRow["stock"]
): { code: string; name: string; close: number | null } | null {
  if (!stock) return null;
  if (Array.isArray(stock)) return stock[0] ?? null;
  return stock;
}

export function splitWindows(rows: TradeRow[], now: Date): TradeWindows {
  const currStart = shiftDays(now, -14).getTime();
  const prevStart = shiftDays(now, -28).getTime();
  return {
    current14: rows.filter((r) => new Date(r.traded_at).getTime() >= currStart),
    prev14: rows.filter((r) => {
      const t = new Date(r.traded_at).getTime();
      return t >= prevStart && t < currStart;
    }),
    recent: rows.slice(0, 10),
  };
}