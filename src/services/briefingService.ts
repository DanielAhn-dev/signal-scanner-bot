import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchRealtimePriceBatch } from "../utils/fetchRealtimePrice";
import { fetchAllMarketData, type MarketOverview } from "../utils/fetchMarketData";
import { buildInvestmentPlan } from "../lib/investPlan";
import { pickSaferCandidates, type RiskProfile } from "../lib/investableUniverse";
import {
  getFundamentalWarningTags,
  type FundamentalSnapshot,
} from "./fundamentalService";
import fundamentalStore from "./fundamentalStore";
import { getFundamentalSnapshot as liveGetFundamentalSnapshot } from "./fundamentalService";
import {
  fetchWatchMicroSignalsByCodes,
  type WatchMicroSignal,
} from "../lib/watchlistSignals";
import { fetchStockNews } from "../utils/fetchNews";
import { analyzeNewsSentiment, sentimentEmoji, type SentimentResult } from "../lib/newsSentiment";
import {
  calculateSectorConcentration,
  getSectorConcentrationWarnings,
  SECTOR_CONCENTRATION_DANGER_RATIO,
  SECTOR_CONCENTRATION_WARNING_RATIO,
} from "./portfolioService";
import {
  getEtfDistributionSummary,
  getEtfSnapshot,
  type EtfDistributionSummary,
  type EtfSnapshot,
} from "./etfService";
  import { getUserInvestmentPrefs } from "./userService";
import {
  fetchLatestScoresByCodes,
  type ScoreSnapshotRow,
} from "./scoreSourceService";
import { buildFreshnessLabel, isBusinessStale } from "../utils/dataFreshness";
import { PORTFOLIO_TABLES } from "../db/portfolioSchema";

// JSONB용 느슨한 타입
type Json = Record<string, any>;
type BriefingType = "pre_market" | "market_close";

// DB Row 타입 정의
interface SectorRow {
  id: string;
  name: string;
  score: number | null;
  change_rate: number | null;
  avg_change_rate: number | null;
  metrics: Json | null;
}

interface StockRow {
  code: string;
  name: string;
  market?: string | null;
  sector_id: string | null;
  close: number | null;
  liquidity: number | null;
  avg_volume_20d: number | null;
  rsi14: number | null;
  is_sector_leader: boolean | null;
  universe_level: string | null;
  is_active?: boolean | null;
}

type BriefingCandidate = {
  code: string;
  name: string;
  market?: string | null;
  sector_id?: string | null;
  close: number | null;
  liquidity: number | null;
  avg_volume_20d?: number | null;
  rsi14: number | null;
  is_sector_leader?: boolean | null;
  universe_level: string | null;
  momentum_score?: number | null;
  total_score?: number | null;
  roc21?: number | null;
};

type ScoreRow = ScoreSnapshotRow;

interface WatchlistRow {
  code: string;
  buy_price: number | null;
  buy_date?: string | null;
  created_at?: string | null;
  quantity?: number | null;
  invested_amount: number | null;
  memo?: string | null;
  stock: StockRow | StockRow[] | null;
}

interface WatchlistViewItem {
  code: string;
  name: string;
  market: string | null;
  sectorId: string | null;
  currentPrice: number;
  changeRate: number | null;
  buyPrice: number | null;
  profitPct: number | null;
  totalScore: number;
  plan: ReturnType<typeof buildInvestmentPlan>;
  etfSnapshot: EtfSnapshot | null;
  etfDistribution: EtfDistributionSummary | null;
}

const ETF_NAME_HINT = /^(ETF|KODEX|TIGER|KOSEF|KBSTAR|ACE|RISE|SOL|HANARO|ARIRANG|PLUS|TIMEFOLIO|WOORI|WON)\b/i;

function isEtfLike(input: { market?: unknown; name?: unknown }): boolean {
  const market = String(input.market ?? "").trim().toUpperCase();
  if (market === "ETF" || market.includes("ETF")) return true;
  const name = String(input.name ?? "").trim();
  return ETF_NAME_HINT.test(name);
}

function formatKstDateTimeLabel(iso?: string | null): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  });
}

function formatMissingMetricList(keys: string[] = []): string {
  if (!keys.length) return "없음";
  return keys.join(", ");
}

