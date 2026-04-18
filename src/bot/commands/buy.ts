import type { ChatContext } from "../router";
import { createClient } from "@supabase/supabase-js";
import { searchByNameOrCode } from "../../search/normalize";
import { KO_MESSAGES } from "../messages/ko";
import { esc, fmtInt, fmtPct, LINE } from "../messages/format";
import {
  formatFundamentalInline,
  getFundamentalGrowthHints,
} from "../messages/fundamental";
import { getUserInvestmentPrefs } from "../../services/userService";
import { getFundamentalSnapshot } from "../../services/fundamentalService";
import {
  calculateSectorConcentration,
  getSectorConcentrationWarnings,
} from "../../services/portfolioService";
import { actionButtons, ACTIONS } from "../messages/layout";
import { getDailySeries } from "../../adapters";
import { fetchAllMarketData } from "../../utils/fetchMarketData";
import { buildInvestmentPlan } from "../../lib/investPlan";
import {
  scaleScoreFactorsToReferencePrice,
  scaleSeriesToReferencePrice,
} from "../../lib/priceScale";
import { fetchLatestScoresByCodes } from "../../services/scoreSourceService";

// Supabase 클라이언트
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

const DEFAULT_DAILY_LOSS_LIMIT_PCT = 5;

function getKstDayRange(reference = new Date()): { startIso: string; endIso: string; dayLabel: string } {
  const dayMs = 24 * 60 * 60 * 1000;
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const kstNowMs = reference.getTime() + kstOffsetMs;
  const kstStartMs = Math.floor(kstNowMs / dayMs) * dayMs;
  const utcStartMs = kstStartMs - kstOffsetMs;
  const utcEndMs = utcStartMs + dayMs;

  const dayLabel = new Date(utcStartMs).toLocaleDateString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    timeZone: "Asia/Seoul",
  });

  return {
    startIso: new Date(utcStartMs).toISOString(),
    endIso: new Date(utcEndMs).toISOString(),
    dayLabel,
  };
}

async function getDailyRealizedPnl(chatId: number): Promise<number> {
  const { startIso, endIso } = getKstDayRange();
  const { data, error } = await supabase
    .from("virtual_trades")
    .select("pnl_amount")
    .eq("chat_id", chatId)
    .gte("traded_at", startIso)
    .lt("traded_at", endIso);

  if (error) {
    console.error("daily realized pnl query failed:", error);
    return 0;
  }

  return (data ?? []).reduce((sum, row: any) => {
    const pnl = Number(row?.pnl_amount ?? 0);
    return Number.isFinite(pnl) ? sum + pnl : sum;
  }, 0);
}

