import type { SupabaseClient } from "@supabase/supabase-js";
import type { SectorScore } from "../lib/sectors";
import { getUserInvestmentPrefs } from "./userService";
import { fetchLatestScoresByCodes } from "./scoreSourceService";
import { getSafetyPreferenceScore, pickSaferCandidates, type RiskProfile } from "../lib/investableUniverse";
import { computeDynamicLargeCapFloor, detectAutoTradeMarketPolicy, resolveDeployableCash } from "./virtualAutoTradeSelection";
import type { MarketOverview } from "../utils/fetchMarketData";
import { fetchAllMarketData } from "../utils/fetchMarketData";

export type SectorFlowInsightRow = {
  name: string;
  foreignFlow: number;
  instFlow: number;
  totalFlow: number;
};

const LARGE_CAP_KEYWORDS = [
  "코스피 200",
  "코스피200",
  "TOP 10",
  "비중상한",
  "전기전자",
  "대형주",
];

const GROWTH_KEYWORDS = [
  "코스닥",
  "기술",
  "정보기술",
  "헬스케어",
  "산업재",
  "기계",
  "전자장비",
  "성장",
];

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function joinNames(items: string[], fallback: string): string {
  const filtered = items.filter(Boolean).slice(0, 3);
  return filtered.length ? filtered.join(", ") : fallback;
}

function buildTopFlowNames(rows: SectorFlowInsightRow[], kind: "positive" | "negative"): string[] {
  return rows
    .filter((row) => (kind === "positive" ? row.totalFlow > 0 : row.totalFlow < 0))
    .sort((a, b) => (kind === "positive" ? b.totalFlow - a.totalFlow : a.totalFlow - b.totalFlow))
    .slice(0, 3)
    .map((row) => row.name);
}

export function buildFlowInsightLines(rows: SectorFlowInsightRow[]): string[] {
  const activeRows = rows.filter((row) => row.totalFlow !== 0);
  if (!activeRows.length) {
    return ["뚜렷한 수급 축이 약해, 숫자보다 개별 종목 거래대금과 추세 확인이 더 중요합니다."];
  }

  const foreignTotal = activeRows.reduce((sum, row) => sum + row.foreignFlow, 0);
  const instTotal = activeRows.reduce((sum, row) => sum + row.instFlow, 0);
  const foreignLargeCap = activeRows
    .filter((row) => includesAny(row.name, LARGE_CAP_KEYWORDS))
    .reduce((sum, row) => sum + row.foreignFlow, 0);
  const foreignGrowth = activeRows
    .filter((row) => includesAny(row.name, GROWTH_KEYWORDS))
    .reduce((sum, row) => sum + row.foreignFlow, 0);
  const instLargeCap = activeRows
    .filter((row) => includesAny(row.name, LARGE_CAP_KEYWORDS))
    .reduce((sum, row) => sum + row.instFlow, 0);
  const instGrowth = activeRows
    .filter((row) => includesAny(row.name, GROWTH_KEYWORDS))
    .reduce((sum, row) => sum + row.instFlow, 0);
  const positiveNames = buildTopFlowNames(activeRows, "positive");
  const negativeNames = buildTopFlowNames(activeRows, "negative");
  const lines: string[] = [];

  if (foreignLargeCap < 0 && foreignGrowth > 0 && instLargeCap > 0) {
    lines.push("외국인은 대형지수 비중을 줄이면서 성장·설비 쪽으로 옮기고, 기관은 대형주를 받아내며 함께 담는 재배치 흐름으로 읽힙니다.");
  } else if (foreignTotal < 0 && instTotal > 0) {
    lines.push("외국인 매도를 기관이 흡수하는 구조라, 지수는 버틸 수 있어도 체감 강도는 종목별로 갈릴 가능성이 큽니다.");
  } else if (foreignTotal > 0 && instTotal > 0) {
    lines.push("외국인과 기관이 같은 방향으로 유입되는 구간이라, 시장 전체 수급은 비교적 우호적인 편입니다.");
  } else if (foreignTotal < 0 && instTotal < 0) {
    lines.push("외국인과 기관이 모두 보수적으로 움직여, 지금 장은 공격보다 방어와 선별 대응이 더 자연스럽습니다.");
  } else if (foreignTotal > 0 && instTotal < 0) {
    lines.push("외국인이 주도하는 반등 성격이 강해, 추세는 나올 수 있어도 기관 확인 매수 전까지는 변동성이 큰 편입니다.");
  }

  if (positiveNames.length || negativeNames.length) {
    lines.push(`강하게 받는 쪽은 ${joinNames(positiveNames, "뚜렷한 상단 섹터 없음")}이고, 상대적으로 약한 쪽은 ${joinNames(negativeNames, "뚜렷한 하단 섹터 없음")}입니다.`);
  }

  if (instLargeCap > 0 && instGrowth > 0 && foreignLargeCap < 0) {
    lines.push("한쪽이 일방적으로 끌어올리는 장이라기보다, 기관이 지수 하단을 받치고 외국인은 섹터 로테이션을 만드는 장에 가깝습니다.");
  } else if (positiveNames.length >= 2 && Math.sign(foreignTotal || 1) === Math.sign(instTotal || 1)) {
    lines.push("따라서 지금은 시장 전체 방향보다 실제 자금이 붙는 섹터와 그 안의 대표 종목을 좁혀서 보는 편이 효율적입니다.");
  }

  return lines.slice(0, 3);
}