function hashSeed(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function pickVariant(seed: string, options: string[]): string {
  if (!options.length) return "";
  return options[hashSeed(seed) % options.length];
}

function buildEtfBriefingAction(item: WatchlistViewItem): string {
  const premiumRate = item.etfSnapshot?.premiumRate;
  const premiumLabel = premiumRate == null
    ? pickVariant(`${item.code}|etf|premium|none`, ["괴리율 확인", "괴리율 데이터 확인", "괴리율 공시 체크"])
    : Math.abs(premiumRate) >= 1
      ? pickVariant(`${item.code}|etf|premium|wide|${premiumRate.toFixed(2)}`, [
          `괴리율 ${fmtPct(premiumRate)} 점검`,
          `괴리율 ${fmtPct(premiumRate)}로 이격 확인`,
          `괴리율 ${fmtPct(premiumRate)} 구간 점검`,
        ])
      : pickVariant(`${item.code}|etf|premium|stable|${premiumRate.toFixed(2)}`, [
          `괴리율 ${fmtPct(premiumRate)} 안정권`,
          `괴리율 ${fmtPct(premiumRate)}로 정상 범위`,
          `괴리율 ${fmtPct(premiumRate)}로 과도한 이격 없음`,
        ]);
  const payoutLabel = item.etfDistribution?.latestPayoutDate
    ? `실지급 ${item.etfDistribution.latestPayoutDate}`
    : item.etfDistribution?.nextExpectedDate
      ? `다음 예상 ${item.etfDistribution.nextExpectedDate}`
      : "분배 공시 대기";
  return `${premiumLabel} · ${payoutLabel}`;
}

function hasVirtualPosition(item: WatchlistRow): boolean {
  const buyPrice = Number(item.buy_price ?? 0);
  const quantity = Math.max(0, Math.floor(Number(item.quantity ?? 0)));
  return buyPrice > 0 && quantity > 0;
}

function isWatchOnlyItem(item: WatchlistRow): boolean {
  return !hasVirtualPosition(item);
}

const statusRank: Record<string, number> = {
  "buy-now": 0,
  "buy-on-pullback": 1,
  wait: 2,
};

const DEV_LOG = process.env.NODE_ENV !== "production";

function logBriefingStep(
  event: "step_done" | "step_failed" | "done",
  payload: Record<string, unknown>
) {
  if (!DEV_LOG) return;
  const line = JSON.stringify({
    scope: "briefing",
    event,
    ts: new Date().toISOString(),
    ...payload,
  });
  if (event === "step_failed") {
    console.error(line);
    return;
  }
  console.log(line);
}

// ===== 메인 브리핑 함수 =====
export async function createBriefingReport(
  supabase: SupabaseClient,
  type: BriefingType = "pre_market",
  options?: { riskProfile?: RiskProfile; chatId?: number }
): Promise<string> {
  const startedAt = Date.now();
  let stepStartedAt = Date.now();
  const riskProfile = options?.riskProfile ?? "safe";
  // 0. 기준일 잡기: sector_daily 마지막 날짜
  const { data: sectorDateRows, error: sectorDateError } = await supabase
    .from("sector_daily")
    .select("date")
    .order("date", { ascending: false })
    .limit(1);

  if (sectorDateError) {
    throw new Error(`Sector date fetch failed: ${sectorDateError.message}`);
  }
  if (!sectorDateRows || sectorDateRows.length === 0) {
    throw new Error(
      "sector_daily에 데이터가 없어 브리핑 기준일을 정할 수 없습니다."
    );
  }

  const asOf = sectorDateRows[0].date as string;
  logBriefingStep("step_done", {
    step: "load_asof",
    duration_ms: Date.now() - stepStartedAt,
    asof: asOf,
    chat_id: options?.chatId,
  });
  stepStartedAt = Date.now();

  // 1. 주도 섹터 Top 3
  const { data: topSectors, error: sectorError } = await supabase
    .from("sectors")
    .select("id, name, avg_change_rate, change_rate, score, metrics")
    .order("score", { ascending: false })
    .limit(3)
    .returns<SectorRow[]>();

  if (sectorError) {
    throw new Error(`Sector fetch failed: ${sectorError.message}`);
  }
  if (!topSectors || topSectors.length === 0) {
    throw new Error("sectors 테이블에 데이터가 없습니다.");
  }
  logBriefingStep("step_done", {
    step: "load_top_sectors",
    duration_ms: Date.now() - stepStartedAt,
    sector_count: topSectors.length,
  });
  stepStartedAt = Date.now();

  const topSectorIds = topSectors.map((s: SectorRow) => s.id);

  // 1-b. 섹터 5일 모멘텀 (sector_daily 기반)
  const sectorMomentumMap = await fetchSectorMomentum(supabase, topSectorIds, asOf);

  // 2. 상위 섹터에 속한 종목들
  const { data: sectorStocks, error: stockError } = await supabase
    .from("stocks")
    .select(
      [
        "code",
        "name",
        "market",
        "sector_id",
        "close",
        "liquidity",
        "avg_volume_20d",
        "rsi14",
        "is_sector_leader",
        "universe_level",
      ].join(", ")
    )
    .in("sector_id", topSectorIds)
    .eq("is_active", true)
    .in("market", ["KOSPI", "KOSDAQ"])
    .in("universe_level", ["core", "extended"])
    .order("is_sector_leader", { ascending: false })
    .order("liquidity", { ascending: false })
    .limit(80)
    .returns<StockRow[]>();

  if (stockError) {
    throw new Error(`Stock fetch failed: ${stockError.message}`);
  }

  const sectorStockCodes = (sectorStocks ?? []).map((s: StockRow) => s.code);

  // 3. 위 종목들에 대한 score 정보 (최신 asof 우선 + 종목별 fallback)
  const sectorScoreResult = await fetchScoresByCodes(supabase, sectorStockCodes);
  const scoresByCode = sectorScoreResult.byCode;

  const watchlistItems = options?.chatId
    ? await fetchWatchlistItems(supabase, options.chatId)
    : [];
  const watchlistCodes = watchlistItems.map((item: WatchlistRow) => item.code);
  const watchlistScoreResult = await fetchScoresByCodes(supabase, watchlistCodes);
  watchlistScoreResult.byCode.forEach((value, key) => scoresByCode.set(key, value));

  const scoreAsOf =
    sectorScoreResult.latestAsof ?? watchlistScoreResult.latestAsof ?? asOf;
  logBriefingStep("step_done", {
    step: "load_scores_watchlist",
    duration_ms: Date.now() - stepStartedAt,
    score_asof: scoreAsOf,
    universe_count: sectorStockCodes.length,
    watch_count: watchlistCodes.length,
  });
  stepStartedAt = Date.now();

  // 4. '밑에서' 턴어라운드 후보
  const bottomCandidates = await fetchBottomTurnaroundCandidates(
    supabase,
    riskProfile
  );

  const briefingFundamentalCandidates = [
    ...topSectors.flatMap((sector: SectorRow) => {
      const stocksOfSector =
        sectorStocks?.filter((s: StockRow) => s.sector_id === sector.id) ?? [];
      return pickTopStocksForSector(stocksOfSector, scoresByCode, 5, riskProfile);
    }),
    ...bottomCandidates,
  ];
  const briefingFundamentalCodes = [...new Set(briefingFundamentalCandidates.map((item: BriefingCandidate) => item.code))];
  // Batch load fundamentals from DB; fallback to live scrape when missing
  const dbFundMap = await fundamentalStore.getFundamentalSnapshotsForCodes(
    briefingFundamentalCodes
  );

  function mapDbToServiceShapeForBriefing(db: any): FundamentalSnapshot | null {
    if (!db) return null;
    return {
      sectorName: db.sector_name ?? undefined,
      sectorCategory: db.sector_category ?? undefined,
      profileLabel: db.profile_label ?? undefined,
      profileNote: db.profile_note ?? undefined,
      per: db.per ?? undefined,
      pbr: db.pbr ?? undefined,
      roe: db.roe ?? undefined,
      debtRatio: db.debt_ratio ?? undefined,
      sales: db.sales ?? undefined,
      opIncome: db.operating_income ?? undefined,
      netIncome: db.net_income ?? undefined,
      salesGrowthPct: db.computed?.salesGrowthPct ?? undefined,
      salesGrowthLowBase: db.computed?.salesGrowthLowBase ?? false,
      opIncomeGrowthPct: db.computed?.opIncomeGrowthPct ?? undefined,
      opIncomeGrowthLowBase: db.computed?.opIncomeGrowthLowBase ?? false,
      opIncomeTurnaround: db.computed?.opIncomeTurnaround ?? false,
      netIncomeGrowthPct: db.computed?.netIncomeGrowthPct ?? undefined,
      netIncomeGrowthLowBase: db.computed?.netIncomeGrowthLowBase ?? false,
      netIncomeTurnaround: db.computed?.netIncomeTurnaround ?? false,
      qualityScore: db.computed?.qualityScore ?? 50,
      commentary: db.computed?.commentary ?? "",
    } as FundamentalSnapshot;
  }

  const fundamentalByCode = new Map<string, FundamentalSnapshot>();
  for (const code of briefingFundamentalCodes) {
    const dbRec = dbFundMap[code] ?? null;
    if (dbRec) {
      fundamentalByCode.set(code, mapDbToServiceShapeForBriefing(dbRec)!);
      continue;
    }
    // fallback to live scrape if DB missing
    try {
      const live = await liveGetFundamentalSnapshot(code).catch(() => null);
      if (live) fundamentalByCode.set(code, live as FundamentalSnapshot);
    } catch {
      // ignore
    }
  }

  // 6. 실시간 가격 일괄 조회
  const allCodes = (sectorStocks ?? []).map((s: StockRow) => s.code);
  const bottomCodes = bottomCandidates.map((s: BriefingCandidate) => s.code);
  const uniqueCodes = [...new Set([...allCodes, ...bottomCodes, ...watchlistCodes])];
  const realtimeMap = uniqueCodes.length
    ? await fetchRealtimePriceBatch(uniqueCodes).catch(() => ({} as Record<string, any>))
    : {};

  // 7. 글로벌 시장 데이터
  const marketData = await fetchAllMarketData().catch(() => ({} as MarketOverview));
  logBriefingStep("step_done", {
    step: "load_realtime_market",
    duration_ms: Date.now() - stepStartedAt,
    realtime_code_count: uniqueCodes.length,
  });
  stepStartedAt = Date.now();

  // 8. 섹터별 리포트 텍스트 조립
  const sectorReports = topSectors.map((sector: SectorRow) => {
    const stocksOfSector =
      sectorStocks?.filter((s: StockRow) => s.sector_id === sector.id) ?? [];

    const picked = rerankBriefingCandidates(
      pickTopStocksForSector(stocksOfSector, scoresByCode, 5, riskProfile),
      fundamentalByCode,
      3
    );
    const momentum5d = sectorMomentumMap.get(sector.id) ?? null;

    return formatSectorSection(
      sector,
      picked,
      scoresByCode,
      realtimeMap,
      momentum5d,
      fundamentalByCode
    );
  });

  const watchlistMicro = await fetchWatchMicroSignalsByCodes(supabase, watchlistCodes);
  const etfWatchlistStocks = watchlistItems
    .map((item: WatchlistRow) => Array.isArray(item.stock) ? item.stock[0] : item.stock)
    .filter((stock: StockRow | null): stock is StockRow => Boolean(stock && isEtfLike({ market: stock.market, name: stock.name })));
  const etfWatchlistCodes = etfWatchlistStocks.map((stock: StockRow) => stock.code);
  const etfSnapshotMap = new Map<string, EtfSnapshot | null>();
  const etfDistributionMap = new Map<string, EtfDistributionSummary | null>();

  await Promise.all(
    etfWatchlistStocks.map(async (stock: StockRow) => {
      const [snapshot, distribution] = await Promise.all([
        getEtfSnapshot(stock.code).catch(() => null),
        getEtfDistributionSummary(stock.code, stock.name).catch(() => null),
      ]);
      etfSnapshotMap.set(stock.code, snapshot);
      etfDistributionMap.set(stock.code, distribution);
    })
  );

  const watchlistViewItems = buildWatchlistViewItems(
    watchlistItems,
    scoresByCode,
    realtimeMap,
    etfSnapshotMap,
    etfDistributionMap
  );

  // 액션 우선 + 손익 변동 우선 기준으로 최대 3개 감성 수집
  const sentimentTargetCodes = watchlistViewItems
    .slice()
    .sort(
      (a, b) =>
        (statusRank[a.plan.status] ?? 9) - (statusRank[b.plan.status] ?? 9) ||
        Math.abs(b.profitPct ?? 0) - Math.abs(a.profitPct ?? 0) ||
        b.totalScore - a.totalScore
    )
    .slice(0, 3)
    .map((item) => item.code);
  const newsSentimentByCode = new Map<string, SentimentResult>();
  await Promise.all(
    sentimentTargetCodes.map(async (code) => {
      try {
        const news = await fetchStockNews(code, 5);
        if (news.length) {
          newsSentimentByCode.set(code, analyzeNewsSentiment(news.map((n) => n.title)));
        }
      } catch {
        // 뉴스 조회 실패는 브리핑을 차단하지 않음
      }
    })
  );

  const watchlistSection = await formatWatchlistSection(
    watchlistItems.filter(hasVirtualPosition),
    scoresByCode,
    realtimeMap,
    topSectors,
    watchlistMicro,
    newsSentimentByCode,
    watchlistViewItems.filter((item: WatchlistViewItem) => {
      const matched = watchlistItems.find((row: WatchlistRow) => row.code === item.code);
      return matched ? hasVirtualPosition(matched) : false;
    })
  );
  const watchOnlySection = await formatWatchOnlySection(
    watchlistItems.filter(isWatchOnlyItem),
    scoresByCode,
    realtimeMap,
    topSectors,
    watchlistViewItems.filter((item: WatchlistViewItem) => {
      const matched = watchlistItems.find((row: WatchlistRow) => row.code === item.code);
      return matched ? isWatchOnlyItem(matched) : false;
    })
  );
  logBriefingStep("step_done", {
    step: "compose_sections",
    duration_ms: Date.now() - stepStartedAt,
  });

  // 9. 빈집털이 섹션 텍스트 조립
  const bottomSectionText = formatBottomSection(
    rerankBriefingCandidates(bottomCandidates, fundamentalByCode, 5),
    realtimeMap,
    fundamentalByCode
  );

  // 2-1: 일손실 한도 도달 경고
  let dailyLossWarning = "";
  if (options?.chatId) {
    try {
      const DEFAULT_DAILY_LOSS_LIMIT_PCT = 5;
      const prefs = await getUserInvestmentPrefs(options.chatId);
      const riskBaseCapital = Number(prefs.virtual_seed_capital ?? prefs.capital_krw ?? 0);
      const dailyLossLimitPct = Number(prefs.daily_loss_limit_pct ?? DEFAULT_DAILY_LOSS_LIMIT_PCT);
      const dailyLossLimitAmount = riskBaseCapital > 0 && dailyLossLimitPct > 0
        ? (riskBaseCapital * dailyLossLimitPct) / 100
        : 0;
      if (dailyLossLimitAmount > 0) {
        const dayMs = 24 * 60 * 60 * 1000;
        const kstOffsetMs = 9 * 60 * 60 * 1000;
        const kstNowMs = Date.now() + kstOffsetMs;
        const kstStartMs = Math.floor(kstNowMs / dayMs) * dayMs;
        const utcStartIso = new Date(kstStartMs - kstOffsetMs).toISOString();
        const utcEndIso = new Date(kstStartMs - kstOffsetMs + dayMs).toISOString();
        const { data: tradeRows } = await supabase
          .from(PORTFOLIO_TABLES.trades)
          .select("pnl_amount")
          .eq("chat_id", options.chatId)
          .gte("traded_at", utcStartIso)
          .lt("traded_at", utcEndIso);
        const dailyPnl = (tradeRows ?? []).reduce((sum: number, row: any) => {
          const pnl = Number(row?.pnl_amount ?? 0);
          return Number.isFinite(pnl) ? sum + pnl : sum;
        }, 0);
        if (dailyPnl <= -dailyLossLimitAmount) {
          dailyLossWarning = `\n\n⛔ <b>오늘 일손실 한도 도달</b> — 추천 확인만 권고\n  실현손익 <code>${dailyPnl.toLocaleString("ko-KR")}원</code> / 한도 <code>-${dailyLossLimitAmount.toLocaleString("ko-KR")}원</code>\n  오늘 신규 진입은 자제하고 보유 종목 리스크 점검을 우선하세요.`;
        }
      }
    } catch {
      // 일손실 체크 실패는 브리핑을 차단하지 않음
    }
  }
    // 9. 빈집털이 섹션 텍스트 조립

  // 10. 최종 메시지 합치기
  // 장전 브리핑: 오늘(발송일) 날짜, 마감 브리핑: 오늘 날짜
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000); // UTC → KST
  const briefingDate = kst.toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });

  const dataDate = new Date(asOf).toLocaleDateString("ko-KR", {
    month: "numeric",
    day: "numeric",
  });

  const typeLabel = type === "pre_market" ? "장전 브리핑" : "마감 브리핑";
  const title = `<b>${briefingDate} ${typeLabel}</b>`;

  let report = `${title}\n─────────────────\n\n`;

  // 글로벌 환경 요약
  report += `<b>시장 환경</b>\n`;
  const mktLines: string[] = [];
  if (marketData.kospi) {
    const k = marketData.kospi;
    mktLines.push(`  KOSPI  <b>${k.price.toLocaleString()}</b> ${fmtChange(k.changeRate)}`);
  }
  if (marketData.kosdaq) {
    const kd = marketData.kosdaq;
    mktLines.push(`  KOSDAQ <b>${kd.price.toLocaleString()}</b> ${fmtChange(kd.changeRate)}`);
  }
  if (marketData.sp500) {
    const sp = marketData.sp500;
    mktLines.push(`  S&P500 <b>${sp.price.toLocaleString()}</b> ${fmtChange(sp.changeRate)}`);
  }
  if (marketData.nasdaq) {
    const nq = marketData.nasdaq;
    mktLines.push(`  NASDAQ <b>${nq.price.toLocaleString()}</b> ${fmtChange(nq.changeRate)}`);
  }
  if (marketData.dow) {
    const dj = marketData.dow;
    mktLines.push(`  DOW    <b>${dj.price.toLocaleString()}</b> ${fmtChange(dj.changeRate)}`);
  }
  if (marketData.vix) {
    const v = marketData.vix;
    const tag = v.price >= 30 ? "⚠️ 공포" : v.price >= 20 ? "🟡 주의" : "🟢 안정";
    mktLines.push(`  VIX   <b>${v.price.toFixed(1)}</b> ${tag}`);
  }
  if (marketData.usdkrw) {
    const fx = marketData.usdkrw;
    mktLines.push(`  환율  <b>${fx.price.toLocaleString()}원</b> ${fmtChange(fx.changeRate)}`);
  }
  if (marketData.fearGreed) {
    const fg = marketData.fearGreed;
    mktLines.push(`  공포·탐욕  <b>${fg.score}</b> (${fg.rating})`);
  }
  report += mktLines.length > 0 ? mktLines.join("\n") + "\n" : "  (조회 불가)\n";

  const usIndexChanges = [
    marketData.sp500?.changeRate,
    marketData.nasdaq?.changeRate,
    marketData.dow?.changeRate,
  ].filter((value): value is number => Number.isFinite(value));
  if (usIndexChanges.length >= 2) {
    const usAvg = usIndexChanges.reduce((sum, value) => sum + value, 0) / usIndexChanges.length;
    if (usAvg <= -1.2) {
      report += `  대응 포인트  <b>미국 3대 지수 약세</b> → 초반 변동성 확인 후 분할 진입\n`;
    } else if (usAvg >= 1.2) {
      report += `  대응 포인트  <b>미국 3대 지수 강세</b> → 주도 섹터 대표주 중심으로 단계적 진입\n`;
    }
  }

  if (marketData.meta) {
    const quality = marketData.meta.isPartial ? "⚠️ 부분 수집" : "✅ 정상";
    const fetchedAtLabel = formatKstDateTimeLabel(marketData.meta.fetchedAt) ?? "확인 불가";
    report += `  데이터 상태  <b>${quality}</b>\n`;
    report += `  조회 시각  ${fetchedAtLabel} KST\n`;
    if (marketData.meta.isPartial) {
      report += `  누락 항목  ${formatMissingMetricList(marketData.meta.missing)}\n`;
    }
  }

  let riskSignalSection = "";
  try {
    const { calculateRiskSignals } = await import("./riskSignalService.js");
    const riskSignals = await calculateRiskSignals(supabase, marketData as any, { chatId: options?.chatId });
    riskSignalSection = `\n${riskSignals.html_brief}\n`;
    if (riskSignals.signal_count > 0) {
      riskSignalSection += riskSignals.strategy_options + "\n";
    }
  } catch (error) {
    console.error("[briefingService] Error calculating risk signals:", error);
  }
  report += riskSignalSection;

  report += `\n<b>주도 테마 Top 3</b>\n`;
  report += sectorReports.join("\n\n");

  report += `\n\n<b>관심 종목 요약</b>\n`;
  report += watchOnlySection;

  report += `\n\n<b>내 보유 종목 체크</b>\n`;
  report += watchlistSection;
  report += dailyLossWarning;

  report += `\n\n<b>눌림 대기 후보</b> <i>과매도 + 모멘텀 개선</i>\n`;
  report += bottomSectionText;

  report += `\n─────────────────\n`;
  report += `<i>📊 데이터 기준: ${dataDate} | 점수 기준: ${scoreAsOf}</i>\n`;
  const staleSector = isBusinessStale(asOf, 1);
  const staleScore = isBusinessStale(scoreAsOf, 1);
  if (staleSector || staleScore) {
    report += `<i>⚠️ 신선도 경고: 시세/지표 스냅샷이 지연되었습니다. (섹터 ${buildFreshnessLabel(asOf, 1)} · 점수 ${buildFreshnessLabel(scoreAsOf, 1)})</i>\n`;
    report += `<i>권장: 장중에는 /종목분석으로 실시간 가격과 함께 재확인하세요.</i>\n`;
  }
  if (marketData.meta) {
    const quality = marketData.meta.isPartial ? "부분 수집" : "정상";
    const fetchedAtLabel = formatKstDateTimeLabel(marketData.meta.fetchedAt);
    report += `<i>🌐 시장 데이터: ${quality}${fetchedAtLabel ? ` | 조회 ${fetchedAtLabel} KST` : ""}</i>\n`;
  }
  report += `/종목분석 종목코드 · /눌림목 · /경제 · /시장`;

  logBriefingStep("done", {
    step: "create_briefing_report",
    duration_ms: Date.now() - startedAt,
    chat_id: options?.chatId,
    type,
  });

  return report;
}

