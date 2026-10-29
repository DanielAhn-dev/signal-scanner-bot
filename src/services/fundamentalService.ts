import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchRealtimeStockData } from "../utils/fetchRealtimePrice";
import {
  analyzeGrowthRow,
  cagrFromRow,
  clamp,
  findLatestActualAnnualValue,
  forwardGrowthPctFromAnnualRow,
  growthPctFromRow,
  parseNum,
} from "./fundamentalParser";
import {
  normalizeSectorCategory,
  normalizeSectorName,
  resolveFundamentalProfile,
} from "./fundamentalProfile";
import { buildMobileFinance } from "./naverFinanceMobile";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

// 온디맨드 재무 스크래핑이 지연 시 스캔 전체를 막지 않도록 요청 타임아웃을 둡니다.
const FINANCE_FETCH_TIMEOUT_MS = 3000;

type NaverFinanceData = {
  rows: Record<string, string[]>;
  currentPer?: number;
  currentPbr?: number;
  marketCap?: number;
  perFromTable?: number;
  pbrFromTable?: number;
  perFromBlind?: number;
  pbrFromBlind?: number;
  perFromHtml?: number;
  pbrFromHtml?: number;
};

type ValuationMetric = "PER" | "PBR";
type ValuationSource = "rt" | "current" | "table" | "blind" | "html";

function sanitizeValuationCandidate(
  metric: ValuationMetric,
  raw: number | undefined
): { value?: number; reason?: string } {
  if (raw === undefined) return { value: undefined };
  if (!Number.isFinite(raw)) return { value: undefined, reason: "non_finite" };

  if (metric === "PER") {
    if (raw === 0) return { value: undefined, reason: "zero" };
    const abs = Math.abs(raw);
    if (Number.isInteger(abs) && abs >= 1900 && abs <= 2099) {
      return { value: undefined, reason: "year_like" };
    }
    if (abs > 1000) return { value: undefined, reason: "out_of_range" };
    return { value: raw };
  }

  if (raw <= 0) return { value: undefined, reason: "non_positive" };
  if (raw > 1000) return { value: undefined, reason: "out_of_range" };
  return { value: raw };
}

function pickValidatedCandidate(
  metric: ValuationMetric,
  code: string,
  candidates: Array<{ source: ValuationSource; value: number | undefined }>
): { value?: number; source?: ValuationSource } {
  for (const candidate of candidates) {
    if (candidate.value === undefined) continue;

    const sanitized = sanitizeValuationCandidate(metric, candidate.value);
    if (sanitized.value === undefined) {
      console.info(
        `fundamental: reject ${metric} candidate (${code}) source=${candidate.source} raw=${candidate.value} reason=${sanitized.reason || "invalid"}`
      );
      continue;
    }

    return { value: sanitized.value, source: candidate.source };
  }

  return { value: undefined, source: undefined };
}

export type FundamentalSnapshot = {
  sectorName?: string;
  sectorCategory?: string;
  profileLabel?: string;
  profileNote?: string;
  marketCap?: number;
  per?: number;
  pbr?: number;
  roe?: number;
  debtRatio?: number;
  sales?: number;
  opIncome?: number;
  netIncome?: number;
  salesGrowthPct?: number;
  salesGrowthLowBase?: boolean;
  opIncomeGrowthPct?: number;
  opIncomeGrowthLowBase?: boolean;
  opIncomeTurnaround?: boolean;
  netIncomeForwardGrowthPct?: number;
  netIncomeGrowthPct?: number;
  netIncomeCagrPct?: number;
  netIncomeGrowthLowBase?: boolean;
  netIncomeTurnaround?: boolean;
  peg?: number;
  pegSource?: 'net_income_forward' | 'net_income' | 'net_income_cagr' | 'op_income' | 'sales' | null;
  pegGrowthPct?: number;
  qualityScore: number;
  commentary: string;
};

