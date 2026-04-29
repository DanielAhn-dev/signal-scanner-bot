import type { SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { fetchAllMarketData, fetchReportMarketData } from "../utils/fetchMarketData";
import { fetchRealtimePriceBatch } from "../utils/fetchRealtimePrice";
import { fetchTopStocksBySectors } from "../lib/source";
import { buildInvestmentPlan } from "../lib/investPlan";
import { getSafetyPreferenceScore, pickSaferCandidates, type RiskProfile } from "../lib/investableUniverse";
import { scaleScoreFactorsToReferencePrice } from "../lib/priceScale";
import { calculateAutoTradeBuySizing } from "./virtualAutoTradeSizing";
import {
  asKstDate,
  getReportTheme,
  parseReportTopic,
  shiftDays,
  toKrDate,
  toNum,
  toYmd,
  type ReportTopic,
  type ReportTopicMeta,
} from "./weeklyReportShared";
import {
  buildCoverHeadline,
  buildReportCaption,
  buildReportSummaryText,
  buildTopicClosingSummary,
  buildTopicHeroSummary,
} from "./weeklyReportNarrative";
import {
  drawClosingHighlight,
  drawCoverPage,
  drawTopicHero,
} from "./weeklyReportLayout";
import { getDecisionReliabilitySummary } from "./decisionLogService";
import {
  drawCommentarySection,
  drawDecisionLogSection,
  drawEconomySection,
  drawFlowSection,
  drawMarketOverviewSection,
  drawPortfolioSection,
  drawPullbackWeeklySection,
  drawSectorSection,
  drawTradesSection,
  drawWatchlistSection,
  drawWatchOnlySection,
  type DecisionReliabilityForSection,
  type PullbackCandidateSectionItem,
  type PullbackSectionMeta,
} from "./weeklyReportSections";
import {
  splitWindows,
  summarizeWindow,
  unwrapStock,
  type TradeRow,
  type TradeWindows,
  type WatchlistRow,
  type WindowSummary,
} from "./weeklyReportData";
import { ReportContext, loadFontBytes, wrapText } from "./weeklyReportPdfCore";
import {
  WeeklyReportError,
  describeWeeklyReportFailure,
  runReportStep,
  type WeeklyReportFailureStep,
} from "./weeklyReportErrors";
import { fetchLatestScoresByCodes } from "./scoreSourceService";
import type { ScoreSnapshotResult } from "./scoreSourceService";
import { getUserInvestmentPrefs, type InvestmentPrefs } from "./userService";

export { describeWeeklyReportFailure } from "./weeklyReportErrors";

// ─── 타입 정의 ────────────────────────────────────────────────────────────
type SectorRow = {
  id: string;
  name: string;
  score: number | null;
  change_rate: number | null;
  metrics?: Record<string, unknown> | null;
};

type StockNameRow = {
  code: string;
  name: string;
};

type WatchItem = {
  code: string;
  name: string;
  qty: number;
  buyPrice: number | null;
  currentPrice: number | null;
  invested: number;
  value: number;
  unrealized: number;
  pnlPct: number | null;
};

type PullbackSignalWeekRow = {
  code: string;
  trade_date: string;
  entry_grade: "A" | "B" | "C" | "D" | null;
  entry_score: number | null;
  warn_grade: "SAFE" | "WATCH" | "WARN" | "SELL" | null;
  warn_score: number | null;
  stock:
    | {
        name: string;
        close: number | null;
        market?: string | null;
        sector_id?: string | null;
        liquidity?: number | null;
        universe_level?: string | null;
        rsi14?: number | null;
        sma20?: number | null;
        sma50?: number | null;
      }
    | {
        name: string;
        close: number | null;
        market?: string | null;
        sector_id?: string | null;
        liquidity?: number | null;
        universe_level?: string | null;
        rsi14?: number | null;
        sma20?: number | null;
        sma50?: number | null;
      }[]
    | null;
};

type TradeDateRow = {
  trade_date: string | null;
};

type PullbackAggregateRow = {
  code: string;
  name: string;
  market: string;
  sectorId: string | null;
  sectorName: string | null;
  liquidity: number;
  universeLevel: string | null;
  appearanceCount: number;
  entryGrade: "A" | "B" | "C" | "D";
  avgEntryScore: number;
  bestEntryScore: number;
  latestWarnGrade: "SAFE" | "WATCH" | "WARN" | "SELL";
  latestWarnScore: number;
  latestTradeDate: string;
  close: number;
  rsi14: number | null;
  sma20: number | null;
  sma50: number | null;
};

type PullbackWeeklyReportData = {
  candidates: PullbackCandidateSectionItem[];
  meta: PullbackSectionMeta;
};

export type WeeklyPdfReport = {
  bytes: Uint8Array;
  fileName: string;
  caption: string;
  summaryText: string;
  title: string;
  topic: ReportTopic;
};

type RenderReportInput = {
  topicMeta: ReportTopicMeta;
  chatId: number;
  ymd: string;
  krDate: string;
  curr: WindowSummary;
  prev: WindowSummary;
  windows: TradeWindows;
  watchItems: WatchItem[];
  totalInvested: number;
  totalValue: number;
  totalUnrealized: number;
  totalUnrealizedPct: number;
  sectors: SectorRow[];
  sectorStocksMap: Record<string, string[]>;
  market: Awaited<ReturnType<typeof fetchReportMarketData>> | Awaited<ReturnType<typeof fetchAllMarketData>>;
  reliability: DecisionReliabilityForSection | null;
  pullbackReport: PullbackWeeklyReportData | null;
  scoreSnapshot?: ScoreSnapshotResult | null;
};

function unwrapJoined<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function resolveDefaultTargetPositions(riskProfile?: InvestmentPrefs["risk_profile"]): number {
  if (riskProfile === "active") return 10;
  if (riskProfile === "balanced") return 8;
  return 6;
}

function riskProfileLabel(profile?: RiskProfile): string {
  if (profile === "balanced") return "균형형";
  if (profile === "active") return "공격형";
  return "안전형";
}

function entryGradeBonus(grade: string): number {
  if (grade === "A") return 10;
  if (grade === "B") return 4;
  return 0;
}

function warnGradePenalty(grade: string): number {
  if (grade === "WARN") return 6;
  if (grade === "WATCH") return 3;
  if (grade === "SELL") return 10;
  return 0;
}

function clampPullbackScore(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

const PULLBACK_ENRICHMENT_LIMIT = 16;
const PULLBACK_REPORT_LIMIT = 8;

async function fetchSectorNameMapForPullback(
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
    .returns<Array<{ id: string; name: string }>>();

  if (error) {
    throw new Error(`섹터 이름 조회 실패: ${error.message}`);
  }

  for (const row of data ?? []) {
    out.set(row.id, row.name);
  }
  return out;
}

async function buildPullbackWeeklyReportData(
  supabase: SupabaseClient,
  chatId: number,
  currentHoldingCount: number,
  market: Awaited<ReturnType<typeof fetchReportMarketData>>
): Promise<PullbackWeeklyReportData> {
  const { data: dateRows, error: dateError } = await supabase
    .from("pullback_signals")
    .select("trade_date")
    .order("trade_date", { ascending: false })
    .limit(10)
    .returns<TradeDateRow[]>();

  if (dateError) {
    throw new Error(`눌림목 기준일 조회 실패: ${dateError.message}`);
  }

  const recentDates = [...new Set((dateRows ?? []).map((row: TradeDateRow) => row.trade_date).filter((row): row is string => Boolean(row)))].slice(0, 5);
  if (!recentDates.length) {
    return {
      candidates: [],
      meta: {
        rangeLabel: "데이터 없음",
        riskProfileLabel: "안전형",
        availableCashLabel: "미설정",
        seedCapitalLabel: "미설정",
        holdingCount: currentHoldingCount,
      },
    };
  }

  const { data: signalRows, error: signalError } = await supabase
    .from("pullback_signals")
    .select(
      "code, trade_date, entry_grade, entry_score, warn_grade, warn_score, stock:stocks!inner(name, close, market, sector_id, liquidity, universe_level, rsi14, sma20, sma50)"
    )
    .in("trade_date", recentDates)
    .in("entry_grade", ["A", "B"])
    .neq("warn_grade", "SELL")
    .order("trade_date", { ascending: false })
    .returns<PullbackSignalWeekRow[]>();

  if (signalError) {
    throw new Error(`눌림목 후보 조회 실패: ${signalError.message}`);
  }

  const normalizedSignals = (signalRows ?? []).map((row: PullbackSignalWeekRow) => {
    const stock = unwrapJoined(row.stock);
    return {
      ...row,
      stock,
    };
  }).filter((row) => row.stock && row.code);

  if (!normalizedSignals.length) {
    const prefs = await getUserInvestmentPrefs(chatId);
    return {
      candidates: [],
      meta: {
        rangeLabel: recentDates.length > 1 ? `${recentDates[recentDates.length - 1]} ~ ${recentDates[0]}` : recentDates[0],
        riskProfileLabel: riskProfileLabel((prefs.risk_profile ?? "safe") as RiskProfile),
        availableCashLabel: `${toNum(prefs.virtual_cash ?? prefs.virtual_seed_capital ?? prefs.capital_krw).toLocaleString("ko-KR")}원`,
        seedCapitalLabel: `${toNum(prefs.virtual_seed_capital ?? prefs.capital_krw).toLocaleString("ko-KR")}원`,
        holdingCount: currentHoldingCount,
      },
    };
  }

  const sectorNameMap = await fetchSectorNameMapForPullback(
    supabase,
    normalizedSignals.map((row) => row.stock?.sector_id)
  );
  const prefs = await getUserInvestmentPrefs(chatId);
  const riskProfile = (prefs.risk_profile ?? "safe") as RiskProfile;

  const grouped = new Map<string, PullbackAggregateRow>();
  for (const row of normalizedSignals) {
    const stock = row.stock!;
    const existing = grouped.get(row.code);
    const entryScore = toNum(row.entry_score);
    const warnScore = toNum(row.warn_score);
    if (!existing) {
      grouped.set(row.code, {
        code: row.code,
        name: stock.name ?? row.code,
        market: String(stock.market ?? "-"),
        sectorId: stock.sector_id ?? null,
        sectorName: stock.sector_id ? sectorNameMap.get(stock.sector_id) ?? null : null,
        liquidity: toNum(stock.liquidity),
        universeLevel: stock.universe_level ?? null,
        appearanceCount: 1,
        entryGrade: (row.entry_grade ?? "B") as "A" | "B" | "C" | "D",
        avgEntryScore: entryScore,
        bestEntryScore: entryScore,
        latestWarnGrade: (row.warn_grade ?? "SAFE") as "SAFE" | "WATCH" | "WARN" | "SELL",
        latestWarnScore: warnScore,
        latestTradeDate: row.trade_date,
        close: toNum(stock.close),
        rsi14: stock.rsi14 != null ? toNum(stock.rsi14) : null,
        sma20: stock.sma20 != null ? toNum(stock.sma20) : null,
        sma50: stock.sma50 != null ? toNum(stock.sma50) : null,
      });
      continue;
    }

    const totalCount = existing.appearanceCount + 1;
    existing.appearanceCount = totalCount;
    existing.avgEntryScore = (existing.avgEntryScore * (totalCount - 1) + entryScore) / totalCount;
    existing.bestEntryScore = Math.max(existing.bestEntryScore, entryScore);
    if (entryGradeBonus(row.entry_grade ?? "") > entryGradeBonus(existing.entryGrade)) {
      existing.entryGrade = (row.entry_grade ?? existing.entryGrade) as "A" | "B" | "C" | "D";
    }
  }

  const aggregated = [...grouped.values()];
  const availableCash = Math.max(0, toNum(prefs.virtual_cash ?? prefs.virtual_seed_capital ?? prefs.capital_krw));
  const seedCapital = Math.max(0, toNum(prefs.virtual_seed_capital ?? prefs.capital_krw ?? availableCash));
  const maxPositions = Math.max(1, Math.floor(prefs.virtual_target_positions ?? resolveDefaultTargetPositions(riskProfile)));
  const slotsLeft = Math.max(1, Math.min(3, maxPositions - currentHoldingCount));
  const marketEnv = {
    vix: market.vix?.price,
    fearGreed: market.fearGreed?.score,
    usdkrw: market.usdkrw?.price,
  };

  const preselected = pickSaferCandidates(
    aggregated
      .map((item) => ({
        ...item,
        preScore: clampPullbackScore(
          item.avgEntryScore * 10 +
          item.appearanceCount * 9 +
          entryGradeBonus(item.entryGrade) -
          item.latestWarnScore * 3 -
          warnGradePenalty(item.latestWarnGrade)
        ),
      }))
      .sort((a, b) => b.preScore - a.preScore || b.appearanceCount - a.appearanceCount || b.avgEntryScore - a.avgEntryScore),
    Math.min(PULLBACK_ENRICHMENT_LIMIT, Math.max(PULLBACK_REPORT_LIMIT, aggregated.length)),
    riskProfile
  );

  const codes = preselected.map((item) => item.code);
  const [realtimeMap, scoreSnapshot] = await Promise.all([
    fetchRealtimePriceBatch(codes).catch(() => ({} as Record<string, any>)),
    fetchLatestScoresByCodes(supabase, codes),
  ]);

  const enriched = preselected.map((item) => {
    const realtimePrice = toNum(realtimeMap[item.code]?.price);
    const currentPrice = realtimePrice > 0 ? realtimePrice : item.close;
    const snapshot = scoreSnapshot.byCode.get(item.code);
    const latestFactors = snapshot?.factors && typeof snapshot.factors === "object"
      ? (snapshot.factors as Record<string, any>)
      : null;
    const scaledFactors = scaleScoreFactorsToReferencePrice(
      {
        sma20: toNum(latestFactors?.sma20 ?? item.sma20 ?? currentPrice),
        sma50: toNum(latestFactors?.sma50 ?? item.sma50 ?? currentPrice),
        sma200: toNum(latestFactors?.sma200 ?? currentPrice),
        rsi14: toNum(latestFactors?.rsi14 ?? item.rsi14 ?? 50),
        roc14: toNum(latestFactors?.roc14 ?? 0),
        roc21: toNum(latestFactors?.roc21 ?? latestFactors?.roc_21 ?? 0),
        avwap_support: toNum(latestFactors?.avwap_support ?? 50),
      },
      currentPrice,
      item.close || currentPrice
    );
    const technicalScore = toNum(snapshot?.total_score ?? snapshot?.momentum_score ?? item.bestEntryScore * 20);
    const plan = buildInvestmentPlan({
      currentPrice,
      factors: scaledFactors,
      technicalScore,
      variantSeed: item.code,
      marketEnv,
    });
    const sizing = calculateAutoTradeBuySizing({
      availableCash: availableCash > 0 ? availableCash : seedCapital,
      price: Math.max(1, Math.round((plan.entryLow + plan.entryHigh) / 2)),
      slotsLeft,
      currentHoldingCount,
      maxPositions,
      stopLossPct: plan.stopPct,
      prefs,
    });
    const safetyScore = getSafetyPreferenceScore(
      {
        code: item.code,
        name: item.name,
        market: item.market,
        universe_level: item.universeLevel,
        liquidity: item.liquidity,
        total_score: snapshot?.total_score ?? technicalScore,
        momentum_score: snapshot?.momentum_score ?? technicalScore,
        value_score: snapshot?.value_score ?? null,
        rsi14: scaledFactors.rsi14,
      },
      riskProfile
    );
    const weeklyScore = clampPullbackScore(
      technicalScore * 0.35 +
      safetyScore * 0.25 +
      item.avgEntryScore * 10 +
      item.appearanceCount * 9 +
      entryGradeBonus(item.entryGrade) -
      item.latestWarnScore * 3 -
      warnGradePenalty(item.latestWarnGrade)
    );
    return {
      ...item,
      currentPrice,
      technicalScore,
      safetyScore,
      weeklyScore,
      plan,
      sizing,
    };
  });

  const saferPool = pickSaferCandidates(enriched, Math.min(Math.max(enriched.length, 6), 20), riskProfile);
  const finalCandidates = saferPool
    .sort((a, b) => b.weeklyScore - a.weeklyScore || b.appearanceCount - a.appearanceCount || b.technicalScore - a.technicalScore)
    .slice(0, PULLBACK_REPORT_LIMIT)
    .map((item, index) => ({
      code: item.code,
      name: item.name,
      market: item.market,
      sectorName: item.sectorName,
      appearanceCount: item.appearanceCount,
      entryGrade: item.entryGrade,
      weeklyScore: Number(item.weeklyScore.toFixed(1)),
      currentPrice: item.currentPrice,
      entryLow: item.plan.entryLow,
      entryHigh: item.plan.entryHigh,
      stopPrice: item.plan.stopPrice,
      target1: item.plan.target1,
      target2: item.plan.target2,
      riskReward: item.plan.riskReward,
      statusLabel: item.plan.statusLabel,
      warnGrade: item.latestWarnGrade,
      targetWeightPct: item.sizing.targetWeightPct,
      recommendedBudget: item.sizing.totalBudget,
      trancheBudget: item.sizing.budget,
      quantity: item.sizing.quantity,
      highlight: index < 3,
      rationale: `${item.entryGrade}등급 ${item.appearanceCount}회 · ${item.plan.statusLabel} · RR ${item.plan.riskReward.toFixed(1)}`,
    }));

  return {
    candidates: finalCandidates,
    meta: {
      rangeLabel: recentDates.length > 1 ? `${recentDates[recentDates.length - 1]} ~ ${recentDates[0]}` : recentDates[0],
      riskProfileLabel: riskProfileLabel(riskProfile),
      availableCashLabel: availableCash > 0 ? `${availableCash.toLocaleString("ko-KR")}원` : "미설정",
      seedCapitalLabel: seedCapital > 0 ? `${seedCapital.toLocaleString("ko-KR")}원` : "미설정",
      holdingCount: currentHoldingCount,
    },
  };
}

export async function renderReportPdf(input: RenderReportInput): Promise<WeeklyPdfReport> {
  const {
    topicMeta,
    chatId,
    ymd,
    krDate,
    curr,
    prev,
    windows,
    watchItems,
    totalInvested,
    totalValue,
    totalUnrealized,
    totalUnrealizedPct,
    sectors,
    sectorStocksMap,
    market,
    reliability,
    pullbackReport,
  } = input;

  // 보유 포지션(qty>0) vs 관심만 항목(qty===0) 분리
  const holdingItems = watchItems.filter((i) => i.qty > 0);
  const watchOnlyItems = watchItems.filter((i) => i.qty === 0);

  const theme = getReportTheme(topicMeta.topic);
  const coverHeadline = buildCoverHeadline({
    curr,
    totalUnrealized,
    totalUnrealizedPct,
    sectors,
    market: market as Awaited<ReturnType<typeof fetchReportMarketData>>,
  });
  const heroSummary = buildTopicHeroSummary({
    topic: topicMeta.topic,
    defaultSummary: theme.heroSummary,
    curr,
    totalUnrealized,
    totalUnrealizedPct,
    watchItems,
    sectors,
    market,
    pullbackCandidates: pullbackReport?.candidates,
    pullbackMeta: pullbackReport?.meta,
  });
  const closingSummary = buildTopicClosingSummary({
    topic: topicMeta.topic,
    curr,
    prev,
    totalUnrealized,
    totalUnrealizedPct,
    watchItems,
    sectors,
    market,
    pullbackCandidates: pullbackReport?.candidates,
    pullbackMeta: pullbackReport?.meta,
  });

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const fontBytes = await loadFontBytes();
  const fontLight = await pdf.embedFont(fontBytes.light);
  const font      = await pdf.embedFont(fontBytes.regular);
  const fontBold  = await pdf.embedFont(fontBytes.bold);
  const ctx = new ReportContext(pdf, fontLight, font, fontBold, theme);
  ctx.footerLabel = ymd;

  if (topicMeta.includeCover) {
    ctx.addPage(null);
    drawCoverPage(ctx, krDate, chatId, coverHeadline);
  }

  // 히어로 페이지는 타이틀 밴드 없이 히어로만 제목 표시, 이후 페이지는 밴드 유지
  ctx.addPage(null);
  ctx.pageTitle = topicMeta.title;
  drawTopicHero(ctx, topicMeta.title, heroSummary);

  if (topicMeta.topic === "economy") {
    drawEconomySection(ctx, font, market as Awaited<ReturnType<typeof fetchAllMarketData>>, ymd, wrapText);
  } else if (topicMeta.topic === "flow") {
    drawFlowSection(ctx, sectors, sectorStocksMap);
  } else if (topicMeta.topic === "sector") {
    drawSectorSection(ctx, sectors, ymd, sectorStocksMap);
  } else if (topicMeta.topic === "pullback") {
    drawMarketOverviewSection(ctx, ymd, market as Awaited<ReturnType<typeof fetchReportMarketData>>, sectors.slice(0, 3));
    drawPullbackWeeklySection(ctx, pullbackReport?.candidates ?? [], pullbackReport?.meta ?? {
      rangeLabel: krDate,
      riskProfileLabel: "안전형",
      availableCashLabel: "미설정",
      seedCapitalLabel: "미설정",
      holdingCount: holdingItems.length,
    });
  } else if (topicMeta.topic === "watchlist") {
    drawPortfolioSection(ctx, totalInvested, totalValue, totalUnrealized, totalUnrealizedPct, holdingItems, curr, prev);
    drawWatchlistSection(ctx, holdingItems, totalInvested, totalUnrealized, totalUnrealizedPct);
    drawTradesSection(ctx, windows, input.scoreSnapshot?.byCode ?? new Map());
    if (reliability) drawDecisionLogSection(ctx, reliability);
  } else if (topicMeta.topic === "watchonly") {
    drawWatchOnlySection(ctx, watchOnlyItems);
  } else {
    drawMarketOverviewSection(ctx, ymd, market as Awaited<ReturnType<typeof fetchReportMarketData>>, sectors.slice(0, 3));
    drawPortfolioSection(ctx, totalInvested, totalValue, totalUnrealized, totalUnrealizedPct, holdingItems, curr, prev);
    drawTradesSection(ctx, windows, input.scoreSnapshot?.byCode ?? new Map());
    drawWatchlistSection(ctx, holdingItems, totalInvested, totalUnrealized, totalUnrealizedPct);
    if (reliability) drawDecisionLogSection(ctx, reliability);
    drawCommentarySection(ctx, font, curr, prev, totalUnrealized, totalUnrealizedPct, watchItems, sectors, wrapText);
  }

  drawClosingHighlight(ctx, "최종 결론", closingSummary, wrapText);
  ctx.finalizePage();

  const bytes = await pdf.save();
  const caption = buildReportCaption({
    title: topicMeta.captionTitle,
    topic: topicMeta.topic,
    krDate,
    curr,
    totalUnrealized,
    totalUnrealizedPct,
    sectors,
    market,
    pullbackCandidates: pullbackReport?.candidates,
    pullbackMeta: pullbackReport?.meta,
  });
  const summaryText = buildReportSummaryText({
    title: topicMeta.title,
    topic: topicMeta.topic,
    ymd,
    curr,
    totalUnrealized,
    totalUnrealizedPct,
    sectors,
    market,
    pullbackCandidates: pullbackReport?.candidates,
    pullbackMeta: pullbackReport?.meta,
  });

  return {
    bytes,
    fileName: `${topicMeta.fileSlug}_${chatId}_${ymd}.pdf`,
    caption,
    summaryText,
    title: topicMeta.title,
    topic: topicMeta.topic,
  };
}

// ─── 메인 export ──────────────────────────────────────────────────────────
export async function createWeeklyReportPdf(
  supabase: SupabaseClient,
  options: { chatId: number; topic?: string | null }
): Promise<WeeklyPdfReport> {
  const startedAt = Date.now();
  const chatId = options.chatId;
  const topicMeta = parseReportTopic(options.topic);
  const now = new Date();
  const kstNow = asKstDate(now);
  const ymd = toYmd(kstNow);
  const krDate = toKrDate(now);

  if (topicMeta.topic === "pullback") {
    const [sectorRes, market, currentHoldingCount] = await Promise.all([
      runReportStep("sector_query", () =>
        supabase
          .from("sectors")
          .select("id, name, score, change_rate, metrics")
          .order("score", { ascending: false })
          .limit(12)
          .returns<SectorRow[]>()
      ),
      runReportStep("market_data", async () => {
        try {
          return await fetchReportMarketData();
        } catch {
          return {} as Awaited<ReturnType<typeof fetchReportMarketData>>;
        }
      }),
      runReportStep("watchlist_query", async () => {
        const { data, error } = await supabase
          .from("watchlist")
          .select("buy_price, quantity")
          .eq("chat_id", chatId);

        if (error) {
          throw new WeeklyReportError("watchlist_query", `watchlist 조회 실패: ${error.message}`, error);
        }

        return ((data ?? []) as Array<{ buy_price: number | null; quantity: number | null }>).filter((row) => {
          const buyPrice = toNum(row.buy_price);
          const quantity = Math.max(0, Math.floor(toNum(row.quantity)));
          return buyPrice > 0 && quantity > 0;
        }).length;
      }),
    ]);

    if (sectorRes.error) {
      throw new WeeklyReportError("sector_query", `sectors 조회 실패: ${sectorRes.error.message}`, sectorRes.error);
    }

    const pullbackReport = await runReportStep("pullback_candidates_query", () =>
      buildPullbackWeeklyReportData(
        supabase,
        chatId,
        currentHoldingCount,
        market as Awaited<ReturnType<typeof fetchReportMarketData>>
      )
    );

    const emptySummary: WindowSummary = {
      buyCount: 0,
      sellCount: 0,
      tradeCount: 0,
      realizedPnl: 0,
      winRate: 0,
      avgWinPct: 0,
      avgLossPct: 0,
      payoffRatio: null,
      maxSingleLoss: 0,
    };

    return runReportStep("pdf_render", () =>
      renderReportPdf({
        topicMeta,
        chatId,
        ymd,
        krDate,
        curr: emptySummary,
        prev: emptySummary,
        windows: { current14: [], prev14: [], recent: [] },
        watchItems: [],
        totalInvested: 0,
        totalValue: 0,
        totalUnrealized: 0,
        totalUnrealizedPct: 0,
        sectors: sectorRes.data ?? [],
        sectorStocksMap: {},
        market,
        reliability: null,
        pullbackReport,
        scoreSnapshot: null,
      })
    );
  }

  // ── 데이터 조회 ─────────────────────────────────────────────────────────
  const tradeSince = shiftDays(now, -28).toISOString();

  const [tradeRes, watchRes, sectorRes] = await Promise.all([
    runReportStep("trade_query", () =>
      supabase
        .from("virtual_trades")
        .select("side, code, price, quantity, pnl_amount, traded_at")
        .eq("chat_id", chatId)
        .gte("traded_at", tradeSince)
        .order("traded_at", { ascending: false })
        .limit(300)
        .returns<TradeRow[]>()
    ),
    runReportStep("watchlist_query", () =>
      supabase
        .from("watchlist")
        .select("code, buy_price, quantity, invested_amount, status, stock:stocks(code,name,close)")
        .eq("chat_id", chatId)
        .returns<WatchlistRow[]>()
    ),
    runReportStep("sector_query", () =>
      supabase
        .from("sectors")
        .select("id, name, score, change_rate, metrics")
        .order("score", { ascending: false })
        .limit(12)
        .returns<SectorRow[]>()
    ),
  ]);

  if (tradeRes.error) {
    throw new WeeklyReportError("trade_query", `virtual_trades 조회 실패: ${tradeRes.error.message}`, tradeRes.error);
  }
  if (watchRes.error) {
    throw new WeeklyReportError("watchlist_query", `watchlist 조회 실패: ${watchRes.error.message}`, watchRes.error);
  }
  if (sectorRes.error) {
    throw new WeeklyReportError("sector_query", `sectors 조회 실패: ${sectorRes.error.message}`, sectorRes.error);
  }

  const market = await runReportStep("market_data", async () => {
    try {
      return topicMeta.topic === "economy" ? await fetchAllMarketData() : await fetchReportMarketData();
    } catch {
      return {} as any;
    }
  });

  const tradeRows = tradeRes.data ?? [];
  const tradeCodes = [...new Set(tradeRows.map((row: TradeRow) => row.code).filter((code): code is string => Boolean(code)))];
  const stockNameMap = tradeCodes.length
    ? await runReportStep("trade_name_query", async () => {
        const { data, error } = await supabase
          .from("stocks")
          .select("code, name")
          .in("code", tradeCodes)
          .returns<StockNameRow[]>();

        if (error) {
          throw new Error(`stocks 조회 실패: ${error.message}`);
        }

        return new Map((data ?? []).map((row: StockNameRow) => [row.code, row.name]));
      })
    : new Map<string, string>();

  const rows = tradeRows.map((row: TradeRow) => ({
    ...row,
    name: stockNameMap.get(row.code) ?? row.name ?? row.code,
  }));
  const windows = splitWindows(rows, now);
  const curr = summarizeWindow(windows.current14);
  const prev = summarizeWindow(windows.prev14);

  const scoreSnapshot = tradeCodes.length
    ? await runReportStep("score_snapshot", async () => {
        try {
          return await fetchLatestScoresByCodes(supabase, tradeCodes);
        } catch {
          return { latestAsof: null, byCode: new Map(), fallbackCodes: [] } as ScoreSnapshotResult;
        }
      })
    : { latestAsof: null, byCode: new Map(), fallbackCodes: [] } as ScoreSnapshotResult;

  const codes = (watchRes.data ?? []).map((r: WatchlistRow) => r.code);
  const realtimeMap = codes.length
    ? await runReportStep("realtime_price", async () => {
        try {
          return await fetchRealtimePriceBatch(codes);
        } catch {
          return {} as Record<string, any>;
        }
      })
    : {};

  const watchItems: WatchItem[] = (watchRes.data ?? []).map((row: WatchlistRow) => {
    const stock = unwrapStock(row.stock);
    const buyPrice = row.buy_price != null ? toNum(row.buy_price) : null;
    const qtyRaw = row.quantity != null ? Math.floor(toNum(row.quantity)) : 0;
    const invested = toNum(row.invested_amount);
    const qty = qtyRaw > 0 ? qtyRaw : buyPrice && invested > 0 ? Math.floor(invested / buyPrice) : 0;
    const rtPrice = toNum(realtimeMap[row.code]?.price);
    const dbPrice = stock?.close != null ? toNum(stock.close) : 0;
    const currentPrice = rtPrice > 0 ? rtPrice : dbPrice > 0 ? dbPrice : null;
    const cost = invested > 0 ? invested : buyPrice && qty > 0 ? buyPrice * qty : 0;
    const value = currentPrice && qty > 0 ? currentPrice * qty : 0;
    const unrealized = cost > 0 ? value - cost : 0;
    const pnlPct = buyPrice && currentPrice ? ((currentPrice - buyPrice) / buyPrice) * 100 : null;
    return {
      code: row.code,
      name: stock?.name ?? row.code,
      qty,
      buyPrice,
      currentPrice,
      invested: cost,
      value,
      unrealized,
      pnlPct,
    };
  }).sort((a: WatchItem, b: WatchItem) => Math.abs(b.unrealized) - Math.abs(a.unrealized));

  const totalInvested = watchItems.reduce((s, i) => s + i.invested, 0);
  const totalValue = watchItems.reduce((s, i) => s + i.value, 0);
  const totalUnrealized = totalValue - totalInvested;
  const totalUnrealizedPct = totalInvested > 0 ? (totalUnrealized / totalInvested) * 100 : 0;

  // 섹터/수급 리포트에서 구성 종목 표시를 위해 섹터별 상위 종목을 조회한다
  const sectors: SectorRow[] = sectorRes.data ?? [];
  let sectorStocksMap: Record<string, string[]> = {};
  if (topicMeta.topic === "sector" || topicMeta.topic === "flow") {
    const sectorIds = sectors
      .map((sector: SectorRow) => sector.id)
      .filter((sectorId: string | null | undefined): sectorId is string => Boolean(sectorId));
    sectorStocksMap = await runReportStep("sector_stocks_query", async () => {
      try {
        return await fetchTopStocksBySectors(sectorIds);
      } catch {
        return {} as Record<string, string[]>;
      }
    });
  }

  // sector name → stock names 매핑으로 변환 (렌더러는 name 기준으로 조회)
  const sectorStocksNameMap: Record<string, string[]> = {};
  for (const sector of sectors) {
    if (sectorStocksMap[sector.id]) {
      sectorStocksNameMap[sector.name] = sectorStocksMap[sector.id];
    }
  }

  // 포트폴리오·종합 토픽에서만 판단 신뢰도 조회 (90일 기준)
  const needsReliability = topicMeta.topic === "watchlist" || topicMeta.topic === "full";
  const reliability = needsReliability
    ? await runReportStep("decision_log_query", async () => {
        try {
          return await getDecisionReliabilitySummary(chatId, 90);
        } catch {
          return null;
        }
      })
    : null;

  const pullbackReport = null;

  try {
    const report = await runReportStep("pdf_render", () =>
      renderReportPdf({
        topicMeta,
        chatId,
        ymd,
        krDate,
        curr,
        prev,
        windows,
        watchItems,
        totalInvested,
        totalValue,
        totalUnrealized,
        totalUnrealizedPct,
        sectors,
        sectorStocksMap: sectorStocksNameMap,
        market,
        reliability: reliability ?? null,
        pullbackReport,
        scoreSnapshot,
      })
    );

    if (process.env.NODE_ENV !== "production") {
      console.log(
        JSON.stringify({
          scope: "weekly_report",
          event: "report_done",
          step: "create_weekly_report_pdf",
          duration_ms: Date.now() - startedAt,
          chat_id: chatId,
          topic: topicMeta.topic,
          ts: new Date().toISOString(),
        })
      );
    }

    return report;
  } catch (error) {
    console.error(
      JSON.stringify({
        scope: "weekly_report",
        event: "report_failed",
        step: "create_weekly_report_pdf",
        duration_ms: Date.now() - startedAt,
        error_type: error instanceof Error ? error.name || "Error" : "UnknownError",
        error: error instanceof Error ? error.message : String(error),
        chat_id: chatId,
        topic: topicMeta.topic,
        ts: new Date().toISOString(),
      })
    );
    throw error;
  }
}

// ─── 로컬 프리뷰용 렌더 함수 (Supabase 없이 mock 데이터로 생성) ────────────
export async function createPreviewReportPdf(topicStr = "economy"): Promise<Uint8Array> {
  const topicMeta = parseReportTopic(topicStr);
  const ymd       = "2025-01-24";
  const krDate    = "2025년 1월 24일";
  const chatId    = 0;

  const curr: WindowSummary = {
    buyCount: 3,
    sellCount: 2,
    tradeCount: 5,
    realizedPnl: 120000,
    winRate: 66.7,
    avgWinPct: 4.2,
    avgLossPct: 2.1,
    payoffRatio: 2.0,
    maxSingleLoss: -30000,
  };
  const prev: WindowSummary = {
    buyCount: 2,
    sellCount: 1,
    tradeCount: 3,
    realizedPnl: -50000,
    winRate: 50,
    avgWinPct: 2.8,
    avgLossPct: 3.5,
    payoffRatio: 0.8,
    maxSingleLoss: -50000,
  };
  const windows = { current14: [] as TradeRow[], prev14: [] as TradeRow[], recent: [] as TradeRow[] };

  const watchItems: WatchItem[] = [
    { code: "005930", name: "삼성전자",  qty: 10, buyPrice: 68000,  currentPrice: 71000,  invested: 680000,  value: 710000,  unrealized: 30000,  pnlPct: 4.41  },
    { code: "000660", name: "SK하이닉스", qty:  5, buyPrice: 182000, currentPrice: 175000, invested: 910000,  value: 875000,  unrealized: -35000, pnlPct: -3.85 },
    { code: "373220", name: "LG에너지솔루션", qty: 2, buyPrice: 412000, currentPrice: 430000, invested: 824000, value: 860000, unrealized: 36000, pnlPct: 4.37 },
  ];
  const totalInvested      = watchItems.reduce((s, i) => s + i.invested, 0);
  const totalValue         = watchItems.reduce((s, i) => s + i.value, 0);
  const totalUnrealized    = totalValue - totalInvested;
  const totalUnrealizedPct = totalInvested > 0 ? (totalUnrealized / totalInvested) * 100 : 0;

  const sectors: SectorRow[] = [
    { id: "sector_001", name: "코스피 200 비중상한 20%", score: 92, change_rate: 3.2, metrics: { flow_foreign_5d: 780, flow_inst_5d: 420 } },
    { id: "sector_002", name: "코스닥 150 정보기술", score: 88, change_rate: 2.6, metrics: { flow_foreign_5d: 460, flow_inst_5d: 180 } },
    { id: "sector_003", name: "코스닥 150 헬스케어", score: 84, change_rate: 2.1, metrics: { flow_foreign_5d: 310, flow_inst_5d: 220 } },
    { id: "sector_004", name: "코스닥 기술성장기업부", score: 81, change_rate: 1.8, metrics: { flow_foreign_5d: 260, flow_inst_5d: 120 } },
    { id: "sector_005", name: "코스피 200 TOP 10", score: 79, change_rate: 1.5, metrics: { flow_foreign_5d: 640, flow_inst_5d: 510 } },
    { id: "sector_006", name: "코스피200제외 코스피지수", score: 76, change_rate: 1.2, metrics: { flow_foreign_5d: -120, flow_inst_5d: 290 } },
    { id: "sector_007", name: "코스닥 150 산업재", score: 72, change_rate: 0.9, metrics: { flow_foreign_5d: 110, flow_inst_5d: 140 } },
    { id: "sector_008", name: "운송·창고", score: 68, change_rate: 0.6, metrics: { flow_foreign_5d: 70, flow_inst_5d: 90 } },
    { id: "sector_009", name: "전기전자", score: 66, change_rate: 0.4, metrics: { flow_foreign_5d: 180, flow_inst_5d: -20 } },
    { id: "sector_010", name: "전자장비와기기", score: 63, change_rate: 0.2, metrics: { flow_foreign_5d: 40, flow_inst_5d: 60 } },
    { id: "sector_011", name: "운송장비·부품", score: 61, change_rate: 0.1, metrics: { flow_foreign_5d: -30, flow_inst_5d: 50 } },
  ];

  const sectorStocksMap: Record<string, string[]> = {
    "코스피 200 비중상한 20%": ["삼성중공업", "한온시스템", "삼성물산", "HD현대일렉트릭"],
    "코스닥 150 정보기술": ["엘탑스", "HPSP", "테스", "RFHIC", "제이앤티씨"],
    "코스닥 150 헬스케어": ["휴젤", "에이비엘바이오", "알테오젠", "보로노이"],
    "코스닥 기술성장기업부": ["LB제약", "프리시전바이오", "에어레인", "고바이오랩"],
    "코스피 200 TOP 10": ["LG에너지솔루션", "삼성바이오로직스", "현대차", "기아"],
    "코스피200제외 코스피지수": ["동화약품", "DH오토넥스", "한진중공업홀딩스"],
    "코스닥 150 산업재": ["성광벤드", "에코프로비엠", "에코프로에이치엔"],
    "운송·창고": ["태웅로직스", "선광", "유성티엔에스"],
    "전기전자": ["성호전자", "모아텍", "서울전자통신", "인지디스플레"],
    "전자장비와기기": ["삼성전기우", "코리아써우"],
    "운송장비·부품": ["구영테크", "한일단조", "세원물산", "코다코"],
  };

  // mock 시장 데이터 (fetchAllMarketData 호환 구조)
  const market = {
    kospi:     { price: 2520.31, changeRate:  0.82 },
    kosdaq:    { price:  742.18, changeRate:  1.24 },
    sp500:     { price: 5875.42, changeRate:  0.35 },
    nasdaq:    { price: 19280.16,changeRate:  0.61 },
    vix:       { price:   18.32, changeRate: -5.20 },
    usdkrw:    { price: 1388,    changeRate: -0.24 },
    us10y:     { price:    4.58, changeRate:  0.03 },
    us2y:      { price:    4.32, changeRate:  0.01 },
    fearGreed: { score: 52, rating: "Neutral" },
    wtiOil:    { price:   78.4,  changeRate:  1.10 },
    gold:      { price: 2642,    changeRate:  0.40 },
    silver:    { price:  29.85,  changeRate:  0.30 },
    copper:    { price:   4.12,  changeRate: -0.50 },
    btc:       { price: 105280,  changeRate:  3.20 },
    dxy:       { price:  107.2,  changeRate: -0.20 },
    hyg:       { price:   79.1,  changeRate:  0.10 },
    tnx:       { price:    4.58, changeRate:  0.03 },
    em:        { price: 1090,    changeRate:  0.50 },
  } as unknown as Awaited<ReturnType<typeof fetchAllMarketData>>;

  const rendered = await renderReportPdf({
    topicMeta,
    chatId,
    ymd,
    krDate,
    curr,
    prev,
    windows,
    watchItems,
    totalInvested,
    totalValue,
    totalUnrealized,
    totalUnrealizedPct,
    sectors,
    sectorStocksMap,
    market,
    reliability: null,
    pullbackReport: null,
    scoreSnapshot: null,
  });

  return rendered.bytes;
}