// ===== scores 조회 & 후보 조회 유틸 =====

async function fetchScoresByCodes(
  supabase: SupabaseClient,
  codes: string[]
) {
  return fetchLatestScoresByCodes(supabase, codes);
}

async function fetchBottomTurnaroundCandidates(
  supabase: SupabaseClient,
  riskProfile: RiskProfile
) {
  const { data: lowRsiStocks, error: lowRsiError } = await supabase
    .from("stocks")
    .select("code, name, market, close, liquidity, rsi14, universe_level")
    .lt("rsi14", 35)
    .eq("is_active", true)
    .in("market", ["KOSPI", "KOSDAQ"])
    .in("universe_level", ["core", "extended"])
    .order("rsi14", { ascending: true })
    .limit(100)
    .returns<Pick<StockRow, "code" | "name" | "market" | "close" | "liquidity" | "rsi14" | "universe_level">[]>();

  if (lowRsiError) {
    throw new Error(`Low-RSI stocks fetch failed: ${lowRsiError.message}`);
  }

  if (!lowRsiStocks || lowRsiStocks.length === 0) return [];

  const codes = lowRsiStocks.map((s: Pick<StockRow, "code" | "name" | "market" | "close" | "liquidity" | "rsi14" | "universe_level">) => s.code);

  const scoreResult = await fetchScoresByCodes(supabase, codes);
  const byCode = scoreResult.byCode;

  const candidates = lowRsiStocks
    .map((stock: Pick<StockRow, "code" | "name" | "market" | "close" | "liquidity" | "rsi14" | "universe_level">) => {
      const score = byCode.get(stock.code);
      const factors = (score?.factors ?? {}) as Json;

      const roc21 = toNumber(
        factors.roc_21 ?? factors.roc21 ?? factors.ret_1m ?? factors.return_1m
      );

      return {
        ...stock,
        momentum_score: score?.momentum_score ?? null,
        total_score: score?.total_score ?? null,
        roc21,
      };
    })
    .filter((s: BriefingCandidate) => (s.roc21 ?? 0) > 0);

  return pickSaferCandidates<BriefingCandidate>(candidates, 5, riskProfile);
}

