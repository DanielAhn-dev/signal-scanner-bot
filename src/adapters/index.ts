// src/adapters/index.ts
import KRXClient from "./krx/client";
import type { StockOHLCV } from "../data/types";

const krx = new KRXClient();

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 일봉 시계열 로더(KRX 우선, 부족 시 내부 폴백 경로에서 보완)
 * bars: 요청 캔들 수(기본 420)
 */
export async function getDailySeries(
  code: string,
  bars = 420
): Promise<StockOHLCV[]> {
  const end = new Date();
  const start = new Date();
  // 거래일/휴일을 감안해 여유 폭(≈1.6배)으로 조회 후 뒤에서 슬라이스
  start.setDate(end.getDate() - Math.round(bars * 1.6));
  const series = await krx.getMarketOHLCV(code, fmt(start), fmt(end));
  return series.slice(-bars);
}

/**
 * 전종목 유니버스 로더(KOSPI/KOSDAQ/ALL)
 */
export async function getUniverse(market: "KOSPI" | "KOSDAQ" | "ALL" = "ALL") {
  return krx.getStockList(market);
}

/**
 * 당일 종가/거래량 스냅샷(필요 시 Quiet Spike 판정에 사용)
 */
export async function getDailyPrice(code: string) {
  return krx.getDailyPrice(code);
}

// 필요 시 기본 클래스도 재노출
export { default as KRXClient } from "./krx/client";
