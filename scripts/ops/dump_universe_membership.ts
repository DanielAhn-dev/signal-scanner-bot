/** universe_membership_daily 를 JSON으로 내보낸다 (읽기 전용). 사용: npx tsx scripts/ops/dump_universe_membership.ts <out.json> */
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
    const { data, error } = await sb.from("universe_membership_daily").select("*").order("trade_date").range(off, off + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (off % 50000 === 0) console.log(off, out.length);
    if (!data || data.length < 1000) break;
  }
  writeFileSync(process.argv[2] ?? "universe_membership.json", JSON.stringify(out));
  const dates = [...new Set(out.map((r) => r.trade_date))];
  console.log(`행 ${out.length}, 날짜 ${dates.length}개, ${dates[0]} ~ ${dates[dates.length - 1]}`);
  console.log("컬럼", Object.keys(out[0] ?? {}).join(","));
}
main().catch((e) => { console.error(e); process.exit(1); });