async function fetchWatchlistItems(
  supabase: SupabaseClient,
  chatId: number
) {
  const { data, error } = await supabase
    .from(PORTFOLIO_TABLES.positionsLegacy)
    .select(
      [
        "code",
        "buy_price",
        "buy_date",
        "created_at",
        "quantity",
        "invested_amount",
        "memo",
        "stock:stocks!inner(code, name, market, sector_id, close, liquidity, avg_volume_20d, rsi14, is_sector_leader, universe_level)",
      ].join(", ")
    )
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true })
    .limit(6)
    .returns<WatchlistRow[]>();

  if (error) {
    throw new Error(`Watchlist fetch failed: ${error.message}`);
  }

  return data ?? [];
}

function buildWatchlistViewItems(
  items: WatchlistRow[],
  scoresByCode: Map<string, ScoreRow>,
  realtimeMap: Record<string, any>,
  etfSnapshotMap: Map<string, EtfSnapshot | null> = new Map(),
  etfDistributionMap: Map<string, EtfDistributionSummary | null> = new Map()
): WatchlistViewItem[] {
  return items.reduce<WatchlistViewItem[]>((acc, item) => {
      const stock = Array.isArray(item.stock) ? item.stock[0] : item.stock;
      if (!stock) return acc;

      const score = scoresByCode.get(item.code);
      const total = score?.total_score ?? score?.momentum_score ?? 0;
      const rt = realtimeMap[item.code];
      const price = Number(rt?.price ?? stock.close ?? 0);
      const plan = buildInvestmentPlan({
        currentPrice: price,
        factors: { rsi14: stock.rsi14 ?? undefined },
        technicalScore: total || undefined,
      });
      const buyPrice = Number(item.buy_price ?? 0);
      const profitPct = buyPrice > 0 && price > 0
        ? ((price - buyPrice) / buyPrice) * 100
        : null;

      acc.push({
        code: item.code,
        name: stock.name,
        market: stock.market ?? null,
        sectorId: stock.sector_id ?? null,
        currentPrice: price,
        changeRate: rt?.changeRate ?? null,
        buyPrice: buyPrice > 0 ? buyPrice : null,
        profitPct,
        totalScore: Number(total) || 0,
        plan,
        etfSnapshot: etfSnapshotMap.get(item.code) ?? null,
        etfDistribution: etfDistributionMap.get(item.code) ?? null,
      });

      return acc;
    }, []);
}

