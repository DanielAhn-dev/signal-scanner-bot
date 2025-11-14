// src/lib/source.ts
import { createClient } from "@supabase/supabase-js";

const supa = () =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });

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

// 단순 SMA 계산
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

export async function fetchSectorPriceSeries(
  today: string
): Promise<SectorSeries[]> {
  const { data: sectors } = await supa().from("sectors").select("id,name");
  if (!sectors || !sectors.length) return [];

  const { data: rows } = await supa()
    .from("sector_daily")
    .select("sector_id,date,close")
    .lte("date", today)
    .gte("date", today.slice(0, 4) + "-01-01"); // 올해 것만 예시

  if (!rows || !rows.length) return [];

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
  const { data } = await supa()
    .from("sector_daily")
    .select("sector_id,date,value")
    .lte("date", today)
    .gte("date", today.slice(0, 4) + "-01-01");
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
    .select("date,ticker,foreign,institution")
    .gte("date", from)
    .lte("date", to);
  return (data || []).map((r) => ({
    date: r.date,
    ticker: r.ticker,
    foreign: Number(r.foreign || 0),
    institution: Number(r.institution || 0),
  }));
}

export async function fetchTickerMetaInSector(
  sectorId: string
): Promise<TickerMeta[]> {
  const { data } = await supa()
    .from("stocks")
    .select("code,name,sector_id")
    .eq("sector_id", sectorId);
  return (data || []).map((r) => ({
    code: r.code,
    name: r.name,
    sectorId: r.sector_id,
  }));
}