export function buildMarketInsightLines(input: {
  market: MarketOverview;
  riskScore: number;
  regimeLabel: string;
  topSectors: Array<{ name: string }>;
  nextSectors: Array<{ name: string }>;
}): string[] {
  const { market, riskScore, regimeLabel, topSectors, nextSectors } = input;
  const lines: string[] = [];
  const leadNames = topSectors.slice(0, 3).map((sector) => sector.name);
  const nextNames = nextSectors.slice(0, 2).map((sector) => sector.name);
  const vix = Number(market.vix?.price ?? 0);
  const usdkrw = Number(market.usdkrw?.price ?? 0);

  if (riskScore >= 70) {
    lines.push(`지금 장은 ${regimeLabel} 쪽 해석이 맞습니다. 시장 전체를 넓게 사기보다 방어와 현금 여력을 우선 두는 편이 안전합니다.`);
  } else if (riskScore <= 40) {
    lines.push(`지금 장은 ${regimeLabel} 쪽입니다. 다만 지수 전체 추격보다 실제로 자금이 붙는 섹터를 따라가는 편이 효율적입니다.`);
  } else {
    lines.push(`지금 장은 ${regimeLabel}과 관망 사이의 중간 구간입니다. 방향성은 열려 있지만, 아무 섹터나 따라가기는 애매한 환경입니다.`);
  }

  if (leadNames.length) {
    let line = `현재 수급 중심은 ${joinNames(leadNames, "상위 섹터 확인 중")}입니다.`;
    if (nextNames.length) {
      line += ` 다음 후보로는 ${joinNames(nextNames, "후보 확인 중")}가 보입니다.`;
    }
    lines.push(line);
  }

  if (vix >= 20 || usdkrw >= 1400) {
    lines.push("변동성과 환율 부담이 완전히 풀린 장은 아니라서, 신규 진입은 분할 접근과 손절 기준을 함께 가져가는 편이 맞습니다.");
  } else if (riskScore <= 40) {
    lines.push("거시 부담이 상대적으로 덜해, 주도 섹터 대표주 중심으로만 천천히 비중을 늘리는 전략이 무리하지 않습니다.");
  }

  return lines.slice(0, 3);
}

export function buildEconomyInsightLines(market: MarketOverview): string[] {
  const lines: string[] = [];
  const vix = Number(market.vix?.price ?? 0);
  const us10y = Number(market.us10y?.price ?? 0);
  const usdkrw = Number(market.usdkrw?.price ?? 0);
  const fearGreed = Number(market.fearGreed?.score ?? 50);

  if (vix >= 30 || us10y >= 5 || usdkrw >= 1450) {
    lines.push("거시 변수는 아직 방어 우위 구간입니다. 공격적으로 확장하기보다 비중 조절과 손실 제한을 먼저 점검하는 편이 자연스럽습니다.");
  } else if (vix >= 20 || us10y >= 4.5 || usdkrw >= 1400) {
    lines.push("거시 환경은 완전한 위험선호보다 경계에 가깝습니다. 신규 진입은 가능해도 분할 접근과 확인 매수가 전제돼야 합니다.");
  } else {
    lines.push("거시 지표만 놓고 보면 시장을 막을 정도의 큰 압박은 아닙니다. 다만 공격적 확장보다 강한 섹터 위주 선별 대응이 여전히 유리합니다.");
  }

  if (fearGreed <= 25) {
    lines.push("심리는 공포 쪽이라, 숫자만 나쁘다고 바로 비관하기보다 과매도 반등 후보를 함께 봐야 하는 구간입니다.");
  } else if (fearGreed >= 75) {
    lines.push("심리는 탐욕 쪽에 가까워, 좋은 지표가 나와도 추격 매수보다 분할 익절과 재진입 가격 관리가 더 중요합니다.");
  }

  if (usdkrw >= 1400 && vix >= 20) {
    lines.push("환율과 변동성이 같이 높으면 외국인 수급이 흔들리기 쉬워, 대형주도 안심 구간으로 보기 어렵습니다.");
  } else if (vix < 20 && us10y < 4.5) {
    lines.push("변동성과 금리 부담이 심하지 않아, 실전에서는 시장 전체보다 어떤 업종에 자금이 붙는지 확인하는 단계로 넘어가면 됩니다.");
  }

  return lines.slice(0, 3);
}