function buildBriefingConcentrationSummary(items: WatchlistRow[]): string[] {
  const concentrations = calculateSectorConcentration(
    items.map((item) => {
      const stock = Array.isArray(item.stock) ? item.stock[0] : item.stock;
      return {
        sectorId: stock?.sector_id ?? null,
        investedAmount: Number(item.invested_amount ?? 0),
      };
    })
  );
  const warnings = getSectorConcentrationWarnings(concentrations);
  if (!warnings.length) return [];

  const top = warnings[0];
  const icon = top.level === "danger" ? "🔴" : "⚠️";
  const levelText = top.level === "danger"
    ? `${SECTOR_CONCENTRATION_DANGER_RATIO}% 초과 집중`
    : `${SECTOR_CONCENTRATION_WARNING_RATIO}% 초과 집중`;

  return [
    `  ${icon} 섹터 집중 경고: ${top.sectorName} ${top.ratio.toFixed(0)}% (${levelText})`,
    "  분산 투자 또는 비중 조정 검토",
  ];
}

function pickTopStocksForSector(
  stocks: StockRow[],
  scoresByCode: Map<string, ScoreRow>,
  limit: number,
  riskProfile: RiskProfile
): BriefingCandidate[] {
  const scored: BriefingCandidate[] = stocks.map((s: StockRow) => {
    const score = scoresByCode.get(s.code);
    const total = toNumber(score?.total_score ?? score?.momentum_score ?? 0);

    return {
      ...s,
      total_score: total,
    };
  });

  return pickSaferCandidates<BriefingCandidate>(scored, limit, riskProfile);
}

