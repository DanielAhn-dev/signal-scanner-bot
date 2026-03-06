import type { ChatContext } from "../router";
import { createMultiRowKeyboard } from "../../telegram/keyboards";
import { calculateScore } from "../../score/engine";
import { getDailySeries } from "../../adapters";
import { searchByNameOrCode, getNamesForCodes } from "../../search/normalize";
import type { StockOHLCV } from "../../data/types";
import { KO_MESSAGES } from "../messages/ko";
import { esc, fmtInt, fmtOne, fmtPct, LINE } from "../messages/format";
import { fetchRealtimeStockData } from "../../utils/fetchRealtimePrice";
import { fetchAllMarketData } from "../../utils/fetchMarketData";
import { getFundamentalSnapshot } from "../../services/fundamentalService";

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
  }
): string {
  const f = scored.factors;
  const currentPrice = realtimePrice ?? last.close;
  const entry = scored.entry?.buy ?? currentPrice;
  const stop = scored.stops?.hard ?? 0;
  const t1 = scored.targets?.t1 ?? 0;
  const t2 = scored.targets?.t2 ?? 0;
  const riskPct = stop && entry ? ((stop - entry) / entry) * 100 : 0;

  const finalScore = Number(scored.finalScore ?? scored.score);
  const signalTag =
    finalScore >= 70 ? "BUY" : finalScore >= 40 ? "HOLD" : "WAIT";

  const trendDir = f.sma200_slope > 0 ? "우상향" : "우하향";
  const avwapDir =
    f.avwap_regime === "buyers" ? "매수우위" : "매도우위";

  // 이평선 대비 이격도 표시
  const dist20 = f.sma20 > 0 ? ((currentPrice - f.sma20) / f.sma20 * 100) : 0;
  const dist50 = f.sma50 > 0 ? ((currentPrice - f.sma50) / f.sma50 * 100) : 0;

  // 실시간 가격 vs DB 가격 비교  
  const priceLabel = realtimePrice
    ? `<b>실시간</b>  <code>${fmtInt(realtimePrice)}원</code>`
    : `${fmtInt(last.close)}원`;

  // 이동평균 기반 진입 가이드
  let entryGuide = "";
  if (Math.abs(dist20) <= 3) {
    entryGuide = "20일선 근접 — 현재가 진입 가능";
  } else if (dist20 > 5) {
    entryGuide = `20일선 +${dist20.toFixed(1)}% 이격 — 눌림 대기`;
  } else if (dist20 < -3 && Math.abs(dist50) <= 3) {
    entryGuide = "50일선 지지 확인 후 진입";
  } else if (dist20 < -3) {
    entryGuide = "이평선 하회 — 관망 권장";
  }

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
    `▸ 진입  <code>${fmtInt(entry)}원</code>  <i>${entryGuide}</i>`,
    `▸ 손절  <code>${fmtInt(stop)}원</code> (${fmtPct(riskPct)})`,
    `▸ 목표  1차 <code>${fmtInt(t1)}</code> / 2차 <code>${fmtInt(t2)}</code>`,
    LINE,
    `<b>지표</b>`,
    `▸ 추세  200일선 ${trendDir}`,
    `  MA 20/50/200: ${fmtInt(f.sma20)} / ${fmtInt(f.sma50)} / ${fmtInt(f.sma200)}`,
    `  이격도  20MA ${dist20 >= 0 ? "+" : ""}${dist20.toFixed(1)}% · 50MA ${dist50 >= 0 ? "+" : ""}${dist50.toFixed(1)}%`,
    `▸ RSI ${fmtOne(f.rsi14)}  ROC₁₄ ${fmtPct(f.roc14)}`,
    `▸ AVWAP ${avwapDir} (지지 ${Number(f.avwap_support ?? 0).toFixed(2)}%)`,
    fundamental
      ? `▸ 재무  ${fundamental.qualityScore}점 (PER ${
          fundamental.per !== undefined ? fundamental.per.toFixed(2) : "-"
        } · PBR ${
          fundamental.pbr !== undefined ? fundamental.pbr.toFixed(2) : "-"
        } · ROE ${
          fundamental.roe !== undefined ? `${fundamental.roe.toFixed(2)}%` : "-"
        } · 부채 ${
          fundamental.debtRatio !== undefined
            ? `${fundamental.debtRatio.toFixed(2)}%`
            : "-"
        })`
      : "",
    fundamental
      ? `  성장  매출 ${
          fundamental.salesGrowthPct !== undefined
            ? `${fundamental.salesGrowthPct.toFixed(1)}%`
            : "-"
        } · 영업 ${
          fundamental.opIncomeGrowthPct !== undefined
            ? `${fundamental.opIncomeGrowthPct.toFixed(1)}%`
            : "-"
        } · 순익 ${
          fundamental.netIncomeGrowthPct !== undefined
            ? `${fundamental.netIncomeGrowthPct.toFixed(1)}%`
            : "-"
        }`
      : "",
    LINE,
    `<b>전략</b>`,
    makeStrategyComment(currentPrice, f),
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
    const keyboard = createMultiRowKeyboard(1, btns);
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
  const scored = calculateScore(series, marketEnv);
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
    series[series.length - 1],
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
        }
      : undefined
  );

  const kb = createMultiRowKeyboard(3, [
    { text: "재계산", callback_data: `score:${code}` },
    { text: "매수 판독", callback_data: `buy:${code}` },
    { text: "재무", callback_data: `finance:${code}` },
    { text: "관심추가", callback_data: `watchadd:${code}` },
    { text: "뉴스", callback_data: `news:${code}` },
    { text: "수급", callback_data: `flow:${code}` },
  ]);

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: message,
    parse_mode: "HTML",
    reply_markup: kb,
  });
}
