// src/lib/source.ts
import { createClient } from "@supabase/supabase-js";

// Vercel 환경에서 Supabase 클라이언트 초기화
const supa = () =>
  createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!, // anon key 사용
    { auth: { persistSession: false } }
  );

// --- 타입 정의 ---

export type StockPriceRow = {
  date: string;
  close: number;
  sma20?: number;
  sma50?: number;
  sma200?: number;
};
export type StockPriceSeries = {
  code: string;
  name: string;
  series: StockPriceRow[];
};
export type SectorSeriesRow = {
  date: string;
  close: number;
  sma20?: number;
  sma50?: number;
  sma200?: number;
};
export type SectorSeries = {
  id: string;
  name: string;
  series: SectorSeriesRow[];
};
export type VolumeRow = { date: string; value: number };
export type InvestorRow = {
  date: string;
  ticker: string;
  foreign?: number;
  institution?: number;
};
export type TickerMeta = { code: string; name: string; sectorId?: string };

// --- 유틸리티 함수: SMA 계산 ---
function sma(values: number[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(values.length).fill(undefined);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

// --- 데이터 소스 어댑터: Supabase 기반 구현 ---

export async function fetchSectorPriceSeries(
  today: string
): Promise<SectorSeries[]> {
  const { data: sectors } = await supa().from("sectors").select("id, name");
  if (!sectors?.length) return [];

  // 약 1년간의 데이터 조회
  const from = `${new Date(today).getFullYear() - 1}-01-01`;

  const { data: rows } = await supa()
    .from("sector_daily")
    .select("sector_id, date, close")
    .gte("date", from)
    .lte("date", today);

  if (!rows?.length) return [];

  const bySector: Record<string, { date: string; close: number }[]> = {};
  for (const r of rows) {
    if (!bySector[r.sector_id]) bySector[r.sector_id] = [];
    bySector[r.sector_id].push({ date: r.date, close: Number(r.close) });
  }

  const out: SectorSeries[] = [];
  for (const s of sectors) {
    const seriesRaw = (bySector[s.id] || []).sort((a, b) =>
      a.date.localeCompare(b.date)
    );
    if (!seriesRaw.length) continue;

    const closes = seriesRaw.map((r) => r.close);
    const sma20 = sma(closes, 20);
    const sma50 = sma(closes, 50);
    const sma200 = sma(closes, 200);

    const series: SectorSeriesRow[] = seriesRaw.map((r, i) => ({
      date: r.date,
      close: r.close,
      sma20: sma20[i],
      sma50: sma50[i],
      sma200: sma200[i],
    }));
    out.push({ id: s.id, name: s.name, series });
  }
  return out;
}

export async function fetchSectorVolumeSeries(
  today: string
): Promise<Record<string, VolumeRow[]>> {
  const from = `${new Date(today).getFullYear() - 1}-01-01`;
  const { data } = await supa()
    .from("sector_daily")
    .select("sector_id, date, value")
    .gte("date", from)
    .lte("date", today);

  const out: Record<string, VolumeRow[]> = {};
  for (const r of data || []) {
    if (!out[r.sector_id]) out[r.sector_id] = [];
    out[r.sector_id].push({ date: r.date, value: Number(r.value) });
  }
  return out;
}

export async function fetchInvestorNetByTicker(
  from: string,
  to: string
): Promise<InvestorRow[]> {
  const { data } = await supa()
    .from("investor_daily")
    .select('ticker, date, "foreign", institution') // "foreign"은 예약어라 큰따옴표
    .gte("date", from)
    .lte("date", to);

  return (data || []).map((r) => ({
    ticker: r.ticker,
    date: r.date,
    foreign: Number(r.foreign || 0),
    institution: Number(r.institution || 0),
  }));
}

export async function fetchTickerMetaInSector(): Promise<TickerMeta[]> {
  const { data } = await supa().from("stocks").select("code, name, sector_id"); // ✅ where 조건 없이 전체 조회

  return (data || []).map((r) => ({
    code: r.code,
    name: r.name,
    sectorId: r.sector_id,
  }));
}

export async function fetchStockPriceSeries(
  today: string,
  sectorId: string
): Promise<StockPriceSeries[]> {
  // 1. 해당 섹터에 속한 종목 목록을 가져온다.
  const { data: stocks } = await supa()
    .from("stocks")
    .select("code, name")
    .eq("sector_id", sectorId);
  if (!stocks?.length) return [];

  const tickers = stocks.map((s) => s.code);

  // 2. 해당 종목들의 시세 데이터를 가져온다.
  const from = `${new Date(today).getFullYear() - 1}-01-01`;
  const { data: rows } = await supa()
    .from("stock_daily") // 'stock_daily' 테이블 사용
    .select("ticker, date, close")
    .in("ticker", tickers)
    .gte("date", from)
    .lte("date", today);

  if (!rows?.length) return [];

  // 3. 종목별로 시세 데이터를 묶고 SMA 계산
  const byTicker: Record<string, { date: string; close: number }[]> = {};
  for (const r of rows) {
    if (!byTicker[r.ticker]) byTicker[r.ticker] = [];
    byTicker[r.ticker].push({ date: r.date, close: Number(r.close) });
  }

  const out: StockPriceSeries[] = [];
  for (const s of stocks) {
    const seriesRaw = (byTicker[s.code] || []).sort((a, b) =>
      a.date.localeCompare(b.date)
    );
    if (!seriesRaw.length) continue;

    const closes = seriesRaw.map((r) => r.close);
    const sma20 = sma(closes, 20);
    const sma50 = sma(closes, 50);
    const sma200 = sma(closes, 200);

    const series: StockPriceRow[] = seriesRaw.map((r, i) => ({
      date: r.date,
      close: r.close,
      sma20: sma20[i],
      sma50: sma50[i],
      sma200: sma200[i],
    }));
    out.push({ code: s.code, name: s.name, series });
  }
  return out;
}