function rerankBriefingCandidates<T extends { code: string; total_score?: number | null }>(
  stocks: T[],
  fundamentals: Map<string, FundamentalSnapshot>,
  limit: number
): T[] {
  return [...stocks]
    .sort((a, b) => {
      const fa = fundamentals.get(a.code);
      const fb = fundamentals.get(b.code);
      const qa = fa?.qualityScore ?? 50;
      const qb = fb?.qualityScore ?? 50;
      const wa = getFundamentalWarningTags(fa ?? {}).length;
      const wb = getFundamentalWarningTags(fb ?? {}).length;
      const sa = Number(a.total_score ?? 0) + qa * 0.35 - wa * 8;
      const sb = Number(b.total_score ?? 0) + qb * 0.35 - wb * 8;
      return sb - sa;
    })
    .slice(0, limit);
}

// ===== 포맷팅 =====

function formatSectorSection(
  sector: SectorRow,
  stocks: BriefingCandidate[],
  scoresByCode: Map<string, ScoreRow>,
  realtimeMap: Record<string, any>,
  momentum5d?: number | null,
  fundamentalByCode?: Map<string, FundamentalSnapshot>
) {
  const metrics = (sector.metrics ?? {}) as Json;

  const ret1m = toNumber(metrics.ret_1m ?? metrics.return_1m);
  const change = sector.change_rate as number | null;

  // 5일 모멘텀 태그
  let momTag = "";
  if (momentum5d != null && Number.isFinite(momentum5d)) {
    const icon = momentum5d >= 1 ? "📈" : momentum5d <= -1 ? "📉" : "➡️";
    momTag = `  ${icon} 5일 ${fmtPct(momentum5d)}`;
  }

  let header = `<b>${sector.name}</b>`;
  header += `  점수 <b>${fmtInt(sector.score)}</b>`;
  header += `  ${fmtChange(change)}`;
  header += momTag;
  if (ret1m != null) header += `  1M ${fmtPct(ret1m)}`;

  const lines: string[] = [header];

  // 섹터 하락 추세 경고 (-2% 이상 하락 시)
  if (momentum5d != null && momentum5d < -2) {
    lines.push(
      `  ⚠️ <i>${pickVariant(`${sector.name}|sector|warning|${momentum5d.toFixed(2)}`, [
        `섹터 하락 추세 (5일 ${fmtPct(momentum5d)}) — 신규 진입 주의`,
        `단기 약세 지속 (5일 ${fmtPct(momentum5d)}) — 분할 접근 권장`,
        `모멘텀 둔화 구간 (5일 ${fmtPct(momentum5d)}) — 추격 진입 자제`,
      ])}</i>`
    );
  }

  if (!stocks || stocks.length === 0) {
    lines.push(`  <i>집계된 유동성 종목 없음</i>`);
    return lines.join("\n");
  }

  stocks.slice(0, 2).forEach((stock) => {
    const score = scoresByCode.get(stock.code);
    const total = score?.total_score ?? score?.momentum_score ?? null;

    // 실시간 가격 우선, 없으면 DB 가격
    const rt = realtimeMap[stock.code];
    const price = rt?.price ?? stock.close;
    const priceStr = price != null ? Number(price).toLocaleString("ko-KR") : "-";
    const changeStr = rt ? ` ${fmtChange(rt.changeRate)}` : "";

    const plan = buildInvestmentPlan({
      currentPrice: Number(price ?? 0),
      factors: { rsi14: stock.rsi14 ?? undefined },
      technicalScore: total ?? undefined,
    });
    const fundamentalWarnings = fundamentalByCode?.get(stock.code)
      ? getFundamentalWarningTags(fundamentalByCode.get(stock.code)!).slice(0, 2)
      : [];

    lines.push(
      `  <b>${stock.name}</b> <code>${priceStr}원</code>${changeStr}`
    );

    lines.push(
      `     ${plan.statusLabel} · 진입 ${fmtInt(plan.entryLow)}~${fmtInt(plan.entryHigh)} · 1차 ${fmtPct(plan.target1Pct * 100)}`
    );
    if (fundamentalWarnings.length) {
      lines.push(`     재무 ${fundamentalWarnings.join(", ")}`);
    }
  });

  return lines.join("\n");
}

function formatBottomSection(
  candidates: BriefingCandidate[],
  realtimeMap: Record<string, any>,
  fundamentalByCode?: Map<string, FundamentalSnapshot>
) {
  if (!candidates || candidates.length === 0) {
    return "  <i>감지된 종목이 없습니다.</i>\n";
  }

  return (
    candidates
      .slice(0, 2)
      .map((s: BriefingCandidate) => {
        const rt = realtimeMap[s.code];
        const price = rt?.price ?? s.close;
        const priceStr = price != null ? Number(price).toLocaleString("ko-KR") : "-";
        const changeStr = rt ? ` ${fmtChange(rt.changeRate)}` : "";
        const plan = buildInvestmentPlan({
          currentPrice: Number(price ?? 0),
          factors: { rsi14: s.rsi14 ?? undefined },
          technicalScore: s.total_score ?? s.momentum_score ?? undefined,
        });
        const fundamentalWarnings = fundamentalByCode?.get(s.code)
          ? getFundamentalWarningTags(fundamentalByCode.get(s.code)!).slice(0, 2)
          : [];

        let line = `  ▸ <b>${s.name}</b> <code>${priceStr}원</code>${changeStr}`;
        line += `\n     ${plan.statusLabel} · 진입 ${fmtInt(plan.entryLow)}~${fmtInt(plan.entryHigh)} · 1차 ${fmtPct(plan.target1Pct * 100)}`;
        if (fundamentalWarnings.length) {
          line += `\n     재무 ${fundamentalWarnings.join(", ")}`;
        }
        return line;
      })
      .join("\n") + "\n"
  );
}

