// src/adapters/stocks.ts
import fetch from "node-fetch";

export type StockRow = {
  code: string;
  name: string;
  market?: string;
  liquidity?: number;
};

export async function fetchAllKRX(): Promise<StockRow[]> {
  // TODO: 실제 구현. 임시로 외부 JSON/CSV에서 전체 목록을 가져오는 형태로 대체 가능.
  // 예: 사전 생성한 all_krx.json을 Storage/Repo에서 받아 파싱
  const r = await fetch(process.env.ALL_KRX_JSON_URL!);
  const list = (await r.json()) as Array<{
    code: string;
    name: string;
    market: string;
  }>;
  return list.map((x) => ({ code: x.code, name: x.name, market: x.market }));
}
