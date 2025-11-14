// src/lib/source.ts
import fs from "fs/promises";
import path from "path";
import { createReadStream } from "fs";
import { parse } from "csv-parse";
import dayjs from "dayjs";

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

// ---------- utils ----------
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

async function readCsv<T = any>(file: string): Promise<T[]> {
  const rows: T[] = [];
  const parser = createReadStream(file).pipe(
    parse({ columns: true, trim: true })
  );
  for await (const r of parser) rows.push(r as T);
  return rows;
}

async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

const CACHE_DIR = path.join(process.cwd(), ".cache");

// ---------- adapters (cache first) ----------
type SectorOhlcvRow = { sectorId: string; date: string; close: string };
type SectorVolumeRow = { sectorId: string; date: string; value: string };
type InvestorCsvRow = {
  date: string;
  ticker: string;
  foreign?: string;
  institution?: string;
};
type TickerCsvRow = { code: string; name: string; sectorId?: string };
type SectorMapRow = {
  sectorId: string;
  sectorName: string;
  code: string;
  weight?: string;
};

// fallback: minimal Naver quote scrape for latest close
async function scrapeNaverClose(ticker: string): Promise<number | null> {
  // Very light HTML scraping against Naver Finance quote page.
  // Avoids heavy crawling and respects rate limiting.
  try {
    const res = await fetch(
      `https://finance.naver.com/item/sise.naver?code=${ticker}`,
      {
        headers: { "User-Agent": "Mozilla/5.0" },
        // cache: "no-store",
      }
    );
    if (!res.ok) return null;
    const html = await res.text();
    // naive extract: <span class="blind"> close </span> pattern near wrap.
    const m = html.match(/<span class="blind">([\d,]+)<\/span>\s*<\/strong>/);
    if (!m) return null;
    return parseInt(m[1].replace(/,/g, ""), 10);
  } catch {
    return null;
  }
}

// load sector mapping (sectorId, sectorName, code)
async function loadSectorMap(): Promise<SectorMapRow[]> {
  const f = path.join(CACHE_DIR, "sector_map.csv");
  if (!(await exists(f))) return [];
  return readCsv<SectorMapRow>(f);
}

// load sector level OHLCV summary if present
async function loadSectorOhlcv(): Promise<SectorOhlcvRow[]> {
  const fCsv = path.join(CACHE_DIR, "sector_ohlcv.csv");
  if (await exists(fCsv)) return readCsv<SectorOhlcvRow>(fCsv);
  return [];
}

// load sector volume summary if present
async function loadSectorVolume(): Promise<SectorVolumeRow[]> {
  const fCsv = path.join(CACHE_DIR, "sector_volume.csv");
  if (await exists(fCsv)) return readCsv<SectorVolumeRow>(fCsv);
  return [];
}

// load investor net flows
async function loadInvestorRange(
  from: string,
  to: string
): Promise<InvestorCsvRow[]> {
  // Expect multiple daily files: investor_net_YYYYMMDD.csv
  const days: string[] = [];
  let d = dayjs(from);
  const end = dayjs(to);
  while (d.isBefore(end) || d.isSame(end, "day")) {
    days.push(d.format("YYYYMMDD"));
    d = d.add(1, "day");
  }
  const out: InvestorCsvRow[] = [];
  for (const ymd of days) {
    const f = path.join(CACHE_DIR, `investor_net_${ymd}.csv`);
    if (await exists(f)) {
      const rows = await readCsv<InvestorCsvRow>(f);
      out.push(...rows);
    }
  }
  return out;
}

// load tickers meta
async function loadTickers(): Promise<TickerCsvRow[]> {
  const f = path.join(CACHE_DIR, "tickers.csv");
  if (!(await exists(f))) return [];
  return readCsv<TickerCsvRow>(f);
}

