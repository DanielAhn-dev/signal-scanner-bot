// scripts/syncStocks.ts
import "dotenv/config";
import { KRXClient } from "../packages/data/krx-client.ts";

const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_ANON_KEY!;

async function upsert(list: any[]) {
  await fetch(`${url}/rest/v1/stocks`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(
      list.map((x) => ({
        code: x.code,
        name: x.name,
        market: x.market,
        is_active: true,
      }))
    ),
  });
}

(async function main() {
  const krx = new KRXClient();
  const all = await krx.getStockList("ALL"); // 전체 코스피/코스닥/코넥스
  if (!all.length) throw new Error("KRX 전체 리스트 수집 실패");
  await upsert(all);
  console.log("✓ stocks upsert:", all.length);
})();
