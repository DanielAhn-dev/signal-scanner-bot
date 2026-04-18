import { shiftDays, toNum } from "./weeklyReportShared";

export type TradeRow = {
  side: "BUY" | "SELL" | "ADJUST";
  code: string;
  price: number | null;
  quantity: number | null;
  pnl_amount: number | null;
  traded_at: string;
  memo?: string | null;
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
  avgWinPct: number;
  avgLossPct: number;
  payoffRatio: number | null;
  maxSingleLoss: number;
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

  const sellReturnPcts = sells
    .map((r) => {
      const price = toNum(r.price);
      const qty = Math.max(0, Math.floor(toNum(r.quantity)));
      const notional = price * qty;
      if (!notional) return null;
      return (toNum(r.pnl_amount) / notional) * 100;
    })
    .filter((v): v is number => Number.isFinite(v));

  const winPcts = sellReturnPcts.filter((v) => v > 0);
  const lossPctsAbs = sellReturnPcts.filter((v) => v < 0).map((v) => Math.abs(v));
  const avgWinPct = winPcts.length
    ? winPcts.reduce((acc, v) => acc + v, 0) / winPcts.length
    : 0;
  const avgLossPct = lossPctsAbs.length
    ? lossPctsAbs.reduce((acc, v) => acc + v, 0) / lossPctsAbs.length
    : 0;
  const payoffRatio = avgWinPct > 0 && avgLossPct > 0
    ? avgWinPct / avgLossPct
    : null;
  const maxSingleLoss = sells.reduce((minLoss, row) => Math.min(minLoss, toNum(row.pnl_amount)), 0);

  return {
    buyCount: buys.length,
    sellCount: sells.length,
    tradeCount: executedRows.length,
    realizedPnl: realized,
    winRate,
    avgWinPct,
    avgLossPct,
    payoffRatio,
    maxSingleLoss,
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