export function buildSectorInsightLines(sectors: SectorScore[]): string[] {
  if (!sectors.length) {
    return ["섹터 강도 데이터가 부족해, 당장은 종목별 거래대금과 가격 구조를 우선 확인하는 편이 낫습니다."];
  }

  const leader = sectors[0];
  const second = sectors[1];
  const topNames = sectors.slice(0, 3).map((sector) => sector.name);
  const lines: string[] = [];
  const gap = leader && second ? Number(leader.score) - Number(second.score) : 0;

  if (leader && second && gap >= 8) {
    lines.push(`${leader.name}가 확실한 선두라, 지금은 테마 확산보다 1등 섹터 집중 장세에 더 가깝습니다.`);
  } else if (topNames.length >= 3) {
    lines.push(`상위 섹터 간 점수 차가 크지 않아 ${joinNames(topNames, "상위 섹터")} 중심의 순환매가 빠르게 돌 수 있습니다.`);
  }

  if (leader) {
    const flowParts: string[] = [];
    if (leader.flowF5) flowParts.push(`외국인 ${leader.flowF5 > 0 ? "유입" : "이탈"}`);
    if (leader.flowI5) flowParts.push(`기관 ${leader.flowI5 > 0 ? "유입" : "이탈"}`);
    if (flowParts.length) {
      lines.push(`${leader.name}는 강도뿐 아니라 ${flowParts.join(", ")}이 같이 보이는지 확인하면 추세 신뢰도를 더 빨리 가늠할 수 있습니다.`);
    }
  }

  lines.push("따라서 지금은 하위 테마를 넓게 추격하기보다, 상위 섹터 대표 종목 안에서 진입 자리를 고르는 편이 더 안정적입니다.");
  return lines.slice(0, 3);
}

type StockRow = {
  code: string;
  name: string;
  market: string | null;
  sector_id: string | null;
  close: number | null;
  liquidity: number | null;
  market_cap: number | null;
  universe_level: string | null;
  is_sector_leader: boolean | null;
};

type IndicatorRow = {
  code: string;
  close: number | null;
  value_traded: number | null;
  rsi14: number | null;
  roc14: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  trade_date: string | null;
};

type PickCandidate = {
  code: string;
  name: string;
  market: string;
  sectorName: string | null;
  price: number;
  score: number;
  totalScore: number;
  momentumScore: number;
  valueScore: number;
  safetyScore: number;
  trendLabel: string;
  rsi14: number;
  valueTraded: number;
};

type PullbackRow = {
  code: string;
  entry_grade: "A" | "B" | "C" | "D";
  entry_score: number;
  warn_grade: "SAFE" | "WATCH" | "WARN" | "SELL";
  warn_score: number;
  stock: {
    name: string;
    close: number | null;
    market?: string | null;
    sector_id?: string | null;
    sector_name?: string | null;
    liquidity?: number | null;
    universe_level?: string | null;
  };
};

type SectorNameRow = {
  id: string;
  name: string;
};

type CandidateGroupRow = {
  sectorName: string;
  type: "market" | "pullback";
  code: string;
  name: string;
  score: number;
  trendLabel?: string;
  market: string;
  entryGrade?: string;
  warnGrade?: string;
};

type PlanningConstraints = {
  displayLimit: number;
  blockedNewEntry: boolean;
  deployableCash: number;
  availableCash: number;
  holdingCount: number;
  dayLossReached: boolean;
  statusLines: string[];
};

const DEFAULT_DAILY_LOSS_LIMIT_PCT = 5;

function clampDailyCandidateValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function fmtDailyCandidateInt(value: number): string {
  return Math.round(value || 0).toLocaleString("ko-KR");
}

function fmtDailyCandidatePct(value: number | null | undefined): string {
  const safe = Number(value ?? 0);
  return `${safe >= 0 ? "+" : ""}${safe.toFixed(1)}%`;
}

function fmtDailyCandidateKrwShort(value: number): string {
  const safe = Number(value || 0);
  if (!Number.isFinite(safe) || safe <= 0) return "-";
  const eok = Math.floor(safe / 100_000_000);
  const jo = Math.floor(eok / 10_000);
  const restEok = eok % 10_000;
  if (jo > 0) return restEok > 0 ? `${jo}조 ${restEok.toLocaleString("ko-KR")}억` : `${jo}조`;
  return `${eok.toLocaleString("ko-KR")}억`;
}

function getKstDayRangeForPlan(reference = new Date()): { startIso: string; endIso: string } {
  const dayMs = 24 * 60 * 60 * 1000;
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const kstNowMs = reference.getTime() + kstOffsetMs;
  const kstStartMs = Math.floor(kstNowMs / dayMs) * dayMs;
  const utcStartMs = kstStartMs - kstOffsetMs;
  return {
    startIso: new Date(utcStartMs).toISOString(),
    endIso: new Date(utcStartMs + dayMs).toISOString(),
  };
}

function riskProfileLabel(profile: RiskProfile): string {
  if (profile === "balanced") return "균형형";
  if (profile === "active") return "공격형";
  return "안전형";
}

function getDailyCandidateTrendLabel(price: number, sma20: number, sma50: number, sma200: number): string {
  if (price > sma20 && sma20 > sma50 && sma50 > sma200 && sma200 > 0) return "정배열 상승";
  if (price > sma50 && sma50 > sma200 && sma200 > 0) return "상승 우위";
  if (price > sma20 && sma20 > 0) return "단기 지지";
  return "추세 확인";
}

function getDailyCandidateTrendScore(price: number, sma20: number, sma50: number, sma200: number): number {
  let score = 0;
  if (price > sma20 && sma20 > 0) score += 22;
  if (price > sma50 && sma50 > 0) score += 22;
  if (price > sma200 && sma200 > 0) score += 16;
  if (sma20 > sma50 && sma50 > sma200 && sma200 > 0) score += 28;
  return clampDailyCandidateValue(score, 0, 100);
}