// --- 메시지 빌더 (HTML) ---
function buildMessage(
  stock: { name: string; code: string },
  currentPrice: number,
  realtimeData: { change?: number; changeRate?: number } | null,
  plan: ReturnType<typeof buildInvestmentPlan>,
  scores?: {
    technicalScore?: number;
    finalScore?: number;
    fundamentalScore?: number;
  },
  fundamental?: {
    qualityScore: number;
    profileLabel?: string;
    profileNote?: string;
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
    commentary?: string;
  },
  investPrefs?: {
    capital: number;
    splitCount: number;
  }
): string {
  const { name, code } = stock;
  const growthHints = fundamental ? getFundamentalGrowthHints(fundamental) : [];

  const changeStr = realtimeData?.changeRate !== undefined
    ? `${(realtimeData.change ?? 0) >= 0 ? "▲" : "▼"} ${Math.abs(realtimeData.changeRate ?? 0).toFixed(2)}%`
    : "";

  const header = [
    `<b>${esc(name)}</b>  <code>${code}</code>`,
    `현재가  <code>${fmtInt(currentPrice)}원</code>  ${changeStr}`,
  ].join("\n");

  const body = [
    LINE,
    scores?.finalScore !== undefined
      ? `<b>종합 점수</b>  <code>${scores.finalScore.toFixed(1)}점</code>${
          scores.technicalScore !== undefined
            ? ` <i>(기술 ${scores.technicalScore.toFixed(1)}${
                scores.fundamentalScore !== undefined
                  ? ` · 재무 ${scores.fundamentalScore.toFixed(1)}`
                  : ""
              })</i>`
            : ""
        }`
      : "",
    `<b>${plan.statusLabel}</b>`,
    plan.summary,
    ``,
    `진입구간  <code>${fmtInt(plan.entryLow)}원</code> ~ <code>${fmtInt(plan.entryHigh)}원</code>`,
    `손절기준  <code>${fmtInt(plan.stopPrice)}원</code> (${fmtPct(-plan.stopPct * 100)})`,
    `목표구간  1차 <code>${fmtInt(plan.target1)}원</code> (${fmtPct(plan.target1Pct * 100)}) · 2차 <code>${fmtInt(plan.target2)}원</code> (${fmtPct(plan.target2Pct * 100)})`,
    `보유시야  ${plan.holdDays[0]}~${plan.holdDays[1]}거래일 · 손익비 ${plan.riskReward}:1`,
    ``,
    `<b>판단 근거</b>`,
    ...plan.rationale.map((line) => `· ${line}`),
    ...(plan.warnings.length ? ["", `<b>주의</b>`, ...plan.warnings.map((line) => `· ${line}`)] : []),
  ].join("\n");

  let planBlock = "";
  if (investPrefs && investPrefs.capital > 0 && investPrefs.splitCount > 0) {
    const capital = investPrefs.capital;
    const splitCount = investPrefs.splitCount;
    const perSplitAmount = Math.floor(capital / splitCount);
    const entryPrice = Math.max(1, Math.round((plan.entryLow + plan.entryHigh) / 2));
    const totalShares = Math.floor(capital / entryPrice);
    const perSplitShares = Math.max(1, Math.floor(totalShares / splitCount));
    const expectedProfit = Math.floor(totalShares * entryPrice * plan.target1Pct);

    planBlock = [
      "",
      LINE,
      "<b>내 투자금 기준</b>",
      `  투자금  <code>${fmtInt(capital)}원</code>`,
      `  분할매수  <code>${splitCount}회</code> (회당 ${fmtInt(perSplitAmount)}원 / 약 ${perSplitShares}주)`,
      `  1차목표 수익  <code>${fmtInt(expectedProfit)}원</code>`,
    ].join("\n");
  }

  const fundamentalBlock = fundamental
    ? [
        "",
        LINE,
        "<b>재무 요약</b>",
        `  ${formatFundamentalInline(fundamental)}`,
        "  <i>현재 PER/PBR은 최근 4분기, 실적은 최근 연간 확정치 기준</i>",
        ...(fundamental.profileNote ? [`  <i>${esc(fundamental.profileNote)}</i>`] : []),
        ...growthHints.map((hint) => `  <i>${esc(hint)}</i>`),
        fundamental.commentary ? `  ${esc(fundamental.commentary)}` : "",
      ].join("\n")
    : "";

  return [header, body, fundamentalBlock, planBlock].filter(Boolean).join("\n");
}

