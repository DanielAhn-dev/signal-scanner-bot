import type { ChatContext } from "../router";
import { createClient } from "@supabase/supabase-js";
import { searchByNameOrCode } from "../../search/normalize";
import { KO_MESSAGES } from "../messages/ko";
import { esc, fmtInt, fmtPct, LINE } from "../messages/format";
import { formatFundamentalInline } from "../messages/fundamental";
import { getUserInvestmentPrefs } from "../../services/userService";
import { getFundamentalSnapshot } from "../../services/fundamentalService";
import { actionButtons, ACTIONS } from "../messages/layout";
import { getDailySeries } from "../../adapters";
import { fetchAllMarketData } from "../../utils/fetchMarketData";
import { calculateScore } from "../../score/engine";
import { buildInvestmentPlan } from "../../lib/investPlan";
import {
  scaleScoreFactorsToReferencePrice,
  scaleSeriesToReferencePrice,
} from "../../lib/priceScale";

// Supabase 클라이언트
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// --- 메시지 빌더 (HTML) ---
function buildMessage(
  stock: { name: string; code: string },
  currentPrice: number,
  realtimeData: { change?: number; changeRate?: number } | null,
  plan: ReturnType<typeof buildInvestmentPlan>,
  fundamental?: {
    qualityScore: number;
    per?: number;
    pbr?: number;
    roe?: number;
    debtRatio?: number;
    salesGrowthPct?: number;
    opIncomeGrowthPct?: number;
    netIncomeGrowthPct?: number;
    commentary?: string;
  },
  investPrefs?: {
    capital: number;
    splitCount: number;
  }
): string {
  const { name, code } = stock;

  const changeStr = realtimeData?.changeRate !== undefined
    ? `${(realtimeData.change ?? 0) >= 0 ? "▲" : "▼"} ${Math.abs(realtimeData.changeRate ?? 0).toFixed(2)}%`
    : "";

  const header = [
    `<b>${esc(name)}</b>  <code>${code}</code>`,
    `현재가  <code>${fmtInt(currentPrice)}원</code>  ${changeStr}`,
  ].join("\n");

  const body = [
    LINE,
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
      text: "사용법: /매수 종목명 또는 코드\n예) /매수 삼성전자",
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
      callback_data: `buy:${h.code}`,
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
      code, name, close, sma20, sma50, rsi14, universe_level,
      scores ( momentum_score )
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

  const currentPrice = realtimeData?.price ?? stock.close;
  const normalizedSeries = scaleSeriesToReferencePrice(series, currentPrice);
  const marketEnv = marketData
    ? {
        vix: marketData.vix?.price,
        fearGreed: marketData.fearGreed?.score,
        usdkrw: marketData.usdkrw?.price,
      }
    : undefined;
  const scored = normalizedSeries && normalizedSeries.length >= 200
    ? calculateScore(normalizedSeries, marketEnv)
    : null;
  const rawMomentumScore = Array.isArray(stock.scores)
    ? (stock.scores[0] as { momentum_score?: number } | undefined)?.momentum_score
    : (stock.scores as { momentum_score?: number } | null | undefined)?.momentum_score;
  const fallbackFactors = scaleScoreFactorsToReferencePrice(
    {
      sma20: stock.sma20,
      sma50: stock.sma50,
      rsi14: stock.rsi14,
      roc14: 0,
      roc21: 0,
      avwap_support: 50,
    },
    currentPrice,
    stock.close
  );
  const plan = buildInvestmentPlan({
    currentPrice,
    factors: scored?.factors ?? fallbackFactors,
    technicalScore: scored?.score ?? rawMomentumScore,
    fundamental,
    marketEnv,
  });

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
    fundamental
      ? {
          qualityScore: fundamental.qualityScore,
          per: fundamental.per,
          pbr: fundamental.pbr,
          roe: fundamental.roe,
          debtRatio: fundamental.debtRatio,
          salesGrowthPct: fundamental.salesGrowthPct,
          opIncomeGrowthPct: fundamental.opIncomeGrowthPct,
          netIncomeGrowthPct: fundamental.netIncomeGrowthPct,
          commentary: fundamental.commentary,
        }
      : undefined,
    investPrefs
  );

  const kb = actionButtons(ACTIONS.analyzeStock(code), 3);

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: msg,
    parse_mode: "HTML",
    reply_markup: kb,
  });
}
