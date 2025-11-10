// src/adapters/stocks.ts
import { StockRow } from "../../src/types/db";

export async function fetchAllKRX(): Promise<StockRow[]> {
  const r = await fetch(process.env.ALL_KRX_JSON_URL!);
  if (!r.ok) throw new Error(`fetch KRX failed: ${r.status}`);
  const list = (await r.json()) as Array<{
    code: string;
    name: string;
    market: string;
  }>;
  return list.map((x) => ({ code: x.code, name: x.name, market: x.market }));
}