// --- 메인 핸들러 ---
export async function handleBuyCommand(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const query = (input || "").trim();
  if (!query) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        "사용법: /종목분석 종목명 또는 코드",
        "예) /종목분석 삼성전자",
      ].join("\n"),
    });
  }

  // 1. 종목 검색
  const hits = await searchByNameOrCode(query, 5);
  if (!hits?.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.SCORE_NOT_FOUND,
    });
  }

  if (hits.length > 1 && !/^\d{6}$/.test(query.trim())) {
    const btns = hits.slice(0, 5).map((h) => ({
      text: `${h.name} (${h.code})`,
      callback_data: `trade:${h.code}`,
    }));
    const keyboard = actionButtons(btns, 2);
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `'${esc(query)}' 검색 결과 ${hits.length}건 — 종목을 선택하세요`,
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
    return;
  }

  const { code, name } = hits[0];

  const { data: stock, error } = await supabase
    .from("stocks")
    .select(
      `
      code, name, close, sma20, sma50, rsi14, universe_level, sector_id
    `
    )
    .eq("code", code)
    .single();

  if (error || !stock) {
    console.error("Supabase query failed in handleBuyCommand:", error);
    const errorMessage = error ? error.message : "데이터를 찾을 수 없습니다.";
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `❌ 최신 데이터를 불러올 수 없습니다. (원인: ${errorMessage})`,
    });
  }

  const { fetchRealtimeStockData } = await import("../../utils/fetchRealtimePrice");
  const [realtimeData, series, marketData, fundamental, prefs] = await Promise.all([
    fetchRealtimeStockData(code),
    getDailySeries(code, 420).catch(() => []),
    fetchAllMarketData().catch(() => null),
    getFundamentalSnapshot(code).catch(() => null),
    getUserInvestmentPrefs(ctx.from?.id ?? ctx.chatId),
  ]);

  const dailyRealizedPnl = await getDailyRealizedPnl(ctx.chatId);
  const riskBaseCapital = Number(
    prefs.virtual_seed_capital ?? prefs.capital_krw ?? 0
  );
  const dailyLossLimitPct = Number(
    prefs.daily_loss_limit_pct ?? DEFAULT_DAILY_LOSS_LIMIT_PCT
  );
  const dailyLossLimitAmount =
    riskBaseCapital > 0 && dailyLossLimitPct > 0
      ? (riskBaseCapital * dailyLossLimitPct) / 100
      : 0;

  if (dailyLossLimitAmount > 0 && dailyRealizedPnl <= -dailyLossLimitAmount) {
    const { dayLabel } = getKstDayRange();
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        "<b>신규 진입 제한</b>",
        LINE,
        `${dayLabel} 실현손익 <code>${fmtInt(dailyRealizedPnl)}원</code>`,
        `일손실 한도 <code>-${fmtInt(dailyLossLimitAmount)}원</code> (${dailyLossLimitPct.toFixed(1)}%) 도달`,
        "오늘은 신규 매수 대신 보유 종목 리스크 점검을 권장합니다.",
        "권장: /보유대응 · /시장 · /리포트",
      ].join("\n"),
      parse_mode: "HTML",
    });
    return;
  }

  const currentPrice = realtimeData?.price ?? stock.close;
  const normalizedSeries = scaleSeriesToReferencePrice(series, currentPrice);
  const marketEnv = marketData
    ? {
        vix: marketData.vix?.price,
        fearGreed: marketData.fearGreed?.score,
        usdkrw: marketData.usdkrw?.price,
      }
    : undefined;

  const scoreResult = await fetchLatestScoresByCodes(supabase, [code]);
  const latestScoreRow = scoreResult.byCode.get(code);
  const latestFactors =
    latestScoreRow?.factors && typeof latestScoreRow.factors === "object"
      ? (latestScoreRow.factors as Record<string, any>)
      : null;

  const fallbackScore = Number(
    latestScoreRow?.total_score ??
      latestScoreRow?.momentum_score ??
      0
  ) || undefined;

  const fallbackFactors = scaleScoreFactorsToReferencePrice(
    {
      sma20: Number(latestFactors?.sma20 ?? stock.sma20 ?? currentPrice),
      sma50: Number(latestFactors?.sma50 ?? stock.sma50 ?? currentPrice),
      sma200: Number(latestFactors?.sma200 ?? currentPrice),
      rsi14: Number(latestFactors?.rsi14 ?? stock.rsi14 ?? 50),
      roc14: Number(latestFactors?.roc14 ?? 0),
      roc21: Number(latestFactors?.roc21 ?? 0),
      avwap_support: Number(latestFactors?.avwap_support ?? 50),
      atr14: Number(latestFactors?.atr14 ?? 0),
      atr_pct: Number(latestFactors?.atr_pct ?? 0),
      vol_ratio: Number(latestFactors?.vol_ratio ?? 1),
      macd_cross:
        latestFactors?.macd_cross === "golden" || latestFactors?.macd_cross === "dead"
          ? latestFactors.macd_cross
          : "none",
    },
    currentPrice,
    stock.close
  );

  const plan = buildInvestmentPlan({
    currentPrice,
    factors: fallbackFactors,
    technicalScore: fallbackScore,
    fundamental,
    marketEnv,
  });
  const technicalScore = fallbackScore;
  const fundamentalScore = fundamental?.qualityScore;
  const finalScore = technicalScore !== undefined
    ? Number(
        (
          fundamentalScore !== undefined
            ? technicalScore * 0.8 + fundamentalScore * 0.2
            : technicalScore
        ).toFixed(1)
      )
    : undefined;

  const capital = prefs.capital_krw ?? 0;
  const splitCount = prefs.split_count ?? 3;

  const investPrefs = capital > 0 && splitCount > 0
    ? { capital, splitCount }
    : undefined;

  const msg = buildMessage(
    { name, code },
    currentPrice,
    realtimeData,
    plan,
    {
      technicalScore: technicalScore !== undefined ? Number(technicalScore) : undefined,
      finalScore,
      fundamentalScore,
    },
    fundamental
      ? {
          qualityScore: fundamental.qualityScore,
          profileLabel: fundamental.profileLabel,
          profileNote: fundamental.profileNote,
          per: fundamental.per,
          pbr: fundamental.pbr,
          roe: fundamental.roe,
          debtRatio: fundamental.debtRatio,
          salesGrowthPct: fundamental.salesGrowthPct,
          salesGrowthLowBase: fundamental.salesGrowthLowBase,
          opIncomeGrowthPct: fundamental.opIncomeGrowthPct,
          opIncomeGrowthLowBase: fundamental.opIncomeGrowthLowBase,
          opIncomeTurnaround: fundamental.opIncomeTurnaround,
          netIncomeGrowthPct: fundamental.netIncomeGrowthPct,
          netIncomeGrowthLowBase: fundamental.netIncomeGrowthLowBase,
          netIncomeTurnaround: fundamental.netIncomeTurnaround,
          commentary: fundamental.commentary,
        }
      : undefined,
    investPrefs
  );

  // 2-4: 섹터 과집중 경고 — 현재 관심종목의 섹터 집중도와 비교
  let sectorWarningBlock = "";
  const targetSectorId = (stock as any).sector_id as string | null | undefined;
  if (targetSectorId) {
    const { data: watchHoldings } = await supabase
      .from("watchlist")
      .select("invested_amount, stock:stocks!inner(sector_id)")
      .eq("chat_id", ctx.chatId);

    if (watchHoldings && watchHoldings.length > 0) {
      const holdings = watchHoldings.map((h: any) => {
        const s = Array.isArray(h.stock) ? h.stock[0] : h.stock;
        return {
          sectorId: s?.sector_id ?? null,
          investedAmount: Number(h.invested_amount ?? 0),
        };
      });
      const concentrations = calculateSectorConcentration(holdings);
      const targetConc = concentrations.find((c) => c.sectorId === targetSectorId);
      if (targetConc && targetConc.ratio >= 30) {
        const icon = targetConc.ratio >= 50 ? "🔴" : "⚠️";
        sectorWarningBlock = `\n\n${icon} <b>섹터 집중 경고</b>\n현재 ${esc(targetConc.sectorName)} 비중 ${targetConc.ratio.toFixed(0)}% — 진입 시 추가 집중됩니다.\n분산 투자 또는 비중 조정을 검토하세요.`;
      }
    }
  }


  const kb = actionButtons(ACTIONS.analyzeStock(code), 3);

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: msg + sectorWarningBlock,
    parse_mode: "HTML",
    reply_markup: kb,
  });
}