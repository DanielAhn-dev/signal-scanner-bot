import type { ChatContext } from "../router";
import { actionButtons, ACTIONS } from "../messages/layout";
import { calculateScore } from "../../score/engine";
import { getDailySeries } from "../../adapters";
import { searchByNameOrCode, getNamesForCodes } from "../../search/normalize";
import type { StockOHLCV } from "../../data/types";
import { KO_MESSAGES } from "../messages/ko";
import { esc, fmtInt, fmtOne, fmtPct, LINE } from "../messages/format";
import { fetchRealtimeStockData } from "../../utils/fetchRealtimePrice";
import { fetchAllMarketData } from "../../utils/fetchMarketData";
import { getFundamentalSnapshot } from "../../services/fundamentalService";
import { buildInvestmentPlan } from "../../lib/investPlan";
import { scaleSeriesToReferencePrice } from "../../lib/priceScale";

// --- 전략 코멘트 생성기 ---
function makeStrategyComment(
  last: number,
  f: {
    sma20: number;
    sma50: number;
    rsi14: number;
    roc14: number;
    roc21: number;
    avwap_support: number;
  }
): string {
  const tips: string[] = [];

  if (f.sma20 > 0 && Math.abs((last - f.sma20) / f.sma20) <= 0.03) {
    tips.push("· 20일선 근접 — 지지/돌파 여부 관찰");
  }
  if (last > f.sma50 && f.rsi14 >= 55) {
    tips.push("· 추세 양호 — 50일선 위 상승 흐름 유지");
  } else if (last < f.sma50) {
    tips.push("· 추세 약세 — 50일선 아래, 저항 돌파 필요");
  }

  if (f.rsi14 >= 70) tips.push("· 과매수 구간 — 단기 조정 가능성");
  else if (f.rsi14 <= 30) tips.push("· 과매도 구간 — 기술적 반등 가능성");
  else if (f.rsi14 >= 45 && f.rsi14 <= 55)
    tips.push("· 변곡점 — 방향성 탐색 구간");

  tips.push("· 손절 -7% 준수, 분할 매수/매도 권장");
  return tips.join("\n");
}

// --- 메시지 빌더 (HTML) ---
function buildScoreMessage(
  name: string,
  code: string,
  date: string,
  last: StockOHLCV,
  scored: any,
  realtimePrice?: number,
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
  }
): string {
  const f = scored.factors;
  const currentPrice = realtimePrice ?? last.close;
  const plan = buildInvestmentPlan({
    currentPrice,
    factors: f,
    technicalScore: Number(scored.finalScore ?? scored.score),
    fundamental,
  });

  const finalScore = Number(scored.finalScore ?? scored.score);
  const signalTag =
    finalScore >= 70 ? "BUY" : finalScore >= 40 ? "HOLD" : "WAIT";

  const priceLabel = realtimePrice
    ? `<b>실시간</b>  <code>${fmtInt(realtimePrice)}원</code>`
    : `${fmtInt(last.close)}원`;

  return [
    `<b>${esc(name)}</b>  <code>${code}</code>`,
    `${date} 기준 · ${priceLabel}`,
    LINE,
    `<b>종합  ${fmtOne(finalScore)}점</b>  (${signalTag})`,
    fundamental
      ? `<i>기술 ${fmtOne(scored.score)} + 재무 ${fmtOne(
          fundamental.qualityScore
        )} 반영</i>`
      : "",
    ``,
    `<b>${plan.statusLabel}</b>`,
    `${plan.summary}`,
    `진입구간  <code>${fmtInt(plan.entryLow)}원</code> ~ <code>${fmtInt(plan.entryHigh)}원</code>`,
    `손절기준  <code>${fmtInt(plan.stopPrice)}원</code> (${fmtPct(-plan.stopPct * 100)})`,
    `목표구간  1차 <code>${fmtInt(plan.target1)}원</code> (${fmtPct(plan.target1Pct * 100)}) · 2차 <code>${fmtInt(plan.target2)}원</code> (${fmtPct(plan.target2Pct * 100)})`,
    `보유시야  ${plan.holdDays[0]}~${plan.holdDays[1]}거래일 · 손익비 ${plan.riskReward}:1`,
    LINE,
    `<b>핵심 근거</b>`,
    ...plan.rationale.map((line) => `· ${line}`),
    ...(plan.warnings.length ? ["", `<b>주의</b>`, ...plan.warnings.map((line) => `· ${line}`)] : []),
    fundamental
      ? `\n<b>재무 요약</b>\n${fundamental.qualityScore}점 · PER ${
          fundamental.per !== undefined ? fundamental.per.toFixed(2) : "-"
        } · PBR ${
          fundamental.pbr !== undefined ? fundamental.pbr.toFixed(2) : "-"
        } · ROE ${
          fundamental.roe !== undefined ? `${fundamental.roe.toFixed(2)}%` : "-"
        } · 부채 ${
          fundamental.debtRatio !== undefined
            ? `${fundamental.debtRatio.toFixed(2)}%`
            : "-"
        }`
      : "",
    fundamental?.commentary ? fundamental.commentary : "",
  ].join("\n");
}

// --- 메인 핸들러 ---
export async function handleScoreCommand(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  // 복수 결과를 위해 최대 5개 검색
  const hits = await searchByNameOrCode(input, 5);
  if (!hits?.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.SCORE_NOT_FOUND,
    });
  }

  // 여러 결과가 나오면 선택 키보드 제시
  if (hits.length > 1 && !/^\d{6}$/.test(input.trim())) {
    const btns = hits.slice(0, 5).map((h) => ({
      text: `${h.name} (${h.code})`,
      callback_data: `score:${h.code}`,
    }));
    const keyboard = actionButtons(btns, 2);
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `'${esc(input)}' 검색 결과 ${hits.length}건 — 종목을 선택하세요`,
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
    return;
  }

  let { code, name } = hits[0];
  // 이름 보강 로직
  if (!name || name === code) {
    const map = await getNamesForCodes([code]);
    name = map[code] || code;
  }

  // 실시간 가격 + 시계열 데이터 + 시장 환경 동시 조회
  const [series, realtimeData, mktData, fundamental] = await Promise.all([
    getDailySeries(code, 420),
    fetchRealtimeStockData(code),
    fetchAllMarketData().catch(() => null),
    getFundamentalSnapshot(code).catch(() => null),
  ]);

  if (!series || series.length < 200) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.INSUFFICIENT,
    });
  }

  const marketEnv = mktData
    ? { vix: mktData.vix?.price, fearGreed: mktData.fearGreed?.score, usdkrw: mktData.usdkrw?.price }
    : undefined;
  const normalizedSeries = scaleSeriesToReferencePrice(series, realtimeData?.price);
  const scored = calculateScore(normalizedSeries, marketEnv);
  if (!scored) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.SCORE_NOT_FOUND,
    });
  }

  const finalScore = fundamental
    ? Number((scored.score * 0.8 + fundamental.qualityScore * 0.2).toFixed(1))
    : scored.score;
  const scoreWithFund = { ...scored, finalScore };

  const realtimePrice = realtimeData?.price ?? undefined;

  const message = buildScoreMessage(
    name,
    code,
    scored.date,
    normalizedSeries[normalizedSeries.length - 1],
    scoreWithFund,
    realtimePrice,
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
      : undefined
  );

  const kb = actionButtons(ACTIONS.analyzeStockWithRecalc(code), 3);

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: message,
    parse_mode: "HTML",
    reply_markup: kb,
  });
}
