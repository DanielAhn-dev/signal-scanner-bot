// src/adapters/index.ts
import KRXClient from "./krx/client";
import type { StockOHLCV } from "../data/types";

const krx = new KRXClient();
const FAST_MODE = (process.env.FAST_MODE || "").toLowerCase() === "true";

function fmt(d: Date): string {
  const y = d.getFullYear(),
    m = String(d.getMonth() + 1).padStart(2, "0"),
    day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function getDailySeries(
  code: string,
  bars = 420
): Promise<StockOHLCV[]> {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - Math.round(bars * 1.6));

  if (FAST_MODE) {
    // 네이버 직행(빠른 경로)
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
