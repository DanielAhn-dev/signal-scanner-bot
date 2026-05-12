import { createClient } from "@supabase/supabase-js";
import { calculateLongtermScore, type LongtermScoreBreakdown } from "./longtermEngine";

type StockRow = {
  code: string;
  name: string;
  market_cap: number | null;
  sector_id: string | null;
  market: string | null;
};

type FundamentalAnnualRow = {
  code: string;
  as_of: string | null;
  per: number | null;
  pbr: number | null;
  roe: number | null;
  period_type: string | null;
};

type FundamentalTrendRow = {
  code: string;
  period_end: string;
  rev_qoq: number | null;
  op_qoq: number | null;
  rev_acceleration: number | null;
  op_acceleration: number | null;
};

type InvestorDailyRow = {
  ticker: string;
  date: string;
  foreign: number | null;
  institution: number | null;
};

type SectorRow = {
  id: string;
  name: string | null;
  score: number | null;
};

export type DiscoveryPick = {
  code: string;
  name: string;
  sectorId: string | null;
  sectorName: string | null;
  sectorRawScore: number | null;
  marketCap: number;
  pbr: number | null;
  per: number | null;
  roe: number | null;
  revQoq: number | null;
  opQoq: number | null;
  revAcceleration: number | null;
  opAcceleration: number | null;
  smartMoney12w: number;
  smartMoneyRatioPct: number | null;
  score: LongtermScoreBreakdown;
};

const MIN_MARKET_CAP = 50_000_000_000; // 500억
const MIN_ROE = 8;
const MAX_PBR = 2.0;

export type DiscoveryQoqMode = "two-quarter-positive" | "latest-quarter-positive";

export type DiscoveryCriteria = {
  minMarketCap: number;
  minRoe: number;
  maxPbr: number;
  qoqMode: DiscoveryQoqMode;
};

export type DiscoveryFunnel = {
  annualUniverse: number;
  afterMarketCap: number;
  afterValue: number;
  afterTrendData: number;
  afterGrowth: number;
};

export type DiscoveryResult = {
  picks: DiscoveryPick[];
  criteria: DiscoveryCriteria;
  funnel: DiscoveryFunnel;
};

const DEFAULT_DISCOVERY_CRITERIA: DiscoveryCriteria = {
  minMarketCap: MIN_MARKET_CAP,
  minRoe: MIN_ROE,
  maxPbr: MAX_PBR,
  qoqMode: "two-quarter-positive",
};

function sanitizeDiscoveryCriteria(input?: Partial<DiscoveryCriteria>): DiscoveryCriteria {
  const minMarketCap = Number(input?.minMarketCap);
  const minRoe = Number(input?.minRoe);
  const maxPbr = Number(input?.maxPbr);
  const qoqMode = input?.qoqMode === "latest-quarter-positive"
    ? "latest-quarter-positive"
    : "two-quarter-positive";

  return {
    minMarketCap: Number.isFinite(minMarketCap)
      ? Math.max(10_000_000_000, Math.min(5_000_000_000_000, minMarketCap))
      : DEFAULT_DISCOVERY_CRITERIA.minMarketCap,
    minRoe: Number.isFinite(minRoe)
      ? Math.max(0, Math.min(50, minRoe))
      : DEFAULT_DISCOVERY_CRITERIA.minRoe,
    maxPbr: Number.isFinite(maxPbr)
      ? Math.max(0.1, Math.min(10, maxPbr))
      : DEFAULT_DISCOVERY_CRITERIA.maxPbr,
    qoqMode,
  };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function toNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapLatestByCode<T extends { code: string; as_of?: string | null }>(rows: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const row of rows) {
    if (!row.code) continue;
    if (!m.has(row.code)) m.set(row.code, row);
  }
  return m;
}

async function fetchLatestAnnualByCode(
  supabase: any
): Promise<Map<string, FundamentalAnnualRow>> {
  const { data, error } = await supabase
    .from("fundamentals")
    .select("code, as_of, per, pbr, roe, period_type")
    .eq("period_type", "annual")
    .order("as_of", { ascending: false })
    .limit(6000);

  if (error) throw new Error(`annual fundamentals 조회 실패: ${error.message}`);
  return mapLatestByCode((data ?? []) as FundamentalAnnualRow[]);
}

async function fetchLatestTwoTrendsByCode(
  supabase: any,
  codes: string[]
): Promise<Map<string, FundamentalTrendRow[]>> {
  const out = new Map<string, FundamentalTrendRow[]>();
  if (!codes.length) return out;

  const chunks = chunk(codes, 300);
  for (const part of chunks) {
    const { data, error } = await supabase
      .from("fundamental_trends")
      .select("code, period_end, rev_qoq, op_qoq, rev_acceleration, op_acceleration")
      .in("code", part)
      .order("period_end", { ascending: false });

    if (error) throw new Error(`fundamental_trends 조회 실패: ${error.message}`);

    for (const row of (data ?? []) as FundamentalTrendRow[]) {
      const list = out.get(row.code) ?? [];
      if (list.length < 2) list.push(row);
      out.set(row.code, list);
    }
  }

  return out;
}

