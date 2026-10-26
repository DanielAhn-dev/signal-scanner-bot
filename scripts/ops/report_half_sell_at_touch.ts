/**
 * H66: 과거 진입 신호(pullback_signals A등급)에서 20거래일 안에 종가 +5%에 닿은 종목을
 * '처음 닿은 날 종가에 절반 매도, 나머지는 20일째 종가'로 하면 20일째까지 보유보다 나은지 (읽기 전용).
 * 판정 기준은 docs/hypothesis-ledger.md H66에 결과 보기 전 고정돼 있다. 기준을 여기서 바꾸지 않는다.
 *
 * 사용: npx tsx scripts/ops/report_half_sell_at_touch.ts [--from 2026-03-01]
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const HORIZON = 20;
const TOUCH = 0.05;
const HOLD_COST = 0.0045; // 왕복 0.45%p (backtest_exit_params 기본값)
const SPLIT_EXTRA_COST = 0.001; // 절반 매도 경로 추가 0.10%p

type Signal = { code: string; trade_date: string };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

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

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN;
};

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.");
  const sb = createClient(url, key);
  const from = arg("--from") ?? "2026-03-01";

  const signals = await fetchAll<Signal>((a, b) =>
    sb.from("pullback_signals").select("code,trade_date").eq("entry_grade", "A").gte("trade_date", from).order("trade_date").order("code").range(a, b),
  );
  console.log(`A등급 신호 ${signals.length}건 (${from}~)`);

  const codes = [...new Set(signals.map((s) => s.code))];
  const series = new Map<string, { date: string; close: number }[]>();
  for (const code of codes) {
    const rows = await fetchAll<{ date: string; close: number }>((a, b) =>
      sb.from("stock_daily").select("date,close").eq("ticker", code).gte("date", from).order("date").range(a, b),
    );
    series.set(code, rows.map((r) => ({ date: String(r.date).slice(0, 10), close: Number(r.close) })).filter((r) => r.close > 0));
  }

  type Row = { date: string; touched: boolean; hold: number; split: number; end: number };
  const rows: Row[] = [];
  const lastTaken = new Map<string, number>(); // 종목별 마지막으로 채택한 신호의 일봉 인덱스
  let noEntry = 0;
  let tooRecent = 0;
  for (const s of signals) {
    const ser = series.get(s.code) ?? [];
    const i = ser.findIndex((r) => r.date === s.trade_date);
    if (i < 0) { noEntry++; continue; }
    const prev = lastTaken.get(s.code);
    if (prev !== undefined && i - prev <= HORIZON) continue; // 20거래일 안에 겹치는 신호는 첫 신호만
    if (i + HORIZON >= ser.length) { tooRecent++; continue; }
    lastTaken.set(s.code, i);
    const entry = ser[i].close;
    const rets = ser.slice(i + 1, i + 1 + HORIZON).map((r) => r.close / entry - 1);
    const end = rets[HORIZON - 1];
    const hit = rets.findIndex((r) => r >= TOUCH);
    const hold = end - HOLD_COST;
    const split = hit >= 0 ? 0.5 * rets[hit] + 0.5 * end - HOLD_COST - SPLIT_EXTRA_COST : hold;
    rows.push({ date: s.trade_date, touched: hit >= 0, hold, split, end });
  }
  console.log(`중복 제거 후 ${rows.length}건 (일봉 없음 ${noEntry}, 20거래일 미경과 ${tooRecent})`);

  const t = rows.filter((r) => r.touched);
  console.log(`\n[+5% 도달] N=${t.length} / 전체 ${rows.length}`);
  if (!t.length) return;
  const fadeShare = t.filter((r) => r.end < 0).length / t.length;
  const diff = mean(t.map((r) => r.split)) - mean(t.map((r) => r.hold));
  const holdP10 = quantile(t.map((r) => r.hold), 0.1);
  const splitP10 = quantile(t.map((r) => r.split), 0.1);
  console.log(`ⓑ 20일째 종가 <0 비율: ${pct(fadeShare)}`);
  console.log(`ⓒ 평균 보유 ${pct(mean(t.map((r) => r.hold)))} · 절반매도 ${pct(mean(t.map((r) => r.split)))} · 차이 ${pct(diff)}`);
  console.log(`ⓓ 하위10% 보유 ${pct(holdP10)} · 절반매도 ${pct(splitP10)}`);

  const sorted = [...t].sort((a, b) => a.date.localeCompare(b.date));
  const mid = Math.floor(sorted.length / 2);
  const halves = [sorted.slice(0, mid), sorted.slice(mid)];
  const halfDiffs = halves.map((h) => mean(h.map((r) => r.split)) - mean(h.map((r) => r.hold)));
  halves.forEach((h, k) => console.log(`ⓔ ${k === 0 ? "앞" : "뒤"} 절반 (${h[0]?.date}~${h[h.length - 1]?.date}, N=${h.length}) 차이 ${pct(halfDiffs[k])}`));

  const checks = {
    "ⓐ N≥100": t.length >= 100,
    "ⓑ <0 비율 ≥30%": fadeShare >= 0.3,
    "ⓒ 차이 ≥ +0.3%p": diff >= 0.003,
    "ⓓ 하위10% 같거나 큼": splitP10 >= holdP10,
    "ⓔ 양쪽 절반 양수": halfDiffs.every((d) => d > 0),
  };
  console.log("\n판정(H66 사전 기준)");
  for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "통과" : "불통과"}  ${k}`);
  console.log(!checks["ⓐ N≥100"] ? "→ 보류" : Object.values(checks).every(Boolean) ? "→ 통과 (채택 아님 — H67 필요)" : "→ 기각");
}

main().catch((e) => { console.error(e); process.exit(1); });
