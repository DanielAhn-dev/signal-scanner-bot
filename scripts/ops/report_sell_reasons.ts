/**
 * 봇 가상계좌 매매를 사유별·개별주/지수별로 집계한다 (읽기 전용).
 * "손절만 계속 난다"가 개별주 손절 탓인지 지수(스윕) 평가 하락 탓인지 숫자로 나눠 보기 위한 것.
 *
 * - 매도: 메모 event(stop-loss, take-profit-*, loss-trim 등)별 건수·순손익(pnl_amount, 수수료·세금 뺀 값)·이긴 비율
 * - 매수: 개별주/지수 건수·금액
 * - 지금 보유: 개별주/지수 평가손익(stocks.close 기준)
 * 실계좌 입력 행(broker_name·account_name 있음)은 뺀다.
 *
 * 사용: npx tsx scripts/ops/report_sell_reasons.ts [--since 2026-09-28] [--chat <id>]
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { isExchangeTradedProduct } from "../../src/lib/securitiesTax";
import { parseStrategyMemo } from "../../src/lib/strategyMemo";

type Trade = { chat_id: number; code: string; side: string; price: number; quantity: number; pnl_amount: number | null; memo: string | null; traded_at: string };
type Position = { chat_id: number; code: string; quantity: number; invested_amount: number | null; memo: string | null };

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

const won = (v: number) => `${Math.round(v).toLocaleString("ko-KR")}원`;

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.");
  const sb = createClient(url, key);
  const since = arg("--since") ?? "2026-09-28";
  const onlyChat = Number(arg("--chat") ?? 0);

  const trades = await fetchAll<Trade>((a, b) => {
    let q = sb
      .from("virtual_trades")
      .select("chat_id,code,side,price,quantity,pnl_amount,memo,traded_at")
      .is("broker_name", null)
      .is("account_name", null)
      .gte("traded_at", `${since}T00:00:00+09:00`)
      .order("traded_at")
      .order("id");
    if (onlyChat) q = q.eq("chat_id", onlyChat);
    return q.range(a, b);
  });
  const positions = await fetchAll<Position>((a, b) => {
    let q = sb
      .from("virtual_positions")
      .select("chat_id,code,quantity,invested_amount,memo")
      .is("broker_name", null)
      .is("account_name", null)
      .eq("status", "holding")
      .gt("quantity", 0)
      .order("id");
    if (onlyChat) q = q.eq("chat_id", onlyChat);
    return q.range(a, b);
  });

  const codes = [...new Set([...trades, ...positions].map((r) => r.code))];
  const stock = new Map<string, { name: string; close: number }>();
  // .in()에 큰 배열을 넘기지 않는다 — 100개씩
  for (let i = 0; i < codes.length; i += 100) {
    const { data, error } = await sb.from("stocks").select("code,name,close").in("code", codes.slice(i, i + 100));
    if (error) throw error;
    for (const r of data ?? []) stock.set(String(r.code), { name: String(r.name ?? ""), close: Number(r.close) || 0 });
  }
  const kind = (code: string, memo: string | null) => {
    const s = parseStrategyMemo(memo).strategyId;
    if (s === "cash-sweep.v1") return "지수(스윕)";
    return isExchangeTradedProduct(code, stock.get(code)?.name) ? "ETF(기타)" : "개별주";
  };

  const chats = [...new Set([...trades, ...positions].map((r) => r.chat_id))].sort((a, b) => a - b);
  console.log(`기간 ${since}~ · 계좌 ${chats.length}개 · 매매 ${trades.length}건 · 보유 ${positions.length}행`);
  for (const chat of chats) {
    const ts = trades.filter((t) => t.chat_id === chat);
    const ps = positions.filter((p) => p.chat_id === chat);
    console.log(`\n=== chat ${chat} ===`);

    const sells = new Map<string, { n: number; pnl: number; wins: number }>();
    for (const t of ts.filter((x) => x.side === "SELL")) {
      const k = `${kind(t.code, t.memo)} · ${parseStrategyMemo(t.memo).event}`;
      const cur = sells.get(k) ?? { n: 0, pnl: 0, wins: 0 };
      const pnl = Number(t.pnl_amount) || 0;
      cur.n += 1; cur.pnl += pnl; if (pnl > 0) cur.wins += 1;
      sells.set(k, cur);
    }
    console.log("매도 (종류 · 사유: 건수 · 순손익 · 이긴 비율)");
    for (const [k, v] of [...sells.entries()].sort((a, b) => a[1].pnl - b[1].pnl)) {
      console.log(`  ${k.padEnd(34)} ${String(v.n).padStart(3)}건 · ${won(v.pnl).padStart(12)} · ${Math.round((v.wins / v.n) * 100)}%`);
    }
    const byKind = new Map<string, { n: number; amt: number }>();
    for (const t of ts.filter((x) => x.side === "BUY")) {
      const k = kind(t.code, t.memo);
      const cur = byKind.get(k) ?? { n: 0, amt: 0 };
      cur.n += 1; cur.amt += t.price * t.quantity;
      byKind.set(k, cur);
    }
    console.log("매수 (종류: 건수 · 금액)");
    for (const [k, v] of byKind) console.log(`  ${k.padEnd(10)} ${v.n}건 · ${won(v.amt)}`);

    const hold = new Map<string, { value: number; cost: number }>();
    for (const p of ps) {
      const k = kind(p.code, p.memo);
      const close = stock.get(p.code)?.close ?? 0;
      const cost = Number(p.invested_amount) || 0;
      const cur = hold.get(k) ?? { value: 0, cost: 0 };
      cur.value += close > 0 ? p.quantity * close : cost;
      cur.cost += cost;
      hold.set(k, cur);
    }
    console.log("지금 보유 (종류: 평가액 · 평가손익)");
    for (const [k, v] of hold) {
      console.log(`  ${k.padEnd(10)} ${won(v.value)} · ${won(v.value - v.cost)} (${v.cost > 0 ? (((v.value / v.cost) - 1) * 100).toFixed(1) : "0"}%)`);
    }
    const stockSells = ts.filter((x) => x.side === "SELL" && kind(x.code, x.memo) === "개별주");
    if (stockSells.length) {
      console.log("개별주 매도 목록");
      for (const t of stockSells) {
        const pnl = Number(t.pnl_amount) || 0;
        const base = t.price * t.quantity - pnl;
        console.log(`  ${t.traded_at.slice(0, 10)} ${t.code} ${(stock.get(t.code)?.name ?? "").padEnd(12)} ${parseStrategyMemo(t.memo).event.padEnd(20)} ${won(pnl).padStart(10)} (${base > 0 ? ((pnl / base) * 100).toFixed(1) : "-"}%)`);
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
