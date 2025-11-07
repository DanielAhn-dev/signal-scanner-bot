// src/adapters/index.ts
import KRXClient from "./krx/client";
import type { StockOHLCV } from "../data/types";

const krx = new KRXClient();

function fmt(d: Date): string {
  const y = d.getFullYear(),
    m = String(d.getMonth() + 1).padStart(2, "0"),
    day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// 일봉 420봉 보장(휴일 대비 여유폭 조회 후 슬라이스)
export async function getDailySeries(
  code: string,
  bars = 420
): Promise<StockOHLCV[]> {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - Math.round(bars * 1.6));
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