// compute sector close by cap-weight from constituents cache when sector ohlcv missing
type PriceRow = {
  date: string;
  code: string;
  close: string;
  shares?: string;
  mcap?: string;
  value?: string;
};
async function loadPriceSummary(): Promise<PriceRow[]> {
  // optional: daily consolidated prices with market cap or shares to compute weights
  const f = path.join(CACHE_DIR, "prices_daily.csv");
  if (!(await exists(f))) return [];
  return readCsv<PriceRow>(f);
}

// ---------- public API implementations ----------
export async function fetchSectorPriceSeries(
  today: string
): Promise<SectorSeries[]> {
  const [sectorMap, sectorOhlcv, tickers, priceSummary] = await Promise.all([
    loadSectorMap(),
    loadSectorOhlcv(),
    loadTickers(),
    loadPriceSummary(),
  ]);

  const bySector: Record<
    string,
    { id: string; name: string; rows: { date: string; close: number }[] }
  > = {};

  if (sectorOhlcv.length > 0) {
    for (const r of sectorOhlcv) {
      const name =
        sectorMap.find((m) => m.sectorId === r.sectorId)?.sectorName ??
        r.sectorId;
      const close = Number(r.close);
      if (!bySector[r.sectorId])
        bySector[r.sectorId] = { id: r.sectorId, name, rows: [] };
      bySector[r.sectorId].rows.push({ date: r.date, close });
    }
  } else {
    // fallback: compute from constituents using market-cap weights if available, else equal weight
    const byDateSector: Record<
      string,
      Record<string, { num: number; sumWClose: number; sumW: number }>
    > = {};
    const sectorByCode: Record<
      string,
      { sectorId: string; sectorName: string }
    > = {};
    for (const m of sectorMap)
      sectorByCode[m.code] = { sectorId: m.sectorId, sectorName: m.sectorName };

    for (const p of priceSummary) {
      const map = sectorByCode[p.code];
      if (!map) continue;
      const key = `${p.date}::${map.sectorId}`;
      const w = p.mcap ? Number(p.mcap) : 1;
      const close = Number(p.close);
      if (!byDateSector[key]) byDateSector[key] = {};
      if (!byDateSector[key][map.sectorId])
        byDateSector[key][map.sectorId] = { num: 0, sumWClose: 0, sumW: 0 };
      const agg = byDateSector[key][map.sectorId];
      agg.num += 1;
      agg.sumWClose += w * close;
      agg.sumW += w;
    }

    const seen: Record<string, string> = {};
    for (const k of Object.keys(byDateSector)) {
      const [date, sectorId] = k.split("::");
      const agg = byDateSector[k][sectorId];
      const close = agg.sumW > 0 ? agg.sumWClose / agg.sumW : 0;
      const name =
        sectorMap.find((m) => m.sectorId === sectorId)?.sectorName ?? sectorId;
      if (!bySector[sectorId])
        bySector[sectorId] = { id: sectorId, name, rows: [] };
      bySector[sectorId].rows.push({ date, close });
      seen[sectorId] = name;
    }

    // if still empty (no cache at all), attempt last-tick from Naver for each sector via a representative ticker basket
    if (Object.keys(bySector).length === 0 && sectorMap.length > 0) {
      const group: Record<string, SectorMapRow[]> = {};
      for (const m of sectorMap) {
        if (!group[m.sectorId]) group[m.sectorId] = [];
        group[m.sectorId].push(m);
      }
      const date = today;
      for (const sectorId of Object.keys(group)) {
        // pick top 5 by weight if provided
        const picks = group[sectorId]
          .sort((a, b) => Number(b.weight ?? 0) - Number(a.weight ?? 0))
          .slice(0, 5);
        const closes: number[] = [];
        for (const p of picks) {
          const c = await scrapeNaverClose(p.code);
          if (c) closes.push(c);
        }
        if (closes.length > 0) {
          const avg = closes.reduce((a, b) => a + b, 0) / closes.length;
          const name = picks[0]?.sectorName ?? sectorId;
          bySector[sectorId] = {
            id: sectorId,
            name,
            rows: [{ date, close: avg }],
          };
        }
      }
    }
  }

  // sort dates and add SMA
  const out: SectorSeries[] = [];
  for (const sectorId of Object.keys(bySector)) {
    const entry = bySector[sectorId];
    entry.rows.sort((a, b) => (a.date < b.date ? -1 : 1));
    const closes = entry.rows.map((r) => r.close);
    const s20 = sma(closes, 20);
    const s50 = sma(closes, 50);
    const s200 = sma(closes, 200);
    const series: SectorSeriesRow[] = entry.rows.map((r, i) => ({
      date: r.date,
      close: r.close,
      sma20: s20[i],
      sma50: s50[i],
      sma200: s200[i],
    }));
    out.push({ id: entry.id, name: entry.name, series });
  }
  return out;
}

