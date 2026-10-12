/** 가상 보유 포지션의 메모(peak_price 등)를 JSON으로 내보낸다 (읽기 전용). 사용: npx tsx scripts/ops/dump_position_peaks.ts <out.json> */
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
    const { data, error } = await sb
      .from("virtual_positions")
      .select("chat_id,code,buy_price,quantity,memo,created_at,updated_at")
      .is("broker_name", null)
      .is("account_name", null)
      .gt("quantity", 0)
      .order("created_at")
      .range(off, off + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  writeFileSync(process.argv[2] ?? "position_peaks.json", JSON.stringify(out));
  console.log(`포지션 ${out.length}건`);
}
main().catch((e) => { console.error(e); process.exit(1); });