export function resolvePegFromGrowth(input: {
  per?: number;
  netIncomeForwardGrowthPct?: number;
  netIncomeGrowthPct?: number;
  netIncomeCagrPct?: number;
  opIncomeGrowthPct?: number;
  salesGrowthPct?: number;
}): { peg?: number; pegSource?: 'net_income_forward' | 'net_income' | 'net_income_cagr' | 'op_income' | 'sales' | null; pegGrowthPct?: number } {
  const per = Number(input.per ?? NaN);
  if (!Number.isFinite(per) || per <= 0) {
    return { peg: undefined, pegSource: null, pegGrowthPct: undefined };
  }

  const candidates: Array<{ source: 'net_income_forward' | 'net_income' | 'net_income_cagr' | 'op_income' | 'sales'; growthPct?: number }> = [
    { source: 'net_income_forward', growthPct: input.netIncomeForwardGrowthPct },
    { source: 'net_income', growthPct: input.netIncomeGrowthPct },
    { source: 'net_income_cagr', growthPct: input.netIncomeCagrPct },
    { source: 'op_income', growthPct: input.opIncomeGrowthPct },
    { source: 'sales', growthPct: input.salesGrowthPct },
  ];

  for (const candidate of candidates) {
    const growthPct = Number(candidate.growthPct ?? NaN);
    if (!Number.isFinite(growthPct) || growthPct <= 0) continue;
    return {
      peg: Math.round((per / growthPct) * 100) / 100,
      pegSource: candidate.source,
      pegGrowthPct: growthPct,
    };
  }

  return { peg: undefined, pegSource: null, pegGrowthPct: undefined };
}

export function getFundamentalWarningTags(
  snapshot: Pick<
    FundamentalSnapshot,
    | "per"
    | "pbr"
    | "roe"
    | "debtRatio"
    | "netIncome"
    | "salesGrowthPct"
    | "opIncomeGrowthPct"
    | "netIncomeGrowthPct"
    | "salesGrowthLowBase"
    | "opIncomeGrowthLowBase"
    | "opIncomeTurnaround"
    | "netIncomeGrowthLowBase"
    | "netIncomeTurnaround"
  >
): string[] {
  const tags: string[] = [];

  if (snapshot.per !== undefined && snapshot.per < 0) {
    tags.push("적자PER");
  } else if (snapshot.per === undefined && (snapshot.netIncome ?? 0) > 0) {
    tags.push("PER검증");
  }

  if ((snapshot.pbr ?? 0) >= 3 && (snapshot.roe ?? 0) < 8) {
    tags.push("PBR부담");
  }
  if ((snapshot.debtRatio ?? 0) > 200) {
    tags.push("부채부담");
  }
  if (
    (snapshot.salesGrowthPct ?? 0) <= -10 ||
    (snapshot.opIncomeGrowthPct ?? 0) <= -15 ||
    (snapshot.netIncomeGrowthPct ?? 0) <= -20
  ) {
    tags.push("역성장주의");
  }
  if (snapshot.opIncomeTurnaround || snapshot.netIncomeTurnaround) {
    tags.push("턴어라운드");
  }
  if (
    snapshot.salesGrowthLowBase ||
    snapshot.opIncomeGrowthLowBase ||
    snapshot.netIncomeGrowthLowBase
  ) {
    tags.push("기저효과");
  }

  return tags;
}

const sectorMetaCache = new Map<string, { name?: string; category?: string }>();
let supabaseClient: SupabaseClient | null = null;

function getOptionalSupabaseClient(): SupabaseClient | null {
  if (supabaseClient) return supabaseClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  supabaseClient = createClient(url, key);
  return supabaseClient;
}

async function fetchSectorMetaForCode(
  code: string
): Promise<{ name?: string; category?: string }> {
  if (sectorMetaCache.has(code)) {
    return sectorMetaCache.get(code) || {};
  }

  try {
    const client = getOptionalSupabaseClient();
    if (!client) {
      sectorMetaCache.set(code, {});
      return {};
    }

    const { data: stockRow } = await client
      .from("stocks")
      .select("sector_id")
      .eq("code", code)
      .limit(1)
      .maybeSingle();

    const sectorId = stockRow?.sector_id as string | null | undefined;
    if (!sectorId) {
      sectorMetaCache.set(code, {});
      return {};
    }

    const { data: sectorRow } = await client
      .from("sectors")
      .select("name, category")
      .eq("id", sectorId)
      .limit(1)
      .maybeSingle();

    const meta = {
      name: normalizeSectorName(
      (sectorRow?.name as string | undefined) || undefined
      ),
      category: normalizeSectorCategory(
        (sectorRow?.category as string | undefined) || undefined
      ),
    };
    sectorMetaCache.set(code, meta);
    return meta;
  } catch (error) {
    console.error(`fetchSectorMetaForCode failed (${code}):`, error);
    sectorMetaCache.set(code, {});
    return {};
  }
}