export async function fetchSectorVolumeSeries(
  today: string
): Promise<Record<string, VolumeRow[]>> {
  const [sectorVolume, sectorMap] = await Promise.all([
    loadSectorVolume(),
    loadSectorMap(),
  ]);
  const bySector: Record<string, VolumeRow[]> = {};

  if (sectorVolume.length > 0) {
    for (const r of sectorVolume) {
      if (!bySector[r.sectorId]) bySector[r.sectorId] = [];
      bySector[r.sectorId].push({ date: r.date, value: Number(r.value) });
    }
    for (const k of Object.keys(bySector))
      bySector[k].sort((a, b) => (a.date < b.date ? -1 : 1));
    return bySector;
  }

  // fallback: aggregate from prices_daily.csv (value column as 거래대금), grouped by sector
  const [priceSummary] = await Promise.all([loadPriceSummary()]);
  if (priceSummary.length > 0 && sectorMap.length > 0) {
    const sectorByCode: Record<string, string> = {};
    for (const m of sectorMap) sectorByCode[m.code] = m.sectorId;

    const tmp: Record<string, Record<string, number>> = {};
    for (const p of priceSummary) {
      const sectorId = sectorByCode[p.code];
      if (!sectorId) continue;
      const value = Number(p.value ?? 0);
      if (!tmp[sectorId]) tmp[sectorId] = {};
      tmp[sectorId][p.date] = (tmp[sectorId][p.date] ?? 0) + value;
    }
    for (const sectorId of Object.keys(tmp)) {
      const rows = Object.keys(tmp[sectorId])
        .sort()
        .map((d) => ({ date: d, value: tmp[sectorId][d] }));
      bySector[sectorId] = rows;
    }
    return bySector;
  }

  // last resort: empty
  return {};
}

export async function fetchInvestorNetByTicker(
  from: string,
  to: string
): Promise<InvestorRow[]> {
  const csv = await loadInvestorRange(from, to);
  if (csv.length > 0) {
    return csv.map((r) => ({
      date: r.date,
      ticker: r.ticker,
      foreign: r.foreign != null ? Number(r.foreign) : undefined,
      institution: r.institution != null ? Number(r.institution) : undefined,
    }));
  }
  // If no cache exists, return empty to avoid heavy live scraping in serverless path.
  return [];
}

export async function fetchTickerMetaInSector(
  sectorId: string
): Promise<TickerMeta[]> {
  const [sectorMap, tickers] = await Promise.all([
    loadSectorMap(),
    loadTickers(),
  ]);
  const codes = sectorMap
    .filter((m) => m.sectorId === sectorId)
    .map((m) => m.code);
  const meta: TickerMeta[] = [];
  if (tickers.length > 0) {
    for (const t of tickers) {
      if (codes.includes(t.code)) {
        meta.push({ code: t.code, name: t.name, sectorId });
      }
    }
    return meta;
  }
  // fallback: sectorMap as meta
  return sectorMap
    .filter((m) => m.sectorId === sectorId)
    .map((m) => ({
      code: m.code,
      name: m.sectorName ? `${m.sectorName}:${m.code}` : m.code,
      sectorId,
    }));
}