function buildSummaryCommandsLine(commands: string[]): string {
  return `  상세: ${commands.join(" · ")}`;
}

function sortBriefingViewItems(viewItems: WatchlistViewItem[]): WatchlistViewItem[] {
  return viewItems
    .slice()
    .sort(
      (a, b) =>
        (statusRank[a.plan.status] ?? 9) - (statusRank[b.plan.status] ?? 9) ||
        Math.abs(b.profitPct ?? 0) - Math.abs(a.profitPct ?? 0) ||
        b.totalScore - a.totalScore
    );
}

async function formatWatchOnlySection(
  items: WatchlistRow[],
  scoresByCode: Map<string, ScoreRow>,
  realtimeMap: Record<string, any>,
  topSectors: SectorRow[],
  viewItemsInput?: WatchlistViewItem[]
) {
  if (!items.length) {
    return [
      "  관심 종목 없음",
      buildSummaryCommandsLine(["/관심", "/관심추가", "/관심대응"]),
    ].join("\n") + "\n";
  }

  const viewItems = viewItemsInput ?? buildWatchlistViewItems(items, scoresByCode, realtimeMap);
  if (!viewItems.length) {
    return [
      "  관심 종목을 불러오지 못했습니다.",
      buildSummaryCommandsLine(["/관심", "/관심대응"]),
    ].join("\n") + "\n";
  }

  const sortedItems = sortBriefingViewItems(viewItems);
  const actionable = sortedItems.filter((item) => item.plan.status === "buy-now").length;
  const pullback = sortedItems.filter((item) => item.plan.status === "buy-on-pullback").length;
  const wait = sortedItems.filter((item) => item.plan.status === "wait").length;
  const topSectorNameById = new Map(topSectors.map((sector) => [sector.id, sector.name]));
  const overlappingThemes = Array.from(
    new Set(
      sortedItems
        .map((item) => item.sectorId)
        .filter((sectorId): sectorId is string => Boolean(sectorId && topSectorNameById.has(sectorId)))
        .map((sectorId) => topSectorNameById.get(sectorId) as string)
    )
  );

  const summaryLines = [
    `  관심 ${sortedItems.length}건 · 즉시 검토 ${actionable}건 · 눌림 대기 ${pullback}건 · 관망 ${wait}건`,
  ];
  if (overlappingThemes.length) {
    summaryLines.push(`  주도 테마와 겹침: ${overlappingThemes.slice(0, 2).join(", ")}`);
  }
  summaryLines.push(buildSummaryCommandsLine(["/관심", "/관심대응"]));

  const lines = sortedItems.slice(0, 2).map((item) => {
    const changeStr = item.changeRate != null ? ` ${fmtChange(item.changeRate)}` : "";
    return [
      `  ▸ <b>${item.name}</b> <code>${fmtInt(item.currentPrice)}원</code>${changeStr}`,
      `     ${item.plan.statusLabel} · 진입 ${fmtInt(item.plan.entryLow)}~${fmtInt(item.plan.entryHigh)} · 1차 ${fmtPct(item.plan.target1Pct * 100)}`,
    ].join("\n");
  });

  if (sortedItems.length > 2) {
    lines.push(`  외 ${sortedItems.length - 2}건은 /관심 또는 /관심대응 에서 확인`);
  }

  return `${summaryLines.join("\n")}\n${lines.join("\n")}\n`;
}

