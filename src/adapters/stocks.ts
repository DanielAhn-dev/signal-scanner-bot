// src/adapters/stocks.ts
import type { StockRow } from "../types/db";

// TODO: 실제 구현 시 PyKRX/스크래퍼/외부 API를 호출해 반환
export async function fetchAllKRX(): Promise<StockRow[]> {
  // 임시 스텁: 최소 1~2개로 빌드 통과 확인
  return [
    {
      code: "005930",
      name: "삼성전자",
      market: "KOSPI",
      updated_at: new Date().toISOString(),
    },
    {
      code: "000660",
      name: "SK하이닉스",
      market: "KOSPI",
      updated_at: new Date().toISOString(),
    },
  ];
}
