/**
 * 자동매매 성과 기준선 비교.
 *
 * 봇이 "그냥 지수를 들고 있거나 현금을 CD금리에 넣어 두는 것"보다 나은지 매일 확인하려고,
 * 첫 거래일 이후 계좌 수익률과 같은 기간 KODEX200·KODEX 코스닥150·CD금리 ETF 보유 수익률을 나란히 보여 준다.
 * (2026-06-09 ~ 09-23: 계좌 약 −1.2% vs KODEX200 −12.9% — 현금 비중 덕분에 지수보다 덜 잃었다)
 */

type SupabaseClientAny = any;

export const BENCHMARK_CODES = [
  { code: "069500", label: "KODEX200" },
  { code: "229200", label: "코스닥150" },
  { code: "459580", label: "CD금리" },
] as const;

export type BenchmarkComparison = {
  sinceDate: string;
  accountReturnPct: number;
  benchmarks: Array<{ label: string; returnPct: number }>;
};

function fmtPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export function formatBenchmarkLine(input: BenchmarkComparison): string {
  const parts = input.benchmarks.map((b) => `${b.label} ${fmtPct(b.returnPct)}`);
  const beatIndex = input.benchmarks.find((b) => b.label === "KODEX200");
  const verdict =
    beatIndex == null
      ? ""
      : input.accountReturnPct >= beatIndex.returnPct
        ? " · 지수 대비 우위"
        : " · 지수 대비 열위";
  return `[기준선 ${input.sinceDate.slice(5).replace("-", "/")}~] 계좌 ${fmtPct(input.accountReturnPct)} vs ${parts.join(" · ")}${verdict}`;
}

export function computeReturnPct(start: number, end: number): number | null {
  if (!(start > 0) || !(end > 0)) return null;
  return ((end - start) / start) * 100;
}

export async function fetchBenchmarkComparison(input: {
  supabase: SupabaseClientAny;
  chatId: number;
  seedCapital: number;
  cash: number;
}): Promise<BenchmarkComparison | null> {
  const { supabase, chatId } = input;
  if (!(input.seedCapital > 0)) return null;

  const { data: firstTrade } = await supabase
    .from("virtual_trades")
    .select("traded_at")
    .eq("chat_id", chatId)
    .order("traded_at", { ascending: true })
    .limit(1);
  const firstAt = (firstTrade?.[0] as { traded_at?: string } | undefined)?.traded_at;
  if (!firstAt) return null;
  const sinceDate = new Date(new Date(firstAt).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const { data: positions } = await supabase
    .from("virtual_positions")
    .select("code, quantity, status, stock:stocks(close)")
    .eq("chat_id", chatId);
  let holdingsValue = 0;
  for (const row of (positions ?? []) as Array<Record<string, any>>) {
    if ((row.status ?? "holding") !== "holding") continue;
    const stock = Array.isArray(row.stock) ? row.stock[0] : row.stock;
    holdingsValue += Math.max(0, Number(row.quantity ?? 0)) * Math.max(0, Number(stock?.close ?? 0));
  }
  const accountReturnPct = ((input.cash + holdingsValue - input.seedCapital) / input.seedCapital) * 100;

  const benchmarks: BenchmarkComparison["benchmarks"] = [];
  for (const { code, label } of BENCHMARK_CODES) {
    const [{ data: startRows }, { data: endRows }] = await Promise.all([
      // 첫 거래일 직전 종가 기준 (그날 장중에 첫 매수를 했으므로)
      supabase.from("stock_daily").select("close").eq("ticker", code).lt("date", sinceDate).order("date", { ascending: false }).limit(1),
      supabase.from("stock_daily").select("close").eq("ticker", code).order("date", { ascending: false }).limit(1),
    ]);
    let start = Number(startRows?.[0]?.close ?? 0);
    if (!(start > 0)) {
      // 수집 시작이 첫 거래일보다 늦은 종목(CD금리 ETF 등)은 가장 이른 종가로 대신한다
      const { data: firstRows } = await supabase
        .from("stock_daily")
        .select("close")
        .eq("ticker", code)
        .gte("date", sinceDate)
        .order("date", { ascending: true })
        .limit(1);
      start = Number(firstRows?.[0]?.close ?? 0);
    }
    const ret = computeReturnPct(start, Number(endRows?.[0]?.close ?? 0));
    if (ret != null) benchmarks.push({ label, returnPct: ret });
  }
  if (!benchmarks.length) return null;
  return { sinceDate, accountReturnPct, benchmarks };
}