async function formatWatchlistSection(
  items: WatchlistRow[],
  scoresByCode: Map<string, ScoreRow>,
  realtimeMap: Record<string, any>,
  topSectors: SectorRow[],
  microByCode: Map<string, WatchMicroSignal>,
  newsSentimentByCode: Map<string, SentimentResult> = new Map(),
  viewItemsInput?: WatchlistViewItem[]
) {
  if (!items.length) {
    return [
      "  보유 종목 없음",
      buildSummaryCommandsLine(["/보유", "/가상매수", "/보유대응"]),
    ].join("\n") + "\n";
  }

  const viewItems = viewItemsInput ?? buildWatchlistViewItems(items, scoresByCode, realtimeMap);

  if (!viewItems.length) {
    return "  <i>등록된 보유 종목을 불러오지 못했습니다.</i>\n";
  }

  const sortedItems = sortBriefingViewItems(viewItems);

  const actionable = sortedItems.filter((item) => item.plan.status === "buy-now").length;
  const pullback = sortedItems.filter((item) => item.plan.status === "buy-on-pullback").length;
  const wait = sortedItems.filter((item) => item.plan.status === "wait").length;

  const topSectorNameById = new Map(topSectors.map((sector) => [sector.id, sector.name]));
  const overlappingThemes = Array.from(
    new Set(
      sortedItems
        .map((item) => item.sectorId)
        .filter((sectorId): sectorId is string => Boolean(sectorId && topSectorNameById.has(sectorId)))
        .map((sectorId) => topSectorNameById.get(sectorId) as string)
    )
  );

  const topGainer = sortedItems
    .filter((item) => item.profitPct !== null)
    .sort((a, b) => Number(b.profitPct) - Number(a.profitPct))[0];
  const topLoser = sortedItems
    .filter((item) => item.profitPct !== null)
    .sort((a, b) => Number(a.profitPct) - Number(b.profitPct))[0];

  const summaryLines = [
    `  ${pickVariant(`${sortedItems.length}|watch|summary|${actionable}|${pullback}|${wait}`, [
      `오늘 액션 ${actionable}건 · 눌림 대기 ${pullback}건 · 관망 ${wait}건`,
      `당일 대응 ${actionable}건 · 눌림 체크 ${pullback}건 · 관망 ${wait}건`,
      `오늘 우선순위 액션 ${actionable}건 · 대기 ${pullback}건 · 관망 ${wait}건`,
    ])}`,
  ];
  const etfCount = sortedItems.filter((item) => isEtfLike({ market: item.market, name: item.name })).length;
  const stockCount = sortedItems.length - etfCount;
  if (stockCount > 0 || etfCount > 0) {
    summaryLines.push(`  보유 구성 주식 ${stockCount}건 · ETF ${etfCount}건`);
  }
  if (etfCount > 0) {
    summaryLines.push(`  ETF 보유 ${etfCount}건 · NAV/괴리율/분배일 중심으로 체크`);
  }
  summaryLines.push(...buildBriefingConcentrationSummary(items));

  const microTriggered = sortedItems.filter((item) => {
    const micro = microByCode.get(item.code);
    return Boolean(micro?.valueAnomaly || micro?.flowShift);
  }).length;
  if (microTriggered > 0) {
    summaryLines.push(`  이상 트리거 감지 ${microTriggered}건 (거래대금/수급)`);
  }

  if (overlappingThemes.length) {
    summaryLines.push(`  주도 테마와 겹침: ${overlappingThemes.slice(0, 2).join(", ")}`);
  }
  if (topGainer && Number(topGainer.profitPct) >= 3) {
    summaryLines.push(`  상대적 강세: ${topGainer.name} ${fmtPct(topGainer.profitPct)}`);
  }
  if (topLoser && Number(topLoser.profitPct) <= -3) {
    summaryLines.push(
      `  ${pickVariant(`${topLoser.code}|watch|loser|${Number(topLoser.profitPct).toFixed(2)}`, [
        `손절 재점검: ${topLoser.name} ${fmtPct(topLoser.profitPct)}`,
        `리스크 우선 점검: ${topLoser.name} ${fmtPct(topLoser.profitPct)}`,
        `방어 체크 대상: ${topLoser.name} ${fmtPct(topLoser.profitPct)}`,
      ])}`
    );
  }

  summaryLines.push(buildSummaryCommandsLine(["/보유", "/보유대응"]));

  const lines = sortedItems.slice(0, 2).map((item) => {
    const micro = microByCode.get(item.code);
    const triggerLine = micro?.triggerReasons?.length
      ? `     트리거 ${micro.triggerReasons.join(", ")}`
      : "     트리거 없음 (조건 대기)";
    const changeStr = item.changeRate != null ? ` ${fmtChange(item.changeRate)}` : "";
    const buyBase = item.buyPrice ? ` · 기준 ${fmtPct(item.profitPct)}` : "";
    const isEtf = isEtfLike({ market: item.market, name: item.name });
    const todayAction =
      isEtf
        ? `오늘 ETF 체크: ${buildEtfBriefingAction(item)}`
        : item.plan.status === "buy-now"
          ? `오늘 액션: ${item.plan.summary}`
          : item.plan.status === "buy-on-pullback"
            ? `오늘 액션: 20일선 부근 ${fmtInt(item.plan.entryLow)}~${fmtInt(item.plan.entryHigh)} 대기`
            : `오늘 액션: ${item.plan.summary}`;

    // 뉴스 감성 라벨 (buy-now 또는 감성 주목할 만한 종목만)
    const sentimentResult = newsSentimentByCode.get(item.code);
    const newsTag = sentimentResult
      ? (() => {
          const emoji = sentimentEmoji(sentimentResult.score);
          if (!emoji) return null;
          const matches = sentimentResult.score > 0
            ? sentimentResult.positiveMatches
            : sentimentResult.negativeMatches;
          return `     뉴스 ${emoji} ${matches.slice(0, 2).join(", ")}`;
        })()
      : null;
    return [
      `  ▸ <b>${item.name}</b>${isEtf ? " [ETF]" : ""} <code>${fmtInt(item.currentPrice)}원</code>${changeStr}${buyBase}`,
      isEtf
        ? `     ${item.plan.statusLabel} · ${buildEtfBriefingAction(item)}`
        : `     ${item.plan.statusLabel} · 손절 ${fmtInt(item.plan.stopPrice)} · 1차 ${fmtPct(item.plan.target1Pct * 100)}`,
      `     ${todayAction}`,
      triggerLine,
      ...newsTag ? [newsTag] : [],
    ].join("\n");
  });

  if (sortedItems.length > 2) {
    lines.push(`  외 ${sortedItems.length - 2}건은 /보유 또는 /보유대응 에서 확인`);
  }

  return `${summaryLines.join("\n")}\n${lines.join("\n")}\n`;
}

// ===== 섹터 5일 모멘텀 헬퍼 =====

async function fetchSectorMomentum(
  supabase: SupabaseClient,
  sectorIds: string[],
  asOf: string
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!sectorIds.length) return map;

  // 최근 10 캘린더일 조회 (영업일 5개 확보)
  const from = new Date(asOf);
  from.setDate(from.getDate() - 10);
  const fromStr = from.toISOString().slice(0, 10);

  const { data } = await supabase
    .from("sector_daily")
    .select("sector_id, date, close")
    .in("sector_id", sectorIds)
    .gte("date", fromStr)
    .lte("date", asOf)
    .order("date", { ascending: true });

  if (!data?.length) return map;

  // 섹터별로 그룹핑
  const bySector = new Map<string, { date: string; close: number }[]>();
  for (const row of data) {
    const list = bySector.get(row.sector_id) ?? [];
    list.push({ date: row.date as string, close: Number(row.close) });
    bySector.set(row.sector_id, list);
  }

  // 5영업일 ROC 계산
  for (const [id, series] of bySector) {
    if (series.length < 2) continue;
    const latest = series[series.length - 1].close;
    // 5봉 전(또는 가능한 가장 이른 봉) 기준
    const refIdx = series.length >= 6 ? series.length - 6 : 0;
    const refClose = series[refIdx].close;
    if (refClose > 0) {
      map.set(id, ((latest - refClose) / refClose) * 100);
    }
  }

  return map;
}

// ===== 공통 헬퍼 =====

function toNumber(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) {
    return "N/A";
  }
  const n = Number(v);
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

/** 등락률 화살표 포맷 (▲/▼ + 색상 느낌) */
function fmtChange(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "";
  const n = Number(v);
  if (n > 0) return `▲${n.toFixed(1)}%`;
  if (n < 0) return `▼${Math.abs(n).toFixed(1)}%`;
  return "0.0%";
}

function fmtInt(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) {
    return "-";
  }
  return String(Math.round(Number(v)));
}

