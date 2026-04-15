import type { ChatContext } from "../router";
import { createClient } from "@supabase/supabase-js";
import { getDailySeries } from "../../adapters";
import { calculateScore } from "../../score/engine";
import { fetchRealtimePriceBatch } from "../../utils/fetchRealtimePrice";
import { fmtKRW } from "../../lib/normalize";
import { getUserInvestmentPrefs } from "../../services/userService";
import { getSafetyPreferenceScore, type RiskProfile } from "../../lib/investableUniverse";
import { esc, fmtInt, fmtOne } from "../messages/format";
import { header, section, divider, buildMessage, actionButtons } from "../messages/layout";

type MarketKind = "KOSPI" | "KOSDAQ" | "ETF";

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
};

const TOP_N = 5;

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

function isUnsafeEtfName(name: string): boolean {
  return EXCLUDED_ETF_PATTERNS.some((pattern) => pattern.test(name));
}

function getEtfSafetyScore(c: Omit<Candidate, "preScore" | "finalScore" | "avwapSupport">): number {
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

async function fetchCandidateStocks(kind: MarketKind): Promise<StockRow[]> {
  const baseQuery = supabase
    .from("stocks")
    .select("code, name, market, close, liquidity, market_cap, universe_level, is_sector_leader")
    .eq("is_active", true)
    .order("liquidity", { ascending: false })
    .limit(220);

  if (kind === "ETF") {
    const { data, error } = await baseQuery.or("market.eq.ETF,name.ilike.%ETF%");
    if (error) throw error;
    return (data ?? []) as StockRow[];
  }

  const { data, error } = await baseQuery
    .eq("market", kind)
    .in("universe_level", ["core", "extended"]);

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
  profile: RiskProfile,
  kind: MarketKind
): Candidate[] {
  const filtered = stocks.filter((s) => {
    const name = (s.name ?? "").trim();
    if (!name || !s.code) return false;

    if (kind === "ETF") {
      return !isUnsafeEtfName(name);
    }

    const liquidity = Number(s.liquidity ?? 0);
    if (kind === "KOSDAQ" && liquidity < 30_000_000_000) return false;
    if (kind === "KOSPI" && liquidity < 10_000_000_000) return false;
    return true;
  });

  const base = filtered.map((s) => {
    const score = scoreMap.get(s.code);
    const ind = indicatorMap.get(s.code);

    const close = Number(ind?.close ?? s.close ?? 0);
    const sma20 = Number(ind?.sma20 ?? close);
    const sma50 = Number(ind?.sma50 ?? close);
    const sma200 = Number(ind?.sma200 ?? close);
    const valueTraded = Number(ind?.value_traded ?? s.liquidity ?? 0);
    const rsi14 = Number(ind?.rsi14 ?? 50);
    const roc14 = Number(ind?.roc14 ?? 0);

    const candidate: Omit<Candidate, "preScore" | "finalScore" | "avwapSupport"> = {
      code: s.code,
      name: s.name ?? s.code,
      market: s.market ?? "",
      close,
      liquidity: Number(s.liquidity ?? 0),
      marketCap: Number(s.market_cap ?? 0),
      universeLevel: s.universe_level ?? "",
      isSectorLeader: Boolean(s.is_sector_leader),
      totalScore: normalizeScore(score?.total_score),
      momentumScore: normalizeScore(score?.momentum_score),
      valueScore: normalizeScore(score?.value_score),
      valueTraded,
      rsi14,
      roc14,
      sma20,
      sma50,
      sma200,
    };

    const trend = getTrendScore(close, sma20, sma50, sma200);
    const liquidityScore = getLiquidityScore(valueTraded);
    const rsiAdj = getRsiAdjust(rsi14);

    const safety = kind === "ETF"
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

    const preScore = clamp(
      candidate.totalScore * 0.42 +
        candidate.momentumScore * 0.18 +
        candidate.valueScore * 0.08 +
        safety * 0.2 +
        trend * 0.08 +
        liquidityScore * 0.04 +
        rsiAdj,
      0,
      100
    );

    return {
      ...candidate,
      preScore,
      finalScore: preScore,
      avwapSupport: 50,
    };
  });

  return base.filter((c) => c.close > 0);
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

function buildResultMessage(kind: MarketKind, picks: Candidate[], realtimeMap: Record<string, any>): string {
  const label = commandLabel(kind);
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
      `   거래대금 ${fmtKRW(c.valueTraded)} · 유동성 ${fmtKRW(c.liquidity)}`,
    ].join("\n");
  });

  const notice = kind === "ETF"
    ? "참고: ETF 괴리율/호가스프레드 실시간 값은 미연동이며 거래대금·유동성으로 보수적으로 대체했습니다."
    : "참고: 결과는 보수형 필터 기반 우선순위이며, 분할 진입·손절 규칙과 함께 확인하세요.";

  return buildMessage([
    header(`${label} 보수형 추천 TOP ${picks.length}`, "추세·AVWAP·유동성·RSI 종합"),
    section("오늘의 후보", lines),
    divider(),
    notice,
  ]);
}

async function runMarketPickCommand(kind: MarketKind, ctx: ChatContext, tgSend: any): Promise<void> {
  const prefs = await getUserInvestmentPrefs(ctx.from?.id ?? ctx.chatId);
  const riskProfile = (prefs.risk_profile ?? "safe") as RiskProfile;

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

  const preCandidates = buildCandidates(stocks, scoreMap, indicatorMap, riskProfile, kind);
  if (!preCandidates.length) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `⚠️ ${commandLabel(kind)}에서 기준을 만족하는 종목이 없습니다.`,
    });
    return;
  }

  const enriched = await attachDeepTechnicalScores(preCandidates);
  const top = sortByDesc(enriched, (c) => c.finalScore).slice(0, TOP_N);
  const realtimeMap = await fetchRealtimePriceBatch(top.map((c) => c.code)).catch(() => ({} as Record<string, any>));

  const text = buildResultMessage(kind, top, realtimeMap);
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