async function fetchSmartMoney12wByCode(
  supabase: any,
  codes: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!codes.length) return out;

  const since = new Date(Date.now() - 84 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const chunks = chunk(codes, 300);
  for (const part of chunks) {
    const { data, error } = await supabase
      .from("investor_daily")
      .select("ticker, date, foreign, institution")
      .in("ticker", part)
      .gte("date", since);

    if (error) throw new Error(`investor_daily 조회 실패: ${error.message}`);

    for (const row of (data ?? []) as InvestorDailyRow[]) {
      const code = String(row.ticker ?? "");
      if (!code) continue;
      const sum = (out.get(code) ?? 0) + Number(row.foreign ?? 0) + Number(row.institution ?? 0);
      out.set(code, sum);
    }
  }

  return out;
}

export async function discoverMultibagger(
  limit = 20,
  criteriaInput?: Partial<DiscoveryCriteria>
): Promise<DiscoveryResult> {
  const criteria = sanitizeDiscoveryCriteria(criteriaInput);
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error("SUPABASE_URL 또는 SUPABASE 키가 설정되지 않았습니다.");
  }

  const supabase = createClient(
    supabaseUrl,
    supabaseKey
  );

  const annualMap = await fetchLatestAnnualByCode(supabase);
  const codes = [...annualMap.keys()];

  const funnel: DiscoveryFunnel = {
    annualUniverse: codes.length,
    afterMarketCap: 0,
    afterValue: 0,
    afterTrendData: 0,
    afterGrowth: 0,
  };

  if (!codes.length) return { picks: [], criteria, funnel };

  const { data: stocks, error: stockErr } = await supabase
    .from("stocks")
    .select("code, name, market_cap, sector_id, market")
    .in("code", codes)
    .returns<StockRow[]>();

  if (stockErr) throw new Error(`stocks 조회 실패: ${stockErr.message}`);

  const [trendMap, smartMoneyMap, sectorResp] = await Promise.all([
    fetchLatestTwoTrendsByCode(supabase, codes),
    fetchSmartMoney12wByCode(supabase, codes),
    supabase.from("sectors").select("id, name, score").returns<SectorRow[]>(),
  ]);

  if (sectorResp.error) {
    throw new Error(`sectors 조회 실패: ${sectorResp.error.message}`);
  }

  const sectorMetaMap = new Map<string, { name: string | null; score: number | null }>();
  for (const s of sectorResp.data ?? []) {
    sectorMetaMap.set(String(s.id), {
      name: s.name ?? null,
      score: toNum(s.score),
    });
  }

  const picks: DiscoveryPick[] = [];
  for (const stock of stocks ?? []) {
    const annual = annualMap.get(stock.code);
    if (!annual) continue;

    const marketCap = Number(stock.market_cap ?? 0);
    if (!Number.isFinite(marketCap) || marketCap < criteria.minMarketCap) continue;
    funnel.afterMarketCap += 1;

    const pbr = toNum(annual.pbr);
    const roe = toNum(annual.roe);
    const per = toNum(annual.per);
    if (pbr == null || pbr >= criteria.maxPbr) continue;
    if (roe == null || roe <= criteria.minRoe) continue;
    funnel.afterValue += 1;

    const trends = trendMap.get(stock.code) ?? [];
    if (trends.length < 2) continue;
    funnel.afterTrendData += 1;

    const [latest, prev] = trends;
    const latestRev = toNum(latest.rev_qoq);
    const latestOp = toNum(latest.op_qoq);
    const prevRev = toNum(prev.rev_qoq);
    const prevOp = toNum(prev.op_qoq);

    const latestQuarterGrowth =
      latestRev != null && latestRev > 0 &&
      latestOp != null && latestOp > 0;
    const twoQuarterGrowth =
      latestQuarterGrowth &&
      prevRev != null && prevRev > 0 &&
      prevOp != null && prevOp > 0;
    const growthPassed = criteria.qoqMode === "latest-quarter-positive"
      ? latestQuarterGrowth
      : twoQuarterGrowth;
    if (!growthPassed) continue;
    funnel.afterGrowth += 1;

    const smartMoney12w = Number(smartMoneyMap.get(stock.code) ?? 0);
    const smartMoneyRatioPct = marketCap > 0 ? (smartMoney12w / marketCap) * 100 : null;
    const sectorMeta = stock.sector_id ? (sectorMetaMap.get(stock.sector_id) ?? null) : null;
    const sectorScore = sectorMeta?.score ?? null;

    const score = calculateLongtermScore({
      pbr,
      per,
      roe,
      revQoq: latestRev,
      opQoq: latestOp,
      revAcceleration: toNum(latest.rev_acceleration),
      opAcceleration: toNum(latest.op_acceleration),
      smartMoneyRatioPct,
      sectorScore,
    });

    picks.push({
      code: stock.code,
      name: stock.name,
      sectorId: stock.sector_id,
      sectorName: sectorMeta?.name ?? stock.sector_id,
      sectorRawScore: sectorScore,
      marketCap,
      pbr,
      per,
      roe,
      revQoq: latestRev,
      opQoq: latestOp,
      revAcceleration: toNum(latest.rev_acceleration),
      opAcceleration: toNum(latest.op_acceleration),
      smartMoney12w,
      smartMoneyRatioPct,
      score,
    });
  }

  return {
    picks: picks
      .sort((a, b) => b.score.totalScore - a.score.totalScore)
      .slice(0, Math.max(1, Math.min(30, limit))),
    criteria,
    funnel,
  };
}

export async function discoverMultibaggerCandidates(limit = 20): Promise<DiscoveryPick[]> {
  const result = await discoverMultibagger(limit);
  return result.picks;
}