function getDailyCandidateLiquidityScore(valueTraded: number): number {
  if (valueTraded >= 150_000_000_000) return 100;
  if (valueTraded >= 80_000_000_000) return 85;
  if (valueTraded >= 30_000_000_000) return 70;
  if (valueTraded >= 10_000_000_000) return 55;
  if (valueTraded >= 3_000_000_000) return 35;
  return 10;
}

function getDailyCandidateRsiPenalty(rsi14: number): number {
  if (rsi14 >= 70) return -8;
  if (rsi14 <= 30) return -6;
  if (rsi14 >= 43 && rsi14 <= 66) return 5;
  return 0;
}

async function fetchIndicatorsByCodesForDailyCandidates(
  supabase: SupabaseClient,
  codes: string[]
): Promise<Map<string, IndicatorRow>> {
  const out = new Map<string, IndicatorRow>();
  if (!codes.length) return out;

  const { data, error } = await supabase
    .from("daily_indicators")
    .select("code, close, value_traded, rsi14, roc14, sma20, sma50, sma200, trade_date")
    .in("code", codes)
    .order("trade_date", { ascending: false })
    .limit(Math.max(300, codes.length * 3));

  if (error) {
    throw new Error(`지표 조회 실패: ${error.message}`);
  }

  for (const row of (data ?? []) as IndicatorRow[]) {
    if (!out.has(row.code)) out.set(row.code, row);
  }

  return out;
}

async function fetchSectorNameMap(
  supabase: SupabaseClient,
  sectorIds: Array<string | null | undefined>
): Promise<Map<string, string>> {
  const ids = [...new Set(sectorIds.filter((sectorId): sectorId is string => Boolean(sectorId)))];
  const out = new Map<string, string>();
  if (!ids.length) return out;

  const { data, error } = await supabase
    .from("sectors")
    .select("id, name")
    .in("id", ids)
    .returns<SectorNameRow[]>();

  if (error) {
    throw new Error(`섹터 이름 조회 실패: ${error.message}`);
  }

  for (const row of data ?? []) {
    out.set(row.id, row.name);
  }
  return out;
}

async function getDailyRealizedPnlForPlan(
  supabase: SupabaseClient,
  chatId: number
): Promise<number> {
  const { startIso, endIso } = getKstDayRangeForPlan();
  const { data, error } = await supabase
    .from("virtual_trades")
    .select("pnl_amount")
    .eq("chat_id", chatId)
    .gte("traded_at", startIso)
    .lt("traded_at", endIso);

  if (error) {
    throw new Error(`당일 손익 조회 실패: ${error.message}`);
  }

  return (data ?? []).reduce((sum, row: any) => {
    const pnl = Number(row?.pnl_amount ?? 0);
    return Number.isFinite(pnl) ? sum + pnl : sum;
  }, 0);
}

async function getHoldingCountForPlan(
  supabase: SupabaseClient,
  chatId: number
): Promise<number> {
  const { data, error } = await supabase
    .from("watchlist")
    .select("buy_price, quantity")
    .eq("chat_id", chatId);

  if (error) {
    throw new Error(`보유 수량 조회 실패: ${error.message}`);
  }

  return (data ?? []).filter((row: any) => {
    const buyPrice = Number(row?.buy_price ?? 0);
    const quantity = Math.max(0, Math.floor(Number(row?.quantity ?? 0)));
    return buyPrice > 0 && quantity > 0;
  }).length;
}

async function resolvePlanningConstraints(
  supabase: SupabaseClient,
  input: { chatId?: number; marketReservePct: number }
): Promise<PlanningConstraints | null> {
  if (!input.chatId) return null;

  const prefs = await getUserInvestmentPrefs(input.chatId);
  const seedCapital = Math.max(0, Number(prefs.virtual_seed_capital ?? prefs.capital_krw ?? 0));
  const availableCash = Math.max(
    0,
    Number(prefs.virtual_cash ?? prefs.virtual_seed_capital ?? prefs.capital_krw ?? 0)
  );

  const [dailyRealizedPnl, holdingCount] = await Promise.all([
    getDailyRealizedPnlForPlan(supabase, input.chatId).catch(() => 0),
    getHoldingCountForPlan(supabase, input.chatId).catch(() => 0),
  ]);

  const dailyLossLimitPct = Number(prefs.daily_loss_limit_pct ?? DEFAULT_DAILY_LOSS_LIMIT_PCT);
  const dailyLossLimitAmount =
    seedCapital > 0 && dailyLossLimitPct > 0 ? (seedCapital * dailyLossLimitPct) / 100 : 0;
  const dayLossReached = dailyLossLimitAmount > 0 && dailyRealizedPnl <= -dailyLossLimitAmount;
  const deployableCash = resolveDeployableCash({
    availableCash,
    seedCapital,
    minCashReservePct: input.marketReservePct,
  });

  let displayLimit = 5;
  if (dayLossReached) {
    displayLimit = 1;
  } else if (deployableCash <= 0) {
    displayLimit = 2;
  } else if (seedCapital > 0) {
    const deployableRatio = deployableCash / Math.max(seedCapital, 1);
    if (deployableRatio < 0.08) displayLimit = 2;
    else if (deployableRatio < 0.16) displayLimit = 3;
    else if (deployableRatio < 0.28) displayLimit = 4;
  }

  if (holdingCount >= 6) displayLimit = Math.min(displayLimit, 2);
  else if (holdingCount >= 4) displayLimit = Math.min(displayLimit, 3);

  const statusLines: string[] = [];
  if (dayLossReached) {
    statusLines.push(
      `오늘 일손실 한도 도달: 실현손익 ${fmtDailyCandidateInt(dailyRealizedPnl)}원 / 한도 -${fmtDailyCandidateInt(dailyLossLimitAmount)}원`
    );
    statusLines.push("오늘은 신규 진입 수를 최소화하고 보유 리스크 점검 위주로 대응하세요.");
  } else {
    statusLines.push(`가용현금 ${fmtDailyCandidateInt(availableCash)}원 · 신규 투입 가능 ${fmtDailyCandidateInt(deployableCash)}원`);
    statusLines.push(`현재 보유 ${holdingCount}종목 기준으로 오늘 검토 후보는 ${displayLimit}개 수준으로 압축합니다.`);
  }

  return {
    displayLimit,
    blockedNewEntry: dayLossReached,
    deployableCash,
    availableCash,
    holdingCount,
    dayLossReached,
    statusLines,
  };
}

