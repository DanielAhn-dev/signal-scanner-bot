/**
 * 실적 관문(fundamentalQualityGate)의 pass/fail/unknown 비율을 잰다 (읽기 전용, select만 한다).
 * 전 종목이 한꺼번에 unknown이 되는 수집 중단을 알아채는 기준(정상일 때 unknown 비율)을 정하기 위한 것.
 * 대상: 활성 보통주(ETF·ETN 제외), 시가총액 상위 N(기본 300·전체)별로 나눠 본다.
 *
 * 사용: npx tsx scripts/ops/report_fundamental_gate_coverage.ts [--top 300]
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { isExchangeTradedProduct } from "../../src/lib/securitiesTax";
import { fetchFundamentalGateResults } from "../../src/services/fundamentalQualityGate";

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / KEY 없음");
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const topArg = process.argv.indexOf("--top");
  const top = topArg >= 0 ? Number(process.argv[topArg + 1]) : 300;

  const stocks: Array<{ code: string; name: string; market_cap: number | null }> = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb
      .from("stocks")
      .select("code,name,market_cap")
      .eq("is_active", true)
      .range(off, off + 999);
    if (error) throw error;
    stocks.push(...((data ?? []) as typeof stocks));
    if (!data || data.length < 1000) break;
  }
  const common = stocks
    .filter((s) => !isExchangeTradedProduct(s.code, s.name))
    .sort((a, b) => Number(b.market_cap ?? 0) - Number(a.market_cap ?? 0));
  console.log(`활성 종목 ${stocks.length}, 보통주 ${common.length}`);

  for (const [label, list] of [["시총 상위 " + top, common.slice(0, top)], ["보통주 전체", common]] as const) {
    const results = await fetchFundamentalGateResults(
      sb,
      list.map((s) => s.code)
    );
    const count = { pass: 0, fail: 0, unknown: 0 };
    const reasons = new Map<string, number>();
    for (const s of list) {
      const r = results.get(s.code);
      const status = r?.status ?? "unknown";
      count[status] += 1;
      if (status === "unknown") {
        const reason = r && r.status === "unknown" ? r.reason : "결과 없음";
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      }
    }
    const n = list.length || 1;
    const pct = (v: number) => `${((v / n) * 100).toFixed(1)}%`;
    console.log(`\n[${label}] n=${list.length}  pass ${count.pass}(${pct(count.pass)})  fail ${count.fail}(${pct(count.fail)})  unknown ${count.unknown}(${pct(count.unknown)})`);
    for (const [reason, c] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) console.log(`  unknown 사유: ${reason} ${c}(${pct(c)})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
