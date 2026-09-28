// 지수 추세 비율(KODEX 200 / KODEX 코스닥150 프록시의 200일·50일선 대비). 자동매매 시장 정책
// (detectAutoTradeMarketPolicy)의 입력이다. 장전 플랜·시장 픽·리포트도 같은 값을 써야 봇과 같은 판단을 한다.
type SupabaseClientAny = any;

export type IndexTrendRatios = { kospi: number | null; kosdaq: number | null; kospiSma50: number | null };

export async function fetchIndexSma200Ratios(
  supabase: SupabaseClientAny
): Promise<{ kospi: number | null; kosdaq: number | null; kospiSma50: number | null }> {
  const KOSPI_PROXY = "069500";  // KODEX 200
  const KOSDAQ_PROXY = "229200"; // KODEX KOSDAQ 150
  try {
    const [kospiRes, kosdaqRes] = await Promise.all([
      supabase
        .from("stock_daily")
        .select("close")
        .eq("ticker", KOSPI_PROXY)
        .order("date", { ascending: false })
        .limit(201),
      supabase
        .from("stock_daily")
        .select("close")
        .eq("ticker", KOSDAQ_PROXY)
        .order("date", { ascending: false })
        .limit(201),
    ]);
    const calcRatio = (rows: { close: number }[] | null): number | null => {
      if (!rows || rows.length < 201) return null;
      const closes = rows.map((r) => r.close).filter(Number.isFinite);
      if (closes.length < 201) return null;
      const current = closes[0];
      const sma200 = closes.slice(1, 201).reduce((s, v) => s + v, 0) / 200;
      if (sma200 <= 0) return null;
      return current / sma200;
    };
    const calcSma50Ratio = (rows: { close: number }[] | null): number | null => {
      const closes = (rows ?? []).map((r) => Number(r.close)).filter((v) => Number.isFinite(v) && v > 0);
      if (closes.length < 51) return null;
      const sma50 = closes.slice(1, 51).reduce((s, v) => s + v, 0) / 50;
      return sma50 > 0 ? closes[0] / sma50 : null;
    };
    for (const [label, res] of [["069500", kospiRes], ["229200", kosdaqRes]] as const) {
      const count = res.data?.length ?? 0;
      if (count < 201) {
        console.warn(`[autoTrade] 지수 프록시 ${label} 일봉 ${count}행(<201) — 200일선 레짐 게이트 비활성`);
      }
    }
    return {
      kospi: calcRatio(kospiRes.data),
      kosdaq: calcRatio(kosdaqRes.data),
      kospiSma50: calcSma50Ratio(kospiRes.data),
    };
  } catch {
    return { kospi: null, kosdaq: null, kospiSma50: null };
  }
}

export function attachIndexTrendRatios(overview: object, ratios: IndexTrendRatios): void {
  const target = overview as Record<string, unknown>;
  target.kospiSma200Ratio = ratios.kospi;
  target.kosdaqSma200Ratio = ratios.kosdaq;
  target.kospiSma50Ratio = ratios.kospiSma50;
}

/** 시장 개요에 지수 추세 비율을 붙여 돌려준다(실패하면 원래 개요 그대로). */
export async function withIndexTrendRatios<T extends object | null>(supabase: SupabaseClientAny, overview: T): Promise<T> {
  if (!overview) return overview;
  const ratios = await fetchIndexSma200Ratios(supabase).catch(() => null);
  if (ratios) attachIndexTrendRatios(overview, ratios);
  return overview;
}
