import type { ChatContext } from "../router";
import { createClient } from "@supabase/supabase-js";
import { getDailySeries } from "../../adapters";
import { calculateScore } from "../../score/engine";
import { fetchRealtimePriceBatch } from "../../utils/fetchRealtimePrice";
import { fetchAllMarketData, type MarketOverview } from "../../utils/fetchMarketData";
import { fmtKRW } from "../../lib/normalize";
import { getUserInvestmentPrefs } from "../../services/userService";
import { getSafetyPreferenceScore, type RiskProfile } from "../../lib/investableUniverse";
import { esc, fmtInt, fmtOne } from "../messages/format";
import { header, section, divider, buildMessage, actionButtons } from "../messages/layout";

type MarketKind = "KOSPI" | "KOSDAQ" | "ETF";
type EtfStrategy = "default" | "core" | "theme";

type StockRow = {
  code: string;
  name: string;
  market: string | null;
  close: number | null;
  liquidity: number | null;
  market_cap: number | null;
  universe_level: string | null;
  is_sector_leader: boolean | null;
};

type ScoreRow = {
  code: string;
  total_score: number | null;
  momentum_score: number | null;
  value_score: number | null;
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

type Candidate = {
  code: string;
  name: string;
  market: string;
  close: number;
  liquidity: number;
  marketCap: number;
  universeLevel: string;
  isSectorLeader: boolean;
  totalScore: number;
  momentumScore: number;
  valueScore: number;
  valueTraded: number;
  rsi14: number;
  roc14: number;
  sma20: number;
  sma50: number;
  sma200: number;
  preScore: number;
  finalScore: number;
  avwapSupport: number;
  safetyScore: number;
  trendScore: number;
  liquidityScore: number;
};

const TOP_N = 5;

type RegimeMode = "risk_on" | "neutral" | "defensive";

type RegimeSettings = {
  mode: RegimeMode;
  label: string;
  maxRsi: number;
  minLiquidityKrw: number;
  scoreBias: number;
};

type ScoreWeights = {
  technical: number;
  momentum: number;
  value: number;
  safety: number;
  trend: number;
  liquidity: number;
};

const MARKET_WEIGHTS: Record<MarketKind, ScoreWeights> = {
  KOSPI: {
    technical: 0.39,
    momentum: 0.18,
    value: 0.1,
    safety: 0.2,
    trend: 0.08,
    liquidity: 0.05,
  },
  KOSDAQ: {
    technical: 0.33,
    momentum: 0.22,
    value: 0.08,
    safety: 0.2,
    trend: 0.1,
    liquidity: 0.07,
  },
  ETF: {
    technical: 0.26,
    momentum: 0.2,
    value: 0.04,
    safety: 0.24,
    trend: 0.12,
    liquidity: 0.14,
  },
};

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

const EXCLUDED_ETF_PATTERNS = [
  /레버리지/i,
  /인버스/i,
  /선물/i,
  /곱버스/i,
  /2X/i,
  /3X/i,
  /ETN/i,
  /채권/i,
  /회사채/i,
];

const ETF_NAME_QUERY_PATTERNS = [
  "KODEX%",
  "TIGER%",
  "KOSEF%",
  "KBSTAR%",
  "ACE%",
  "RISE%",
  "SOL%",
  "HANARO%",
  "ARIRANG%",
  "PLUS%",
  "TIMEFOLIO%",
  "WON%",
  "WOORI%",
  "%ETF%",
];

const ETF_NAME_HINT = /^(ETF|KODEX|TIGER|KOSEF|KBSTAR|ACE|RISE|SOL|HANARO|ARIRANG|PLUS|TIMEFOLIO|WOORI|WON)\b/i;

const CORE_ETF_PATTERNS = [
  /코스피\s*200/i,
  /KOSPI\s*200/i,
  /\b200\b/i,
  /S&P\s*500/i,
  /나스닥\s*100/i,
  /NASDAQ\s*100/i,
  /고배당/i,
  /배당성장/i,
  /퀄리티/i,
  /QUALITY/i,
  /VALUE/i,
  /밸류/i,
  /우량/i,
  /미국대표/i,
  /TOP\s*10/i,
];

const THEME_ETF_PATTERNS = [
  /반도체/i,
  /AI/i,
  /인공지능/i,
  /전력/i,
  /전선/i,
  /2차전지/i,
  /로봇/i,
  /방산/i,
  /조선/i,
  /원전/i,
  /바이오/i,
  /게임/i,
  /엔터/i,
  /우주항공/i,
  /인터넷/i,
  /에너지/i,
];

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function normalizeScore(v: number | null | undefined): number {
  return clamp(Number(v ?? 0), 0, 100);
}

function getTrendScore(price: number, sma20: number, sma50: number, sma200: number): number {
  let score = 0;
  if (price > sma20 && sma20 > 0) score += 20;
  if (price > sma50 && sma50 > 0) score += 20;
  if (price > sma200 && sma200 > 0) score += 18;
  if (sma20 > sma50 && sma50 > sma200 && sma200 > 0) score += 28;
  else if (sma50 > sma200 && sma200 > 0) score += 16;
  return clamp(score, 0, 100);
}

function getRsiAdjust(rsi14: number): number {
  if (rsi14 >= 43 && rsi14 <= 66) return 6;
  if (rsi14 >= 70) return -8;
  if (rsi14 <= 30) return -6;
  return 0;
}

function getLiquidityScore(valueTraded: number): number {
  if (valueTraded >= 150_000_000_000) return 100;
  if (valueTraded >= 80_000_000_000) return 85;
  if (valueTraded >= 30_000_000_000) return 70;
  if (valueTraded >= 10_000_000_000) return 55;
  if (valueTraded >= 3_000_000_000) return 35;
  return 10;
}

function detectRegime(overview?: MarketOverview | null): RegimeSettings {
  const vix = Number(overview?.vix?.price ?? 0);
  const fearGreed = Number(overview?.fearGreed?.score ?? 50);
  const usdKrwChange = Number(overview?.usdkrw?.changeRate ?? 0);

  if ((vix > 0 && vix >= 28) || fearGreed <= 30 || usdKrwChange >= 0.8) {
    return {
      mode: "defensive",
      label: "방어",
      maxRsi: 62,
      minLiquidityKrw: 20_000_000_000,
      scoreBias: -4,
    };
  }

  if ((vix > 0 && vix <= 18) && fearGreed >= 60 && usdKrwChange <= 0.3) {
    return {
      mode: "risk_on",
      label: "리스크온",
      maxRsi: 69,
      minLiquidityKrw: 8_000_000_000,
      scoreBias: 2,
    };
  }

  return {
    mode: "neutral",
    label: "중립",
    maxRsi: 66,
    minLiquidityKrw: 12_000_000_000,
    scoreBias: 0,
  };
}

function isUnsafeEtfName(name: string): boolean {
  return EXCLUDED_ETF_PATTERNS.some((pattern) => pattern.test(name));
}

function isEtfLikeName(name: string): boolean {
  return ETF_NAME_HINT.test((name ?? "").trim());
}

function buildEtfOrFilter(): string {
  return ETF_NAME_QUERY_PATTERNS.map((pattern) => `name.ilike.${pattern}`).join(",");
}

function getEtfStrategyTag(name: string): EtfStrategy | null {
  if (CORE_ETF_PATTERNS.some((pattern) => pattern.test(name))) return "core";
  if (THEME_ETF_PATTERNS.some((pattern) => pattern.test(name))) return "theme";
  return null;
}

function resolveWeights(kind: MarketKind, etfStrategy: EtfStrategy): ScoreWeights {
  if (kind !== "ETF" || etfStrategy === "default") return MARKET_WEIGHTS[kind];
  if (etfStrategy === "core") {
    return {
      technical: 0.2,
      momentum: 0.12,
      value: 0.04,
      safety: 0.34,
      trend: 0.12,
      liquidity: 0.18,
    };
  }
  return {
    technical: 0.3,
    momentum: 0.27,
    value: 0.04,
    safety: 0.14,
    trend: 0.15,
    liquidity: 0.1,
  };
}

function getEtfSafetyScore(
  c: Omit<Candidate, "preScore" | "finalScore" | "avwapSupport" | "safetyScore" | "trendScore" | "liquidityScore">
): number {
  let score = 45;

  if (c.valueTraded >= 100_000_000_000) score += 24;
  else if (c.valueTraded >= 30_000_000_000) score += 16;
  else if (c.valueTraded >= 10_000_000_000) score += 8;
  else score -= 12;

  if (c.marketCap >= 800_000_000_000) score += 12;
  else if (c.marketCap >= 300_000_000_000) score += 8;
  else if (c.marketCap > 0 && c.marketCap < 100_000_000_000) score -= 8;

  const rocAbs = Math.abs(c.roc14);
  if (rocAbs >= 9) score -= 8;
  else if (rocAbs <= 4) score += 6;

  if (c.rsi14 >= 42 && c.rsi14 <= 66) score += 6;
  else if (c.rsi14 >= 70 || c.rsi14 <= 30) score -= 8;

  return clamp(score, 0, 100);
}

function buildTrendLabel(price: number, sma20: number, sma50: number, sma200: number): string {
  if (price > sma20 && sma20 > sma50 && sma50 > sma200) return "정배열 상승";
  if (price > sma50 && sma50 > sma200) return "상승 우위";
  if (price > sma20) return "단기 지지";
  return "추세 약함";
}

function sortByDesc<T>(items: T[], scoreFn: (item: T) => number): T[] {
  return [...items].sort((a, b) => scoreFn(b) - scoreFn(a));
}

function buildReasonLine(c: Candidate): string {
  return `사유 기술 ${fmtOne(c.totalScore)} · 안전 ${fmtOne(c.safetyScore)} · 추세 ${fmtOne(c.trendScore)} · 유동 ${fmtOne(c.liquidityScore)}`;
}

async function fetchCandidateStocks(kind: MarketKind): Promise<StockRow[]> {
  let query = supabase
    .from("stocks")
    .select("code, name, market, close, liquidity, market_cap, universe_level, is_sector_leader")
    .eq("is_active", true);

  if (kind === "ETF") {
    const { data, error } = await query
      .or(buildEtfOrFilter())
      .order("market_cap", { ascending: false })
      .limit(500);
    if (error) throw error;
    return ((data ?? []) as StockRow[]).filter((row) => isEtfLikeName(row.name ?? ""));
  }

  const { data, error } = await query
    .eq("market", kind)
    .in("universe_level", ["core", "extended"])
    .order("market_cap", { ascending: false })
    .limit(320);

  if (error) throw error;
  return (data ?? []) as StockRow[];
}

async function fetchScoresByCodes(codes: string[]): Promise<Map<string, ScoreRow>> {
  const out = new Map<string, ScoreRow>();
  if (!codes.length) return out;

  const { data: latestRows } = await supabase
    .from("scores")
    .select("asof")
    .order("asof", { ascending: false })
    .limit(1);

  const latestAsof = latestRows?.[0]?.asof;

  let query = supabase
    .from("scores")
    .select("code, total_score, momentum_score, value_score")
    .in("code", codes)
    .limit(Math.max(300, codes.length));

  if (latestAsof) {
    query = query.eq("asof", latestAsof);
  }

  const { data } = await query;
  for (const row of (data ?? []) as ScoreRow[]) {
    if (!out.has(row.code)) out.set(row.code, row);
  }
  return out;
}

async function fetchIndicatorsByCodes(codes: string[]): Promise<Map<string, IndicatorRow>> {
  const out = new Map<string, IndicatorRow>();
  if (!codes.length) return out;

  const { data } = await supabase
    .from("daily_indicators")
    .select("code, close, value_traded, rsi14, roc14, sma20, sma50, sma200, trade_date")
    .in("code", codes)
    .order("trade_date", { ascending: false })
    .limit(Math.max(codes.length * 3, 300));

  for (const row of (data ?? []) as IndicatorRow[]) {
    if (!out.has(row.code)) out.set(row.code, row);
  }

  return out;
}

function buildCandidates(
  stocks: StockRow[],
  scoreMap: Map<string, ScoreRow>,
  indicatorMap: Map<string, IndicatorRow>,
  realtimeMap: Record<string, any>,
  profile: RiskProfile,
  kind: MarketKind,
  regime: RegimeSettings,
  etfStrategy: EtfStrategy = "default"
): Candidate[] {
  const weights = resolveWeights(kind, etfStrategy);
  const filtered = stocks.filter((s) => {
    const name = (s.name ?? "").trim();
    if (!name || !s.code) return false;

    if (kind === "ETF") {
      const strategyTag = getEtfStrategyTag(name);
      if (isUnsafeEtfName(name)) return false;
      if (etfStrategy === "core") return strategyTag === "core";
      if (etfStrategy === "theme") return strategyTag === "theme";
      return true;
    }

    return true;
  });

  const base = filtered.map((s) => {
    const score = scoreMap.get(s.code);
    const ind = indicatorMap.get(s.code);
    const rt = realtimeMap[s.code];

    const close = Number(ind?.close ?? rt?.price ?? s.close ?? 0);
    const sma20 = Number(ind?.sma20 ?? close);
    const sma50 = Number(ind?.sma50 ?? close);
    const sma200 = Number(ind?.sma200 ?? close);
    const valueTraded = Number(ind?.value_traded ?? rt?.tradingValue ?? s.liquidity ?? 0);
    const rsi14 = Number(ind?.rsi14 ?? 50);
    const roc14 = Number(ind?.roc14 ?? rt?.changeRate ?? 0);
    if (rsi14 > regime.maxRsi) return null;

    const fallbackTechnicalScore = clamp(50 + roc14 * 5, 20, 90);
    const fallbackMomentumScore = clamp(50 + roc14 * 7, 20, 90);

    const candidate: Omit<Candidate, "preScore" | "finalScore" | "avwapSupport" | "safetyScore" | "trendScore" | "liquidityScore"> = {
      code: s.code,
      name: s.name ?? s.code,
      market: s.market ?? "",
      close,
      liquidity: Number(s.liquidity ?? valueTraded ?? 0),
      marketCap: Number(s.market_cap ?? 0),
      universeLevel: s.universe_level ?? "",
      isSectorLeader: Boolean(s.is_sector_leader),
      totalScore: normalizeScore(score?.total_score ?? fallbackTechnicalScore),
      momentumScore: normalizeScore(score?.momentum_score ?? fallbackMomentumScore),
      valueScore: normalizeScore(score?.value_score ?? (kind === "ETF" ? 40 : 30)),
      valueTraded,
      rsi14,
      roc14,
      sma20,
      sma50,
      sma200,
    };

    const trendScore = getTrendScore(close, sma20, sma50, sma200);
  const liquidityScore = kind === "ETF" && valueTraded <= 0 ? 45 : getLiquidityScore(valueTraded);
    const rsiAdj = getRsiAdjust(rsi14);

    const safetyScore = kind === "ETF"
      ? getEtfSafetyScore(candidate)
      : clamp(getSafetyPreferenceScore({
          code: candidate.code,
          name: candidate.name,
          market: candidate.market,
          universe_level: candidate.universeLevel,
          liquidity: candidate.liquidity,
          is_sector_leader: candidate.isSectorLeader,
          total_score: candidate.totalScore,
          momentum_score: candidate.momentumScore,
          value_score: candidate.valueScore,
          rsi14: candidate.rsi14,
          market_cap: candidate.marketCap,
        }, profile), 0, 100);

    if (kind === "ETF") {
      if (valueTraded > 0 && valueTraded < Math.max(5_000_000_000, Math.floor(regime.minLiquidityKrw / 2))) {
        return null;
      }
    } else if (valueTraded < regime.minLiquidityKrw) {
      return null;
    }

    const strategyBonus = kind === "ETF"
      ? etfStrategy === "core"
        ? candidate.marketCap >= 500_000_000_000 ? 4 : 0
        : etfStrategy === "theme"
          ? clamp(candidate.roc14, -4, 8)
          : 0
      : 0;

    const preScore = clamp(
      candidate.totalScore * weights.technical +
        candidate.momentumScore * weights.momentum +
        candidate.valueScore * weights.value +
        safetyScore * weights.safety +
        trendScore * weights.trend +
        liquidityScore * weights.liquidity +
        rsiAdj +
        strategyBonus +
        regime.scoreBias,
      0,
      100
    );

    return {
      ...candidate,
      preScore,
      finalScore: preScore,
      avwapSupport: 50,
      safetyScore,
      trendScore,
      liquidityScore,
    };
  });

  return base.filter((c): c is Candidate => Boolean(c && c.close > 0));
}

async function attachDeepTechnicalScores(candidates: Candidate[]): Promise<Candidate[]> {
  const deepTargets = sortByDesc(candidates, (c) => c.preScore).slice(0, 20);
  const deepCodes = new Set(deepTargets.map((c) => c.code));

  const scoreMap = new Map<string, { score: number; avwapSupport: number }>();

  await Promise.all(
    deepTargets.map(async (c) => {
      try {
        const series = await getDailySeries(c.code, 260);
        if (!series || series.length < 200) return;

        const scored = calculateScore(series);
        if (!scored) return;
        scoreMap.set(c.code, {
          score: Number(scored.score ?? c.preScore),
          avwapSupport: Number(scored.factors.avwap_support ?? 50),
        });
      } catch {
        // 시계열 실패 시 사전점수 유지
      }
    })
  );

  return candidates.map((c) => {
    if (!deepCodes.has(c.code)) return c;
    const deep = scoreMap.get(c.code);
    if (!deep) return c;

    const avwapSupport = clamp(deep.avwapSupport, 0, 100);
    const finalScore = clamp(c.preScore * 0.6 + deep.score * 0.25 + avwapSupport * 0.15, 0, 100);

    return {
      ...c,
      avwapSupport,
      finalScore,
    };
  });
}

function commandLabel(kind: MarketKind): string {
  if (kind === "KOSPI") return "코스피";
  if (kind === "KOSDAQ") return "코스닥";
  return "ETF";
}

function etfStrategyLabel(strategy: EtfStrategy): string {
  if (strategy === "core") return "ETF 적립형";
  if (strategy === "theme") return "ETF 테마형";
  return "ETF";
}

function buildResultMessage(
  kind: MarketKind,
  picks: Candidate[],
  realtimeMap: Record<string, any>,
  regime: RegimeSettings,
  etfStrategy: EtfStrategy = "default"
): string {
  const label = kind === "ETF" ? etfStrategyLabel(etfStrategy) : commandLabel(kind);
  const lines = picks.map((c, idx) => {
    const rt = realtimeMap[c.code];
    const price = Number(rt?.price ?? c.close ?? 0);
    const changeRate = Number(rt?.changeRate ?? 0);
    const hasRt = Number.isFinite(rt?.price);
    const changeTag = hasRt
      ? ` ${changeRate >= 0 ? "▲" : "▼"}${Math.abs(changeRate).toFixed(1)}%`
      : "";

    const trend = buildTrendLabel(price, c.sma20, c.sma50, c.sma200);

    return [
      `${idx + 1}. <b>${esc(c.name)}</b> <code>${c.code}</code> <code>${fmtInt(price)}원</code>${changeTag}`,
      `   점수 ${fmtOne(c.finalScore)} · ${trend} · AVWAP ${fmtOne(c.avwapSupport)} · RSI ${fmtOne(c.rsi14)}`,
      `   ${buildReasonLine(c)}`,
      `   거래대금 ${fmtKRW(c.valueTraded)} · 유동성 ${fmtKRW(c.liquidity)}`,
    ].join("\n");
  });

  const notice = kind === "ETF"
    ? etfStrategy === "core"
      ? "참고: 적립형 ETF는 broad index·고배당·우량지수 중심으로 추렸고, NAV·괴리율은 /ETF 정보에서 개별 확인할 수 있습니다."
      : etfStrategy === "theme"
        ? "참고: 테마형 ETF는 최근 추세·모멘텀 반영 비중을 높였습니다. 단기 회전은 손절 기준과 함께 보세요."
        : "참고: ETF 괴리율/호가스프레드 실시간 값은 미연동이며 거래대금·유동성으로 보수적으로 대체했습니다."
    : "참고: 결과는 보수형 필터 기반 우선순위이며, 분할 진입·손절 규칙과 함께 확인하세요.";

  return buildMessage([
    header(`${label} 보수형 추천 TOP ${picks.length}`, `레짐 ${regime.label} · 추세·AVWAP·유동성·RSI 종합`),
    section("오늘의 후보", lines),
    divider(),
    notice,
  ]);
}

async function runMarketPickCommand(
  kind: MarketKind,
  ctx: ChatContext,
  tgSend: any,
  etfStrategy: EtfStrategy = "default"
): Promise<void> {
  const prefs = await getUserInvestmentPrefs(ctx.from?.id ?? ctx.chatId);
  const riskProfile = (prefs.risk_profile ?? "safe") as RiskProfile;
  const marketOverview = await fetchAllMarketData().catch(() => null);
  const regime = detectRegime(marketOverview);

  const stocks = await fetchCandidateStocks(kind);
  if (!stocks.length) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `⚠️ ${commandLabel(kind)} 후보 데이터를 찾지 못했습니다.`,
    });
    return;
  }

  const codes = stocks.map((s) => s.code);
  const [scoreMap, indicatorMap] = await Promise.all([
    fetchScoresByCodes(codes),
    fetchIndicatorsByCodes(codes),
  ]);

  const fallbackRealtimeMap = kind === "ETF"
    ? await fetchRealtimePriceBatch(codes).catch(() => ({} as Record<string, any>))
    : ({} as Record<string, any>);

  const preCandidates = buildCandidates(
    stocks,
    scoreMap,
    indicatorMap,
    fallbackRealtimeMap,
    riskProfile,
    kind,
    regime,
    etfStrategy
  );
  if (!preCandidates.length) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `⚠️ ${commandLabel(kind)}에서 기준을 만족하는 종목이 없습니다.`,
    });
    return;
  }

  const enriched = await attachDeepTechnicalScores(preCandidates);
  const top = sortByDesc(enriched, (c) => c.finalScore).slice(0, TOP_N);
  const realtimeMap = {
    ...fallbackRealtimeMap,
    ...(await fetchRealtimePriceBatch(top.map((c) => c.code)).catch(() => ({} as Record<string, any>))),
  };

  const text = buildResultMessage(kind, top, realtimeMap, regime, etfStrategy);
  const buttons = [
    ...top.map((c) => ({ text: c.name, callback_data: `score:${c.code}` })),
    { text: "코스피", callback_data: "cmd:kospi" },
    { text: "코스닥", callback_data: "cmd:kosdaq" },
    { text: "ETF", callback_data: "cmd:etf" },
  ];

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text,
    parse_mode: "HTML",
    reply_markup: actionButtons(buttons, 2),
  });
}

export async function handleKospiCommand(ctx: ChatContext, tgSend: any): Promise<void> {
  await runMarketPickCommand("KOSPI", ctx, tgSend);
}

export async function handleKosdaqCommand(ctx: ChatContext, tgSend: any): Promise<void> {
  await runMarketPickCommand("KOSDAQ", ctx, tgSend);
}

export async function handleEtfCommand(ctx: ChatContext, tgSend: any): Promise<void> {
  await runMarketPickCommand("ETF", ctx, tgSend);
}

export async function handleEtfCoreCommand(ctx: ChatContext, tgSend: any): Promise<void> {
  await runMarketPickCommand("ETF", ctx, tgSend, "core");
}

export async function handleEtfThemeCommand(ctx: ChatContext, tgSend: any): Promise<void> {
  await runMarketPickCommand("ETF", ctx, tgSend, "theme");
}