export function evaluateFundamentalQuality(input: {
  sectorName?: string;
  sectorCategory?: string;
  per?: number;
  pbr?: number;
  roe?: number;
  debtRatio?: number;
  salesGrowthPct?: number;
  salesGrowthLowBase?: boolean;
  opIncomeGrowthPct?: number;
  opIncomeGrowthLowBase?: boolean;
  opIncomeTurnaround?: boolean;
  netIncomeGrowthPct?: number;
  netIncomeGrowthLowBase?: boolean;
  netIncomeTurnaround?: boolean;
}): { score: number; commentary: string } {
  const profile = resolveFundamentalProfile({
    sectorName: input.sectorName,
    sectorCategory: input.sectorCategory,
  });
  let score = 50;
  const notes: string[] = [];

  if (input.per !== undefined) {
    if (input.per < 0) {
      score -= 12;
      notes.push("적자 구간으로 PER 해석 제한");
    } else if (input.per <= profile.per.attractiveMax) {
      score += 10;
      notes.push("PER 저평가 구간");
    } else if (input.per <= profile.per.neutralMax) {
      score += 3;
      notes.push("PER 중립 구간");
    } else if (input.per >= profile.per.expensiveMin) {
      score -= 10;
      notes.push("PER 고평가 부담");
    }
  }

  if (input.pbr !== undefined) {
    if (input.pbr <= profile.pbr.attractiveMax) {
      score += 8;
      notes.push("PBR 밸류 매력");
    } else if (input.pbr <= profile.pbr.neutralMax) {
      score += 3;
    } else if (input.pbr >= profile.pbr.expensiveMin) {
      if ((input.roe ?? 0) >= profile.roe.strongMin) {
        score -= 3;
        notes.push("PBR은 높지만 ROE가 이를 일부 상쇄");
      } else {
        score -= 8;
        notes.push("PBR 고평가 구간");
      }
    }
  }

  if (input.roe !== undefined) {
    if (input.roe >= profile.roe.strongMin) {
      score += 15;
      notes.push("ROE 우수");
    } else if (input.roe >= profile.roe.solidMin) {
      score += 8;
    } else if (input.roe < profile.roe.weakMax) {
      score -= 10;
      notes.push("ROE 낮음");
    }
  }

  if (input.debtRatio !== undefined) {
    if (input.debtRatio < 80) {
      score += 10;
      notes.push("부채비율 안정");
    } else if (input.debtRatio <= 200) {
      score += 2;
    } else if (input.debtRatio > 250) {
      score -= 12;
      notes.push("부채비율 부담");
    }
  }

  const growthSignals = [
    {
      pct: input.salesGrowthPct,
      lowBase: input.salesGrowthLowBase ?? false,
      turnaround: false,
      label: "매출",
    },
    {
      pct: input.opIncomeGrowthPct,
      lowBase: input.opIncomeGrowthLowBase ?? false,
      turnaround: input.opIncomeTurnaround ?? false,
      label: "영업이익",
    },
    {
      pct: input.netIncomeGrowthPct,
      lowBase: input.netIncomeGrowthLowBase ?? false,
      turnaround: input.netIncomeTurnaround ?? false,
      label: "순이익",
    },
  ].filter((item) => item.pct !== undefined || item.turnaround);

  if (growthSignals.length) {
    const strongPositiveCount = growthSignals.filter(
      (item) => (item.pct ?? 0) >= 15 && !item.lowBase && !item.turnaround
    ).length;
    const positiveCount = growthSignals.filter(
      (item) => (item.pct ?? 0) >= 5 && !item.lowBase && !item.turnaround
    ).length;
    const negativeCount = growthSignals.filter(
      (item) => (item.pct ?? 0) <= -10 && !item.lowBase && !item.turnaround
    ).length;
    const turnaroundCount = growthSignals.filter((item) => item.turnaround).length;
    const lowBaseCount = growthSignals.filter(
      (item) => item.lowBase && Math.abs(item.pct ?? 0) >= 30
    ).length;

    if (strongPositiveCount >= 2) {
      score += 10;
      notes.push("실적 성장세 강함");
    } else if (positiveCount >= 2) {
      score += 6;
      notes.push("실적 개선 흐름");
    } else if (turnaroundCount >= 1) {
      score += 3;
      notes.push("이익 턴어라운드 조짐");
    } else if (negativeCount >= 2) {
      score -= 12;
      notes.push("실적 역성장 구간");
    } else if (positiveCount >= 1 && negativeCount >= 1) {
      notes.push("실적 흐름 혼조");
    }

    if (lowBaseCount >= 1) {
      notes.push("일부 성장률은 낮은 기저 영향 가능성");
    }
  }

  const final = clamp(Math.round(score), 0, 100);
  const commentary = notes.length
    ? notes.join(" · ")
    : "핵심 재무지표 데이터가 제한적이라 중립 판단";

  return { score: final, commentary };
}

