// packages/data/search.ts
import { KRXClient } from "./krx-client";

export type StockLite = {
  code: string;
  name: string;
  market: "KOSPI" | "KOSDAQ" | "KONEX";
};

let cache: StockLite[] = [];
let lastLoaded = 0;

function normalize(s: string) {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()·\-_.]/g, "");
}

function scoreName(q: string, name: string) {
  const nq = normalize(q);
  const nn = normalize(name);
  if (nn === nq) return 100;
  if (nn.startsWith(nq)) return 90;
  if (nn.includes(nq)) return 70;
  return 0;
}

export async function ensureStockList(): Promise<StockLite[]> {
  const now = Date.now();
  if (cache.length && now - lastLoaded < 6 * 60 * 60 * 1000) return cache;
  const krx = new KRXClient();
  const list = await krx.getStockList("ALL");
  cache = list.map((x) => ({ code: x.code, name: x.name, market: x.market }));
  lastLoaded = now;
  return cache;
}

export async function searchByNameOrCode(
  q: string,
  limit = 8
): Promise<StockLite[]> {
  const list = await ensureStockList();
  const nq = normalize(q);
  // 코드 완전일치 우선
  const exactCode = list.find((x) => x.code === q);
  if (exactCode) return [exactCode];
  // 이름 점수 기반 정렬
  const scored = list
    .map((x) => ({ x, s: scoreName(nq, x.name) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((r) => r.x);
  return scored;
}
