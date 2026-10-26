/**
 * H65: 봇 자동 매수 개별주가 매수 후 20거래일 안에 종가 +5%에 닿았다가 20일째 종가에서 마이너스로 끝나는 비율 (읽기 전용).
 * 판정 기준은 docs/hypothesis-ledger.md H65에 결과 보기 전 고정돼 있다. 기준을 여기서 바꾸지 않는다.
 * 제외: 스윕(cash-sweep) 매수, 실계좌 입력 행, 매수 후 20거래일이 아직 안 지난 건.
 *
 * 사용: npx tsx scripts/ops/report_touch_then_fade.ts
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const HORIZON = 20;
const TOUCH = 0.05;

type Buy = { chat_id: number; code: string; price: number; traded_at: string; memo: string | null };

async function fetchAll<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await build(off, off + 999);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.");
  const sb = createClient(url, key);

  const all = await fetchAll<Buy>((a, b) =>
    sb
      .from("virtual_trades")
      .select("chat_id,code,price,traded_at,memo")
      .eq("side", "BUY")
      .eq("source", "AUTO")
      .is("broker_name", null)
      .is("account_name", null)
      .order("traded_at")
      .order("id")
      .range(a, b),
  );
  const buys = all.filter((t) => !/cash-sweep/.test(t.memo ?? ""));
  console.log(`자동 매수 ${all.length}건 중 스윕 제외 ${buys.length}건`);

  // 종목별 종가 이력 (매수일 이후만 필요 → 종목마다 한 번에)
  const codes = [...new Set(buys.map((b) => b.code))];
  const closes = new Map<string, { date: string; close: number }[]>();
  for (const code of codes) {
    const since = buys.filter((b) => b.code === code).map((b) => b.traded_at.slice(0, 10)).sort()[0];
    const rows = await fetchAll<{ date: string; close: number }>((a, b) =>
      sb.from("stock_daily").select("date,close").eq("ticker", code).gte("date", since).order("date").range(a, b),
    );
    closes.set(code, rows.map((r) => ({ date: String(r.date).slice(0, 10), close: Number(r.close) })).filter((r) => r.close > 0));
  }

  type Row = { touched: boolean; end: number; code: string; date: string; maxUp: number };
  const rows: Row[] = [];
  let tooRecent = 0;
  let noData = 0;
  for (const b of buys) {
    const d0 = b.traded_at.slice(0, 10); // 날짜 문자열 비교: UTC 기준 날짜와 거래일이 어긋날 수 있어 매수일 당일은 제외
    const series = (closes.get(b.code) ?? []).filter((r) => r.date > d0);
    if (series.length < HORIZON) {
      (closes.get(b.code)?.length ? tooRecent++ : noData++);
      continue;
    }
    const win = series.slice(0, HORIZON);
    const rets = win.map((r) => r.close / b.price - 1);
    rows.push({ touched: rets.some((r) => r >= TOUCH), end: rets[HORIZON - 1], code: b.code, date: d0, maxUp: Math.max(...rets) });
  }
  console.log(`20거래일 지난 매수 ${rows.length}건 (미경과 ${tooRecent}건, 가격 없음 ${noData}건)`);

  const touched = rows.filter((r) => r.touched);
  const not = rows.filter((r) => !r.touched);
  const neg = (xs: Row[]) => xs.filter((r) => r.end < 0).length;
  console.log(`\n[+5% 도달] N=${touched.length}  20일째 <0: ${neg(touched)}건 (${touched.length ? pct(neg(touched) / touched.length) : "-"})  20일째 수익 중앙값 ${pct(median(touched.map((r) => r.end)))}`);
  console.log(`[+5% 미도달] N=${not.length}  20일째 <0: ${neg(not)}건 (${not.length ? pct(neg(not) / not.length) : "-"})  20일째 수익 중앙값 ${pct(median(not.map((r) => r.end)))}`);
  console.log(`[전체] N=${rows.length}  20일 중 최대 상승 중앙값 ${pct(median(rows.map((r) => r.maxUp)))}`);
  console.log(
    touched.length >= 20
      ? `\n판정(H65 사전 기준): 도달 중 <0 비율 ${pct(neg(touched) / touched.length)} ${neg(touched) / touched.length >= 0.3 ? "≥ 30% → 되돌림 흔함" : "< 30% → 기각"}`
      : `\n판정(H65 사전 기준): 도달 표본 N=${touched.length} < 20 → 보류(판정 안 함)`,
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
