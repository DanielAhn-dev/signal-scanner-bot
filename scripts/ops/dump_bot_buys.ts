/** 봇 자동 매수(현금 스윕 제외)를 JSON으로 내보낸다 (읽기 전용). 사용: npx tsx scripts/ops/dump_bot_buys.ts <out.json> */
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
      .from("virtual_trades")
      .select("id,chat_id,code,side,price,quantity,memo,traded_at,source")
      .eq("side", "BUY")
      .eq("source", "AUTO")
      .order("traded_at")
      .range(off, off + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const rows = out.filter((t) => !/cash-sweep/.test(t.memo ?? ""));
  writeFileSync(process.argv[2] ?? "bot_buys.json", JSON.stringify(rows));
  console.log(`매수 ${rows.length}건 (스윕 제외 전 ${out.length})`);
}
main().catch((e) => { console.error(e); process.exit(1); });
