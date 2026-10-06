/**
 * 봇 가상매매 실현 손익을 같은 보유 기간 KODEX 200과 비교한다 (읽기 전용).
 *
 * 매도마다 먼저 산 것부터 판다고 보고(FIFO) 매수가·매수일을 맞춘 뒤, 같은 기간 KODEX 200 종가 수익과 비교한다.
 * 수익률 순위로 결론 내지 말 것: 종목 몇 개 대 지수는 1년을 재도 잡음 범위가 넓다(가설 장부 C10).
 * 이 표의 목적은 '수익이 실력인지 시장 덕인지'를 감이 아니라 숫자로 보는 것이다.
 *
 * 사용: npx tsx scripts/ops/report_bot_vs_index.ts [--chat <id>] [--since 2026-09-28] [--include-sweep]
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

type Trade = {
  id: number;
  chat_id: number;
  code: string;
  side: string;
  price: number;
  quantity: number;
  pnl_amount: number | null;
  memo: string | null;
  traded_at: string;
  source: string | null;
};

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

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.");
  const sb = createClient(url, key);
  const since = arg("--since") ?? "2000-01-01";
  const includeSweep = process.argv.includes("--include-sweep");

  const trades = await fetchAll<Trade>((a, b) =>
    sb
      .from("virtual_trades")
      .select("id,chat_id,code,side,price,quantity,pnl_amount,memo,traded_at,source")
      .order("traded_at")
      .order("id")
      .range(a, b)
  );
  let chatId = Number(arg("--chat") ?? 0);
  if (!chatId) {
    const counts = new Map<number, number>();
    for (const t of trades) if (t.source === "AUTO") counts.set(t.chat_id, (counts.get(t.chat_id) ?? 0) + 1);
    chatId = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? 0;
  }
  const mine = trades.filter((t) => t.chat_id === chatId && t.source === "AUTO");
  const isSweep = (t: Trade) => /cash-sweep/.test(t.memo ?? "");

  const idx = await fetchAll<{ date: string; close: number }>((a, b) =>
    sb.from("stock_daily").select("date, close").eq("ticker", "069500").order("date").range(a, b)
  );
  const idxDates = idx.map((r) => String(r.date).slice(0, 10));
  const closeOn = (iso: string) => {
    const d = iso.slice(0, 10);
    let lo = 0;
    let hi = idxDates.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (idxDates[mid] <= d) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans >= 0 ? Number(idx[ans].close) : NaN;
  };

  const lots = new Map<string, Array<{ qty: number; price: number; at: string }>>();
  const rows: Array<{ sold: string; code: string; bought: string; qty: number; ret: number; idxRet: number; pnl: number }> = [];
  for (const t of mine) {
    if (!includeSweep && isSweep(t)) continue;
    const q = Number(t.quantity);
    if (t.side === "BUY") {
      const L = lots.get(t.code) ?? [];
      L.push({ qty: q, price: Number(t.price), at: t.traded_at });
      lots.set(t.code, L);
    } else if (t.side === "SELL") {
      let left = q;
      const L = lots.get(t.code) ?? [];
      while (left > 0 && L.length) {
        const lot = L[0];
        const used = Math.min(left, lot.qty);
        if (t.traded_at.slice(0, 10) >= since) {
          rows.push({
            sold: t.traded_at.slice(0, 10),
            code: t.code,
            bought: lot.at.slice(0, 10),
            qty: used,
            ret: Number(t.price) / lot.price - 1,
            idxRet: closeOn(t.traded_at) / closeOn(lot.at) - 1,
            pnl: (Number(t.price) - lot.price) * used,
          });
        }
        lot.qty -= used;
        left -= used;
        if (lot.qty <= 0) L.shift();
      }
    }
  }

  const pct = (x: number) => (Number.isFinite(x) ? `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%` : "  -  ");
  console.log(`봇 실현 손익 대 KODEX 200 · chat ${chatId} · ${since}~ · 현금 스윕 ${includeSweep ? "포함" : "제외"}`);
  console.log("매도일      종목    매수일      수량   종목수익  KODEX200   차이     손익(세전)");
  for (const r of rows) {
    console.log(
      `${r.sold}  ${r.code}  ${r.bought}  ${String(r.qty).padStart(5)}  ${pct(r.ret).padStart(7)}  ${pct(r.idxRet).padStart(7)}  ${pct(
        r.ret - r.idxRet
      ).padStart(7)}  ${Math.round(r.pnl).toLocaleString("ko-KR").padStart(10)}`
    );
  }
  const ex = rows.filter((r) => Number.isFinite(r.idxRet)).map((r) => r.ret - r.idxRet).sort((a, b) => a - b);
  const total = rows.reduce((s, r) => s + r.pnl, 0);
  const wins = ex.filter((x) => x > 0).length;
  const median = ex.length ? ex[Math.floor(ex.length / 2)] : NaN;
  const mean = ex.length ? ex.reduce((s, x) => s + x, 0) / ex.length : NaN;
  console.log(
    `\n매도 ${rows.length}건 · 세전 실현 손익 ${Math.round(total).toLocaleString("ko-KR")}원 · ` +
      `지수 대비 평균 ${pct(mean)} 중앙 ${pct(median)} · 지수를 이긴 매도 ${wins}/${ex.length}`
  );
  console.log("참고: 미실현 평가손익·수수료·세금은 빠져 있다. 몇 달 치로 실력을 판정하지 말 것(가설 장부 C10).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