function buildSectorTemplateLines(input: {
  pullbackItems: PullbackRow[];
  kospiPicks: PickCandidate[];
  kosdaqPicks: PickCandidate[];
}): string[] {
  const grouped = new Map<string, CandidateGroupRow[]>();
  const push = (sectorName: string | null | undefined, row: CandidateGroupRow) => {
    const key = String(sectorName ?? "").trim();
    if (!key) return;
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  };

  input.kospiPicks.forEach((item) =>
    push(item.sectorName, {
      sectorName: item.sectorName ?? "",
      type: "market",
      code: item.code,
      name: item.name,
      score: item.score,
      trendLabel: item.trendLabel,
      market: item.market,
    })
  );
  input.kosdaqPicks.forEach((item) =>
    push(item.sectorName, {
      sectorName: item.sectorName ?? "",
      type: "market",
      code: item.code,
      name: item.name,
      score: item.score,
      trendLabel: item.trendLabel,
      market: item.market,
    })
  );
  input.pullbackItems.forEach((item) =>
    push(item.stock?.sector_name, {
      sectorName: item.stock?.sector_name ?? "",
      type: "pullback",
      code: item.code,
      name: item.stock?.name ?? item.code,
      score: Number(item.entry_score ?? 0),
      market: String(item.stock?.market ?? ""),
      entryGrade: item.entry_grade,
      warnGrade: item.warn_grade,
    })
  );

  return [...grouped.entries()]
    .map(([sectorName, rows]) => {
      const representative = rows
        .filter((row) => row.type === "market")
        .sort((a, b) => b.score - a.score)[0] ?? [...rows].sort((a, b) => b.score - a.score)[0];
      const waiting = rows.find((row) => row.type === "pullback" && row.code !== representative?.code)
        ?? rows.find((row) => row.code !== representative?.code);
      return { sectorName, count: rows.length, representative, waiting };
    })
    .sort((a, b) => b.count - a.count || Number(b.representative?.score ?? 0) - Number(a.representative?.score ?? 0))
    .slice(0, 3)
    .map((group, index) => {
      const rep = group.representative
        ? `대표 ${group.representative.name}(${group.representative.code}) · ${group.representative.type === "market" ? `${group.representative.trendLabel} · 종합 ${group.representative.score.toFixed(1)}` : `진입 ${group.representative.entryGrade} · 경고 ${group.representative.warnGrade}`}`
        : "대표 후보 없음";
      const wait = group.waiting
        ? `대기 ${group.waiting.name}(${group.waiting.code}) · ${group.waiting.type === "pullback" ? `진입 ${group.waiting.entryGrade} · 경고 ${group.waiting.warnGrade}` : `${group.waiting.trendLabel} · 종합 ${group.waiting.score.toFixed(1)}`}`
        : "대기 후보 없음";
      return `${index + 1}. ${group.sectorName}\n   ${rep}\n   ${wait}`;
    });
}

