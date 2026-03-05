// src/utils/fetchMarketData.ts
// 글로벌 경제지표 · 지수 · 환율 · 공포지수 조회

export interface MarketIndex {
  name: string;
  price: number;
  change: number;
  changeRate: number;
}

export interface ExchangeRate {
  code: string;
  name: string;
  price: number;
  change: number;
  changeRate: number;
}

export interface FearGreedData {
  score: number;
  rating: string;
}

export interface MarketOverview {
  kospi?: MarketIndex;
  kosdaq?: MarketIndex;
  usdkrw?: ExchangeRate;
  vix?: MarketIndex;
  fearGreed?: FearGreedData;
  sp500?: MarketIndex;
  nasdaq?: MarketIndex;
  us10y?: MarketIndex;
}

const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" };

const parsePrice = (s?: string): number => {
  if (!s) return 0;
  return parseFloat(s.replace(/,/g, "")) || 0;
};

// ─── Naver 국내 지수 ───
async function fetchNaverIndex(
  indexCode: string
): Promise<MarketIndex | null> {
  try {
    const res = await fetch(
      `https://m.stock.naver.com/api/index/${indexCode}/basic`,
      { headers: UA }
    );
    if (!res.ok) return null;
    const d: any = await res.json();
    return {
      name: d.indexName || d.stockName || indexCode,
      price: parsePrice(d.closePrice),
      change: parsePrice(d.compareToPreviousClosePrice),
      changeRate: parseFloat(d.fluctuationsRatio || "0"),
    };
  } catch {
    return null;
  }
}

export const fetchKOSPI = () => fetchNaverIndex("KOSPI");
export const fetchKOSDAQ = () => fetchNaverIndex("KOSDAQ");

// ─── 환율 (Dunamu forex API) ───
export async function fetchUSDKRW(): Promise<ExchangeRate | null> {
  try {
    const res = await fetch(
      "https://quotation-api-cdn.dunamu.com/v1/forex/recent?codes=FRX.KRWUSD",
      { headers: UA }
    );
    if (!res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr) || !arr[0]) return null;
    const d = arr[0];
    return {
      code: "FX_USDKRW",
      name: "달러/원",
      price: d.basePrice || 0,
      change: d.changePrice || 0,
      changeRate: (d.changeRate || 0) * 100,
    };
  } catch {
    return null;
  }
}

// ─── Yahoo Finance 공용 fetcher ───
async function fetchYahoo(
  symbol: string,
  label: string
): Promise<MarketIndex | null> {
  try {
    const enc = encodeURIComponent(symbol);
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${enc}?range=1d&interval=1d`,
      { headers: UA }
    );
    if (!res.ok) return null;
    const body: any = await res.json();
    const meta = body?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const price = meta.regularMarketPrice || 0;
    const prev =
      meta.chartPreviousClose || meta.previousClose || price;
    return {
      name: label,
      price,
      change: +(price - prev).toFixed(2),
      changeRate: prev
        ? +(((price - prev) / prev) * 100).toFixed(2)
        : 0,
    };
  } catch {
    return null;
  }
}

export const fetchVIX = () => fetchYahoo("^VIX", "VIX");
export const fetchSP500 = () => fetchYahoo("^GSPC", "S&P 500");
export const fetchNASDAQ = () => fetchYahoo("^IXIC", "NASDAQ");
export const fetchUS10Y = () => fetchYahoo("^TNX", "US 10Y");

// ─── CNN Fear & Greed ───
export async function fetchFearGreed(): Promise<FearGreedData | null> {
  try {
    const res = await fetch(
      "https://production.dataviz.cnn.io/index/fearandgreed/graphdata",
      { headers: UA }
    );
    if (!res.ok) return null;
    const d: any = await res.json();
    const fg = d?.fear_and_greed;
    if (!fg) return null;
    return {
      score: Math.round(fg.score || 0),
      rating: fg.rating || "Unknown",
    };
  } catch {
    return null;
  }
}

// ─── 한번에 전부 조회 ───
export async function fetchAllMarketData(): Promise<MarketOverview> {
  const [kospi, kosdaq, usdkrw, vix, fearGreed, sp500, nasdaq, us10y] =
    await Promise.all([
      fetchKOSPI(),
      fetchKOSDAQ(),
      fetchUSDKRW(),
      fetchVIX(),
      fetchFearGreed(),
      fetchSP500(),
      fetchNASDAQ(),
      fetchUS10Y(),
    ]);

  return {
    kospi: kospi ?? undefined,
    kosdaq: kosdaq ?? undefined,
    usdkrw: usdkrw ?? undefined,
    vix: vix ?? undefined,
    fearGreed: fearGreed ?? undefined,
    sp500: sp500 ?? undefined,
    nasdaq: nasdaq ?? undefined,
    us10y: us10y ?? undefined,
  };
}
