// src/adapters/index.ts
import KRXClient from "./krx/client";
import type { StockOHLCV } from "../data/types";
import { supabase } from "../db/client";

const krx = new KRXClient();
const FAST_MODE = (process.env.FAST_MODE || "").toLowerCase() === "true";

function fmt(d: Date): string {
  const y = d.getFullYear(),
    m = String(d.getMonth() + 1).padStart(2, "0"),
    day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * DB(stock_daily) 우선 조회 → 부족하면 외부 API 폴백
 */
export async function getDailySeries(
  code: string,
  bars = 420
): Promise<StockOHLCV[]> {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - Math.round(bars * 1.6));

  // 1) DB 우선: stock_daily 테이블에서 조회
  try {
    const { data: dbRows } = await supabase
      .from("stock_daily")
      .select("date, open, high, low, close, volume, value")
      .eq("ticker", code)
      .gte("date", fmt(start))
      .lte("date", fmt(end))
      .order("date", { ascending: true })
      .limit(bars);

    if (dbRows && dbRows.length >= 200) {
      return dbRows.map((r: any) => ({
        date: r.date,
        code,
        open: Number(r.open) || 0,
        high: Number(r.high) || 0,
        low: Number(r.low) || 0,
        close: Number(r.close) || 0,
        volume: Number(r.volume) || 0,
        amount: (Number(r.close) || 0) * (Number(r.volume) || 0),
      }));
    }
  } catch {
    // DB 조회 실패 시 외부 API로 폴백
  }

  // 2) 외부 API 폴백
  if (FAST_MODE) {
    const out = await krx.getMarketOHLCVFromNaver(code, fmt(start), fmt(end));
    return (out || []).slice(-bars);
  }

  const series = await krx.getMarketOHLCV(code, fmt(start), fmt(end));
  return (series || []).slice(-bars);
}

export async function getUniverse(market: "KOSPI" | "KOSDAQ" | "ALL" = "ALL") {
  return krx.getStockList(market);
}
export async function getDailyPrice(code: string) {
  return krx.getDailyPrice(code);
}
export { default as KRXClient } from "./krx/client";