async function fetchMarketPickCandidatesForDailyPlan(
  supabase: SupabaseClient,
  market: "KOSPI" | "KOSDAQ",
  riskProfile: RiskProfile
): Promise<PickCandidate[]> {
  const marketOverview = await fetchAllMarketData().catch(() => null);
  const marketPolicy = detectAutoTradeMarketPolicy({ overview: marketOverview });
  if (!marketPolicy.allowedMarkets.includes(market)) {
    return [];
  }

  const { data: stocks, error: stocksError } = await supabase
    .from("stocks")
    .select("code, name, market, sector_id, close, liquidity, market_cap, universe_level, is_sector_leader")
    .eq("is_active", true)
    .eq("market", market)
    .in("universe_level", ["core", "extended"])
    .order("market_cap", { ascending: false })
    .limit(320)
    .returns<StockRow[]>();

  if (stocksError) {
    throw new Error(`${market} 후보 조회 실패: ${stocksError.message}`);
  }

  const rows = stocks ?? [];
  const sectorNameMap = await fetchSectorNameMap(
    supabase,
    rows.map((row) => row.sector_id)
  );
  const codes = rows.map((row) => row.code);
  const [scoreResult, indicatorMap] = await Promise.all([
    fetchLatestScoresByCodes(supabase, codes),
    fetchIndicatorsByCodesForDailyCandidates(supabase, codes),
  ]);

  const ranked = rows
    .map((row) => {
      const indicator = indicatorMap.get(row.code);
      const latestScore = scoreResult.byCode.get(row.code);
      const price = Number(indicator?.close ?? row.close ?? 0);
      const rsi14 = Number(indicator?.rsi14 ?? 50);
      const roc14 = Number(indicator?.roc14 ?? 0);
      const sma20 = Number(indicator?.sma20 ?? price);
      const sma50 = Number(indicator?.sma50 ?? price);
      const sma200 = Number(indicator?.sma200 ?? price);
      const valueTraded = Number(indicator?.value_traded ?? row.liquidity ?? 0);
      const totalScore = clampDailyCandidateValue(Number(latestScore?.total_score ?? 50 + roc14 * 5), 0, 100);
      const momentumScore = clampDailyCandidateValue(Number(latestScore?.momentum_score ?? 50 + roc14 * 7), 0, 100);
      const valueScore = clampDailyCandidateValue(Number(latestScore?.value_score ?? 30), 0, 100);
      const safetyScore = clampDailyCandidateValue(
        getSafetyPreferenceScore(
          {
            code: row.code,
            name: row.name,
            market: row.market,
            universe_level: row.universe_level,
            liquidity: row.liquidity,
            is_sector_leader: row.is_sector_leader,
            total_score: totalScore,
            momentum_score: momentumScore,
            value_score: valueScore,
            rsi14,
            market_cap: row.market_cap,
          },
          riskProfile
        ),
        0,
        100
      );
      const trendScore = getDailyCandidateTrendScore(price, sma20, sma50, sma200);
      const liquidityScore = getDailyCandidateLiquidityScore(valueTraded);
      const score = clampDailyCandidateValue(
        totalScore * 0.42 +
          momentumScore * 0.2 +
          valueScore * 0.08 +
          safetyScore * 0.18 +
          trendScore * 0.07 +
          liquidityScore * 0.05 +
          getDailyCandidateRsiPenalty(rsi14),
        0,
        100
      );

      return {
        code: row.code,
        name: row.name,
        market: String(row.market ?? market),
        sectorName: row.sector_id ? sectorNameMap.get(row.sector_id) ?? null : null,
        price,
        score,
        totalScore,
        momentumScore,
        valueScore,
        safetyScore,
        trendLabel: getDailyCandidateTrendLabel(price, sma20, sma50, sma200),
        rsi14,
        valueTraded,
        marketCap: Number(row.market_cap ?? 0),
        liquidity: Number(row.liquidity ?? 0),
        universeLevel: row.universe_level,
      };
    })
    .filter((row) => row.price > 0)
    .filter((row) => row.valueTraded >= marketPolicy.minLiquidity);

  const largeCapFloor = marketPolicy.requireLargeCapKospi
    ? computeDynamicLargeCapFloor(
        ranked.map((row) => ({
          code: row.code,
          close: row.price,
          score: row.score,
          name: row.name,
          market: row.market,
          marketCap: row.marketCap,
          liquidity: row.liquidity,
          universeLevel: row.universeLevel,
        })),
        100
      )
    : 0;

  const filtered = ranked.filter((row) => {
    if (market === "KOSPI" && marketPolicy.requireLargeCapKospi) {
      return row.marketCap >= Math.max(marketPolicy.minMarketCap, largeCapFloor);
    }
    return true;
  });

  return pickSaferCandidates(filtered, 5, riskProfile).sort((a, b) => b.score - a.score);
}

