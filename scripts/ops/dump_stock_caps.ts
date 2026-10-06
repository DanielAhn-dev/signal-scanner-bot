/** stocks(code, name, market, market_cap, close, universe_level, is_active)를 JSON으로 (읽기 전용). 사용: npx tsx scripts/ops/dump_stock_caps.ts <out.json> */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.");
  const sb = createClient(url, key);
  const out: any[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb.from("stocks").select("code,name,market,market_cap,close,universe_level,is_active,updated_at").range(off, off + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  writeFileSync(process.argv[2] ?? "stock_caps.json", JSON.stringify(out));
  console.log(`종목 ${out.length}, 시총 있음 ${out.filter((r) => Number(r.market_cap) > 0).length}`);
  const lv = new Map<string, number>();
  for (const r of out) lv.set(String(r.universe_level), (lv.get(String(r.universe_level)) ?? 0) + 1);
  console.log([...lv.entries()]);
}
main().catch((e) => { console.error(e); process.exit(1); });