async function fetchMobileJson(url: string): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FINANCE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// finance.naver.com 표 대신 모바일 API를 쓴다(옛 페이지는 stock.naver.com 으로 넘어가 값이 전부 비었다)
async function fetchNaverFinanceRows(code: string): Promise<NaverFinanceData> {
  const base = `https://m.stock.naver.com/api/stock/${encodeURIComponent(code)}`;
  const [integration, annual] = await Promise.all([
    fetchMobileJson(`${base}/integration`),
    fetchMobileJson(`${base}/finance/annual`),
  ]);
  const data = buildMobileFinance(integration, annual);
  if (data.currentPer === undefined && data.currentPbr === undefined) {
    console.info(`fundamental: PER/PBR 미발견 (${code}) integration=${integration ? "ok" : "fail"} annual=${annual ? "ok" : "fail"}`);
  }
  return data;
}

export async function getFundamentalSnapshot(code: string): Promise<FundamentalSnapshot> {
  const [rt, financeData, sectorMeta] = await Promise.all([
    fetchRealtimeStockData(code),
    fetchNaverFinanceRows(code),
    fetchSectorMetaForCode(code),
  ]);

  const sectorName = sectorMeta.name;
  const sectorCategory = sectorMeta.category;

  const profile = resolveFundamentalProfile({ sectorName, sectorCategory });

  const {
    rows,
    currentPer,
    currentPbr,
    marketCap,
    perFromTable,
    pbrFromTable,
    perFromBlind,
    pbrFromBlind,
    perFromHtml,
    pbrFromHtml,
  } = financeData;

  const sales = findLatestActualAnnualValue(rows["매출액"] || []);
  const opIncome = findLatestActualAnnualValue(rows["영업이익"] || []);
  const netIncome = findLatestActualAnnualValue(rows["당기순이익"] || []);
  const salesGrowth = analyzeGrowthRow(rows["매출액"] || [], { lowBaseFloor: 3000 });
  const opIncomeGrowth = analyzeGrowthRow(rows["영업이익"] || [], { lowBaseFloor: 500 });
  const netIncomeGrowth = analyzeGrowthRow(rows["당기순이익"] || [], { lowBaseFloor: 500 });
  const salesGrowthPct = salesGrowth.pct ?? growthPctFromRow(rows["매출액"] || []);
  const opIncomeGrowthPct = opIncomeGrowth.pct ?? growthPctFromRow(rows["영업이익"] || []);
  const netIncomeForwardGrowthPct = forwardGrowthPctFromAnnualRow(rows["당기순이익"] || []);
  const netIncomeGrowthPct = netIncomeGrowth.pct ?? growthPctFromRow(rows["당기순이익"] || []);
  const netIncomeCagrPct =
    cagrFromRow(rows["EPS"] || [], 3) ??
    cagrFromRow(rows["당기순이익"] || [], 3);
  const debtRatio = findLatestActualAnnualValue(
    rows["부채비율"] || rows["부채비율(%)"] || rows["부채비율연결"] || []
  );
  const roe = findLatestActualAnnualValue(
    rows["ROE(지배주주)"] || rows["ROE"] || rows["ROE(%)"] || []
  );

  const perPick = pickValidatedCandidate("PER", code, [
    { source: "rt", value: rt?.per },
    { source: "current", value: currentPer },
    { source: "table", value: perFromTable },
    { source: "blind", value: perFromBlind },
    { source: "html", value: perFromHtml },
  ]);
  const pbrPick = pickValidatedCandidate("PBR", code, [
    { source: "rt", value: rt?.pbr },
    { source: "current", value: currentPbr },
    { source: "table", value: pbrFromTable },
    { source: "blind", value: pbrFromBlind },
    { source: "html", value: pbrFromHtml },
  ]);

  let per: number | undefined = perPick.value;
  let pbr: number | undefined = pbrPick.value;

  // PER fallback: rt.price / EPS row 값으로 추정
  if (per === undefined && rt?.price) {
    const epsFromRows = findLatestActualAnnualValue(rows["EPS"] || []);
    if (epsFromRows !== undefined && epsFromRows > 0) {
      const computedPer = rt.price / epsFromRows;
      if (computedPer > 0 && computedPer <= 500) {
        per = Math.round(computedPer * 10) / 10;
        console.info(`fundamental: computed PER from price/EPS for ${code}: ${per}`);
      }
    }
  }

  if (perPick.source && perPick.source !== "rt") {
    console.info(
      `fundamental: selected PER source (${code}) -> ${perPick.source} (${per})`
    );
  }
  if (pbrPick.source && pbrPick.source !== "rt") {
    console.info(
      `fundamental: selected PBR source (${code}) -> ${pbrPick.source} (${pbr})`
    );
  }

  // Final guardrail for any future paths that may bypass candidate filtering.
  if (per !== undefined && (Math.abs(per) > 1000 || per === 0)) {
    console.info(`fundamental: sanitized PER for ${code} (raw=${per}) -> undefined`);
    per = undefined;
  }
  if (pbr !== undefined && (pbr <= 0 || pbr > 1000)) {
    console.info(`fundamental: sanitized PBR for ${code} (raw=${pbr}) -> undefined`);
    pbr = undefined;
  }

  const pegResolved = resolvePegFromGrowth({
    per,
    netIncomeForwardGrowthPct,
    netIncomeGrowthPct,
    netIncomeCagrPct,
    opIncomeGrowthPct,
    salesGrowthPct,
  });

  const quality = evaluateFundamentalQuality({
    sectorName,
    sectorCategory,
    per,
    pbr,
    roe,
    debtRatio,
    salesGrowthPct,
    salesGrowthLowBase: salesGrowth.lowBase,
    opIncomeGrowthPct,
    opIncomeGrowthLowBase: opIncomeGrowth.lowBase,
    opIncomeTurnaround: opIncomeGrowth.turnaround,
    netIncomeGrowthPct,
    netIncomeGrowthLowBase: netIncomeGrowth.lowBase,
    netIncomeTurnaround: netIncomeGrowth.turnaround,
  });

  return {
    sectorName,
    sectorCategory,
    profileLabel: profile.label,
    profileNote: profile.note,
    marketCap,
    per,
    pbr,
    roe,
    debtRatio,
    sales,
    opIncome,
    netIncome,
    salesGrowthPct,
    salesGrowthLowBase: salesGrowth.lowBase,
    opIncomeGrowthPct,
    opIncomeGrowthLowBase: opIncomeGrowth.lowBase,
    opIncomeTurnaround: opIncomeGrowth.turnaround,
    netIncomeGrowthPct,
    netIncomeCagrPct,
    netIncomeGrowthLowBase: netIncomeGrowth.lowBase,
    netIncomeTurnaround: netIncomeGrowth.turnaround,
    peg: pegResolved.peg,
    pegSource: pegResolved.pegSource,
    pegGrowthPct: pegResolved.pegGrowthPct,
    qualityScore: quality.score,
    commentary: quality.commentary,
  };
}