async function fetchPullbackCandidatesForDailyPlan(
  supabase: SupabaseClient,
  riskProfile: RiskProfile
): Promise<{ latestDate: string | null; items: PullbackRow[] }> {
  const { data: latestRows, error: latestError } = await supabase
    .from("pullback_signals")
    .select("trade_date")
    .order("trade_date", { ascending: false })
    .limit(1);

  if (latestError) {
    throw new Error(`눌림목 기준일 조회 실패: ${latestError.message}`);
  }

  const latestDate = latestRows?.[0]?.trade_date ?? null;
  if (!latestDate) {
    return { latestDate: null, items: [] };
  }

  const { data, error } = await supabase
    .from("pullback_signals")
    .select("code, entry_grade, entry_score, warn_grade, warn_score, stock:stocks!inner(name, close, market, sector_id, liquidity, universe_level)")
    .eq("trade_date", latestDate)
    .in("entry_grade", ["A", "B"])
    .neq("warn_grade", "SELL")
    .order("entry_score", { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(`눌림목 후보 조회 실패: ${error.message}`);
  }

  const sectorNameMap = await fetchSectorNameMap(
    supabase,
    ((data ?? []) as any[]).map((row) => {
      const stock = Array.isArray(row.stock) ? row.stock[0] : row.stock;
      return stock?.sector_id as string | null | undefined;
    })
  );

  const items = ((data ?? []) as any[]).map((row) => ({
    ...row,
    stock: (() => {
      const stock = Array.isArray(row.stock) ? row.stock[0] : row.stock;
      if (!stock) return stock;
      return {
        ...stock,
        sector_name: stock.sector_id ? sectorNameMap.get(stock.sector_id) ?? null : null,
      };
    })(),
    name: Array.isArray(row.stock) ? row.stock[0]?.name : row.stock?.name,
    market: Array.isArray(row.stock) ? row.stock[0]?.market : row.stock?.market,
    liquidity: Array.isArray(row.stock) ? row.stock[0]?.liquidity : row.stock?.liquidity,
    universe_level: Array.isArray(row.stock) ? row.stock[0]?.universe_level : row.stock?.universe_level,
  }));

  return {
    latestDate,
    items: pickSaferCandidates(items, 5, riskProfile) as PullbackRow[],
  };
}

export async function createDailyCandidatePlanningReport(
  supabase: SupabaseClient,
  options?: { riskProfile?: RiskProfile; mode?: "full" | "briefing"; chatId?: number }
): Promise<string> {
  const riskProfile = options?.riskProfile ?? "safe";
  const mode = options?.mode ?? "full";
  const marketOverview = await fetchAllMarketData().catch(() => null);
  const marketPolicy = detectAutoTradeMarketPolicy({ overview: marketOverview });
  const planningConstraints = await resolvePlanningConstraints(supabase, {
    chatId: options?.chatId,
    marketReservePct: marketPolicy.minCashReservePct,
  }).catch(() => null);

  const [pullbackResult, kospiPicks, kosdaqPicks] = await Promise.all([
    fetchPullbackCandidatesForDailyPlan(supabase, riskProfile),
    fetchMarketPickCandidatesForDailyPlan(supabase, "KOSPI", riskProfile),
    fetchMarketPickCandidatesForDailyPlan(supabase, "KOSDAQ", riskProfile),
  ]);

  const marketLines = [
    marketOverview?.kospi
      ? `KOSPI ${fmtDailyCandidateInt(marketOverview.kospi.price)} ${fmtDailyCandidatePct(marketOverview.kospi.changeRate)}`
      : null,
    marketOverview?.kosdaq
      ? `KOSDAQ ${fmtDailyCandidateInt(marketOverview.kosdaq.price)} ${fmtDailyCandidatePct(marketOverview.kosdaq.changeRate)}`
      : null,
    marketOverview?.usdkrw
      ? `달러/원 ${fmtDailyCandidateInt(marketOverview.usdkrw.price)} ${fmtDailyCandidatePct(marketOverview.usdkrw.changeRate)}`
      : null,
  ].filter((line): line is string => Boolean(line));

  const focusLines = [
    `시장모드 ${marketPolicy.label} · ${marketPolicy.reason}`,
    `신규 후보는 ${marketPolicy.allowedMarkets.join("+")} 중심으로 보고, 현금 최소 ${marketPolicy.minCashReservePct}%는 남기는 전제로 계획하세요.`,
    marketPolicy.allowedMarkets.includes("KOSDAQ")
      ? `코스닥은 보조 축으로 유지하고 상위 ${Math.max(1, kosdaqPicks.length)}개만 압축 검토하는 편이 좋습니다.`
      : "오늘은 코스닥 신규 진입보다 코스피 대형주와 눌림목 확인에 집중하는 편이 좋습니다.",
  ];

  const sectorCountMap = new Map<string, number>();
  const addSectorCount = (sectorName?: string | null) => {
    const name = String(sectorName ?? "").trim();
    if (!name) return;
    sectorCountMap.set(name, (sectorCountMap.get(name) ?? 0) + 1);
  };
  pullbackResult.items.forEach((item) => addSectorCount(item.stock?.sector_name));
  kospiPicks.forEach((item) => addSectorCount(item.sectorName));
  kosdaqPicks.forEach((item) => addSectorCount(item.sectorName));
  const sectorFocusLines = [...sectorCountMap.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"))
    .slice(0, 4)
    .map(([name, count], index) => `${index + 1}. ${name} (${count}건)`);
  const sectorTemplateLines = buildSectorTemplateLines({
    pullbackItems: pullbackResult.items,
    kospiPicks,
    kosdaqPicks,
  });
  const displayLimit = Math.max(1, planningConstraints?.displayLimit ?? 5);

  const pullbackLines = pullbackResult.items.length
    ? pullbackResult.items.slice(0, displayLimit).map((item, index) => {
        const stock = item.stock;
        return [
          `${index + 1}. <b>${stock?.name ?? item.code}</b> <code>${item.code}</code> <code>${fmtDailyCandidateInt(Number(stock?.close ?? 0))}원</code>`,
          `   진입 ${item.entry_grade}(${Number(item.entry_score ?? 0).toFixed(1)}/4) · 경고 ${item.warn_grade}(${Number(item.warn_score ?? 0).toFixed(1)}/6) · ${String(stock?.market ?? "-")}${stock?.sector_name ? ` · ${stock.sector_name}` : ""}`,
        ].join("\n");
      })
    : ["오늘 조건에 맞는 눌림목 후보가 없습니다."];

  const buildPickLines = (picks: PickCandidate[], fallback: string): string[] => {
    if (!picks.length) return [fallback];
    return picks.slice(0, displayLimit).map((pick, index) => [
      `${index + 1}. <b>${pick.name}</b> <code>${pick.code}</code> <code>${fmtDailyCandidateInt(pick.price)}원</code>`,
      `   종합 ${pick.score.toFixed(1)} · ${pick.trendLabel} · RSI ${pick.rsi14.toFixed(1)} · 거래대금 ${fmtDailyCandidateKrwShort(pick.valueTraded)}${pick.sectorName ? ` · ${pick.sectorName}` : ""}`,
      `   점수 기술 ${pick.totalScore.toFixed(1)} · 모멘텀 ${pick.momentumScore.toFixed(1)} · 안전 ${pick.safetyScore.toFixed(1)}`,
    ].join("\n"));
  };

  if (mode === "briefing") {
    const compactPullback = pullbackResult.items.slice(0, 2).map((item) => {
      const sectorLabel = item.stock?.sector_name ? ` · ${item.stock.sector_name}` : "";
      return `  ▸ ${item.stock?.name ?? item.code}(${item.code})${sectorLabel} · 진입 ${item.entry_grade} · 경고 ${item.warn_grade}`;
    });
    const compactKospi = kospiPicks.slice(0, 2).map((item) => {
      const sectorLabel = item.sectorName ? ` · ${item.sectorName}` : "";
      return `  ▸ ${item.name}(${item.code})${sectorLabel} · 종합 ${item.score.toFixed(1)} · ${item.trendLabel}`;
    });
    const compactKosdaq = kosdaqPicks.slice(0, 1).map((item) => {
      const sectorLabel = item.sectorName ? ` · ${item.sectorName}` : "";
      return `  ▸ ${item.name}(${item.code})${sectorLabel} · 종합 ${item.score.toFixed(1)} · ${item.trendLabel}`;
    });

    return [
      `<b>오늘 후보 계획</b>`,
      ...(planningConstraints?.statusLines.length ? planningConstraints.statusLines.map((line) => `  ${line}`) : []),
      ...(sectorFocusLines.length ? [`  섹터 집중: ${sectorFocusLines.map((line) => line.replace(/^\d+\.\s*/, "")).join(", ")}`] : []),
      `  대응 원칙: ${focusLines[0]}`,
      ...(compactPullback.length ? ["  눌림목", ...compactPullback] : ["  눌림목 후보 없음"]),
      ...(compactKospi.length ? ["  코스피", ...compactKospi] : ["  코스피 후보 없음"]),
      ...(marketPolicy.allowedMarkets.includes("KOSDAQ")
        ? compactKosdaq.length
          ? ["  코스닥", ...compactKosdaq]
          : ["  코스닥 후보 없음"]
        : ["  코스닥 신규 후보 제한"]),
      `  액션: /종목분석으로 2~3개만 재검토 후 분할 진입 여부 결정`,
    ].join("\n");
  }

  const planLines = [
    "1) 장 시작 전 /시장, /경제로 레짐과 환율 먼저 확인",
    "2) 위 후보 중 2~3개만 /종목분석으로 압축 재검토",
    "3) 진입 시에는 분할매수와 손절 기준을 같이 메모",
    "4) 장중 변동이 커지면 신규 진입보다 기존 보유 관리 우선",
  ];

  return [
    `<b>오늘의 투자 후보 리포트</b>`,
    "─────────────────",
    `<i>투자성향 ${riskProfileLabel(riskProfile)} · 레짐 ${marketPolicy.label}</i>`,
    marketLines.length ? marketLines.join("\n") : "시장 데이터 조회 불가",
    "",
    `<b>오늘의 대응 프레임</b>`,
    ...focusLines.map((line) => `• ${line}`),
    ...(planningConstraints?.statusLines.length
      ? ["", `<b>자금·리스크 상태</b>`, ...planningConstraints.statusLines.map((line) => `• ${line}`)]
      : []),
    ...(sectorFocusLines.length
      ? ["", `<b>오늘 볼 섹터</b>`, ...sectorFocusLines]
      : []),
    ...(sectorTemplateLines.length
      ? ["", `<b>섹터별 대표·대기</b>`, ...sectorTemplateLines]
      : []),
    "",
    `<b>눌림목 우선 체크</b>`,
    ...(pullbackResult.latestDate ? [`기준일 ${pullbackResult.latestDate}`] : []),
    ...pullbackLines,
    "",
    `<b>코스피 우선 후보</b>`,
    ...buildPickLines(kospiPicks, "조건에 맞는 코스피 후보가 없습니다."),
    "",
    `<b>코스닥 우선 후보</b>`,
    ...buildPickLines(
      kosdaqPicks,
      marketPolicy.allowedMarkets.includes("KOSDAQ")
        ? "조건에 맞는 코스닥 후보가 없습니다."
        : "현재 시장모드에서는 코스닥 신규 후보를 제한합니다."
    ),
    "",
    `<b>오늘 실행 계획</b>`,
    ...planLines,
  ].join("\n");
}