import type { ChatContext } from "../router";
import { createMultiRowKeyboard } from "../../telegram/keyboards";
import { calculateScore } from "../../score/engine";
import { getDailySeries } from "../../adapters";
import { searchByNameOrCode, getNamesForCodes } from "../../search/normalize";
import type { StockOHLCV } from "../../data/types";
import { KO_MESSAGES } from "../messages/ko";
import { esc, fmtInt, fmtOne, fmtPct, LINE } from "../messages/format";

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
  scored: any
): string {
  const f = scored.factors;
  const entry = scored.entry?.buy ?? last.close;
  const stop = scored.stops?.hard ?? 0;
  const t1 = scored.targets?.t1 ?? 0;
  const t2 = scored.targets?.t2 ?? 0;
  const riskPct = stop && entry ? ((stop - entry) / entry) * 100 : 0;

  const signalTag =
    scored.score >= 70 ? "BUY" : scored.score >= 40 ? "HOLD" : "WAIT";

  const trendDir = f.sma200_slope > 0 ? "우상향" : "우하향";
  const avwapDir =
    f.avwap_regime === "buyers" ? "매수우위" : "매도우위";

  return [
    `<b>${esc(name)}</b>  <code>${code}</code>`,
    `${date} 기준 · ${fmtInt(last.close)}원`,
    LINE,
    `<b>종합  ${fmtOne(scored.score)}점</b>  (${signalTag})`,
    ``,
    `▸ 진입  <code>${fmtInt(entry)}원</code>`,
    `▸ 손절  <code>${fmtInt(stop)}원</code> (${fmtPct(riskPct)})`,
    `▸ 목표  1차 <code>${fmtInt(t1)}</code> / 2차 <code>${fmtInt(t2)}</code>`,
    LINE,
    `<b>지표</b>`,
    `▸ 추세  200일선 ${trendDir}`,
    `  MA 20/50/200: ${fmtInt(f.sma20)} / ${fmtInt(f.sma50)} / ${fmtInt(f.sma200)}`,
    `▸ RSI ${fmtOne(f.rsi14)}  ROC₁₄ ${fmtPct(f.roc14)}`,
    `▸ AVWAP ${avwapDir} (지지 ${f.avwap_support}%)`,
    LINE,
    `<b>전략</b>`,
    makeStrategyComment(last.close, f),
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

  const series = await getDailySeries(code, 420);
  if (!series || series.length < 200) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.INSUFFICIENT,
    });
  }

  const scored = calculateScore(series);
  if (!scored) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.SCORE_NOT_FOUND,
    });
  }

  const message = buildScoreMessage(
    name,
    code,
    scored.date,
    series[series.length - 1],
    scored
  );

  const kb = createMultiRowKeyboard(2, [
    { text: "재계산", callback_data: `score:${code}` },
    { text: "매수 판독", callback_data: `buy:${code}` },
  ]);

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: message,
    parse_mode: "HTML",
    reply_markup: kb,
  });
}
