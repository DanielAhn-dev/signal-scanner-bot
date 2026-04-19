import type { SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { fetchAllMarketData, fetchReportMarketData } from "../utils/fetchMarketData";
import { fetchRealtimePriceBatch } from "../utils/fetchRealtimePrice";
import { fetchTopStocksBySectors } from "../lib/source";
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
  drawSectorSection,
  drawTradesSection,
  drawWatchlistSection,
  drawWatchOnlySection,
  type DecisionReliabilityForSection,
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

export { describeWeeklyReportFailure } from "./weeklyReportErrors";

// ─── 타입 정의 ────────────────────────────────────────────────────────────
type SectorRow = {
  id: string;
  name: string;
  score: number | null;
  change_rate: number | null;
  metrics?: Record<string, unknown> | null;
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
};

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
  } else if (topicMeta.topic === "watchlist") {
    drawPortfolioSection(ctx, totalInvested, totalValue, totalUnrealized, totalUnrealizedPct, holdingItems, curr, prev);
    drawWatchlistSection(ctx, holdingItems, totalInvested, totalUnrealized, totalUnrealizedPct);
    drawTradesSection(ctx, windows);
    if (reliability) drawDecisionLogSection(ctx, reliability);
  } else if (topicMeta.topic === "watchonly") {
    drawWatchOnlySection(ctx, watchOnlyItems);
  } else {
    drawMarketOverviewSection(ctx, ymd, market as Awaited<ReturnType<typeof fetchReportMarketData>>, sectors.slice(0, 3));
    drawPortfolioSection(ctx, totalInvested, totalValue, totalUnrealized, totalUnrealizedPct, holdingItems, curr, prev);
    drawTradesSection(ctx, windows);
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

  const rows = tradeRes.data ?? [];
  const windows = splitWindows(rows, now);
  const curr = summarizeWindow(windows.current14);
  const prev = summarizeWindow(windows.prev14);

  const codes = (watchRes.data ?? []).map((r) => r.code);
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
  const sectors = sectorRes.data ?? [];
  let sectorStocksMap: Record<string, string[]> = {};
  if (topicMeta.topic === "sector" || topicMeta.topic === "flow") {
    const sectorIds = sectors.map((s) => s.id).filter(Boolean);
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
    { id: "sector_001", name: "반도체",    score: 85, change_rate:  2.1, metrics: { flow_foreign_5d: 300,  flow_inst_5d: 150 } },
    { id: "sector_002", name: "2차전지",   score: 72, change_rate: -1.3, metrics: { flow_foreign_5d: -200, flow_inst_5d:  50 } },
    { id: "sector_003", name: "바이오",    score: 68, change_rate:  0.8, metrics: { flow_foreign_5d: 100,  flow_inst_5d: -30 } },
    { id: "sector_004", name: "자동차",    score: 61, change_rate:  1.5, metrics: { flow_foreign_5d:  50,  flow_inst_5d:  80 } },
    { id: "sector_005", name: "금융",      score: 55, change_rate: -0.5, metrics: { flow_foreign_5d: -100, flow_inst_5d: -60 } },
    { id: "sector_006", name: "철강/소재", score: 49, change_rate: -0.2, metrics: { flow_foreign_5d:  20,  flow_inst_5d:  10 } },
  ];

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
    sectorStocksMap: {},
    market,
    reliability: null,
  });

  return rendered.bytes;
}