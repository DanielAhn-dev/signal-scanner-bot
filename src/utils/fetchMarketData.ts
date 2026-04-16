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
  gold?: MarketIndex;
  silver?: MarketIndex;
  copper?: MarketIndex;
  wtiOil?: MarketIndex;
  bitcoin?: MarketIndex;
}

const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" };
const FETCH_TIMEOUT_MS = 3000;

const parsePrice = (s?: string): number => {
  if (!s) return 0;
  return parseFloat(s.replace(/,/g, "")) || 0;
};

async function fetchJsonWithTimeout(url: string): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: UA,
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Naver 국내 지수 ───
async function fetchNaverIndex(
  indexCode: string
): Promise<MarketIndex | null> {
  const d = await fetchJsonWithTimeout(
    `https://m.stock.naver.com/api/index/${indexCode}/basic`
  );
  if (!d) return null;

  return {
    name: d.indexName || d.stockName || indexCode,
    price: parsePrice(d.closePrice),
    change: parsePrice(d.compareToPreviousClosePrice),
    changeRate: parseFloat(d.fluctuationsRatio || "0"),
  };
}

export const fetchKOSPI = () => fetchNaverIndex("KOSPI");
export const fetchKOSDAQ = () => fetchNaverIndex("KOSDAQ");

// ─── 환율 (Yahoo Finance) ───
export async function fetchUSDKRW(): Promise<ExchangeRate | null> {
  try {
    const idx = await fetchYahoo("USDKRW=X", "달러/원");
    if (!idx) return null;
    return {
      code: "FX_USDKRW",
      name: "달러/원",
      price: idx.price,
      change: idx.change,
      changeRate: idx.changeRate,
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
  const enc = encodeURIComponent(symbol);
  const body = await fetchJsonWithTimeout(
    `https://query1.finance.yahoo.com/v8/finance/chart/${enc}?range=1d&interval=1d`
  );
  const meta = body?.chart?.result?.[0]?.meta;
  if (!meta) return null;

  const price = meta.regularMarketPrice || 0;
  const prev = meta.chartPreviousClose || meta.previousClose || price;
  return {
    name: label,
    price,
    change: +(price - prev).toFixed(2),
    changeRate: prev
      ? +(((price - prev) / prev) * 100).toFixed(2)
      : 0,
  };
}

export const fetchVIX = () => fetchYahoo("^VIX", "VIX");
export const fetchSP500 = () => fetchYahoo("^GSPC", "S&P 500");
export const fetchNASDAQ = () => fetchYahoo("^IXIC", "NASDAQ");
export const fetchUS10Y = () => fetchYahoo("^TNX", "US 10Y");

// ─── 원자재 · 에너지 · 암호화폐 ───
export const fetchGold = () => fetchYahoo("GC=F", "Gold");
export const fetchSilver = () => fetchYahoo("SI=F", "Silver");
export const fetchCopper = () => fetchYahoo("HG=F", "Copper");
export const fetchWTI = () => fetchYahoo("CL=F", "WTI Oil");
export const fetchBitcoin = () => fetchYahoo("BTC-USD", "Bitcoin");

// ─── CNN Fear & Greed ───
export async function fetchFearGreed(): Promise<FearGreedData | null> {
  const d = await fetchJsonWithTimeout(
    "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"
  );
  const fg = d?.fear_and_greed;
  if (!fg) return null;

  return {
    score: Math.round(fg.score || 0),
    rating: fg.rating || "Unknown",
  };
}

export async function fetchReportMarketData(): Promise<MarketOverview> {
  const [kospi, kosdaq, usdkrw, vix, fearGreed] = await Promise.all([
    fetchKOSPI(),
    fetchKOSDAQ(),
    fetchUSDKRW(),
    fetchVIX(),
    fetchFearGreed(),
  ]);

  return {
    kospi: kospi ?? undefined,
    kosdaq: kosdaq ?? undefined,
    usdkrw: usdkrw ?? undefined,
    vix: vix ?? undefined,
    fearGreed: fearGreed ?? undefined,
  };
}

// ─── 한번에 전부 조회 ───
export async function fetchAllMarketData(): Promise<MarketOverview> {
  const [
    kospi, kosdaq, usdkrw, vix, fearGreed,
    sp500, nasdaq, us10y,
    gold, silver, copper, wtiOil, bitcoin,
  ] = await Promise.all([
    fetchKOSPI(),
    fetchKOSDAQ(),
    fetchUSDKRW(),
    fetchVIX(),
    fetchFearGreed(),
    fetchSP500(),
    fetchNASDAQ(),
    fetchUS10Y(),
    fetchGold(),
    fetchSilver(),
    fetchCopper(),
    fetchWTI(),
    fetchBitcoin(),
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
    gold: gold ?? undefined,
    silver: silver ?? undefined,
    copper: copper ?? undefined,
    wtiOil: wtiOil ?? undefined,
    bitcoin: bitcoin ?? undefined,
  };
}
