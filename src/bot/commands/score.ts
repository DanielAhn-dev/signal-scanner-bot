// src/bot/commands/score.ts
import type { ChatContext } from "../router";
import { createMultiRowKeyboard } from "../../telegram/keyboards";
import { calculateScore } from "../../score/engine";
import { getDailySeries } from "../../adapters";
import { searchByNameOrCode, getNamesForCodes } from "../../search/normalize";
import type { StockOHLCV } from "../../data/types";
import { KO_MESSAGES } from "../messages/ko";

const int = (n: number) =>
  Number.isFinite(n) ? Math.round(n).toLocaleString("ko-KR") : "-";

const one = (n: number) =>
  Number.isFinite(n) ? Number(n.toFixed(1)).toLocaleString("ko-KR") : "-";

const pct = (from: number, to: number) => {
  if (!Number.isFinite(from) || from === 0 || !Number.isFinite(to)) return NaN;
  return ((to - from) / from) * 100;
};

function makeAdvice(
  last: number,
  s20: number,
  s50: number,
  s200: number,
  rsi14: number,
  roc14: number,
  roc21: number,
  avwapSupportPct: number
) {
  const adv: string[] = [];

  const near20 = s20 > 0 && Math.abs((last - s20) / s20) <= 0.03;

  if (near20 && avwapSupportPct >= 66 && rsi14 >= 50 && roc14 >= 0)
    adv.push(
      "돌파 매수 후보: 20SMA±3% 구간·AVWAP 상회·거래량 확대 시 /buy로 진입 여부 점검"
    );

  if (last > s50 && rsi14 >= 55 && roc21 >= 0)
    adv.push(
      "추세 추종 후보: 50SMA 위·RSI55+·ROC21 양의 구간, 분할 매수는 /buy 참고"
    );

  if (rsi14 >= 40 && rsi14 < 50 && roc14 >= -1)
    adv.push("되돌림 후보: RSI 40→50 재진입 시 /buy로 재확인");

  if (adv.length === 0)
    adv.push("관망: 50SMA/AVWAP 지지 재확인 또는 거래량 증가 신호 대기");

  adv.push(
    "리스크 기준: 손절 −7~−8% 또는 50SMA/AVWAP 이탈, 익절 +20~25% 분할·트레일링 (레벨은 참고용)"
  );

  return adv.join("\n");
}

function formatAvwapRegime(
  regime: "buyers" | "sellers" | "neutral" | undefined
): string {
  if (regime === "buyers") return "매수자 우위 (AVWAP 위·상승)";
  if (regime === "sellers") return "매도자 우위 (AVWAP 아래·하락)";
  return "중립";
}

export async function handleScoreCommand(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  let hit = await searchByNameOrCode(input, 1);
  if (!hit?.length) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.SCORE_NOT_FOUND,
    });
    return;
  }

  let { code, name } = hit[0];

  // 이름 보강
  if (!name || name === code) {
    const map = await getNamesForCodes([code]);
    name = map[code] || name || code;
  }

  const series: StockOHLCV[] = await getDailySeries(code, 420);
  if (!series || series.length < 200) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.INSUFFICIENT,
    });
    return;
  }

  const scored = calculateScore(series);
  if (!scored) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.SCORE_NOT_FOUND,
    });
    return;
  }

  // 코드만 있었던 경우 이름 보강
  if (!name || name === code) {
    const m = await getNamesForCodes([code]);
    name = m[code] || code;
  }

  const last = series[series.length - 1];
  const f = scored.factors;

  const advice = makeAdvice(
    last.close,
    f.sma20,
    f.sma50,
    f.sma200,
    f.rsi14,
    f.roc14,
    f.roc21,
    f.avwap_support
  );

  // "기준" 레벨만 간단히 노출(실제 매수 여부는 /buy가 담당)
  const entryPrice = scored.entry?.buy ?? last.close;
  const hardStop = scored.stops?.hard ?? 0;
  const t1 = scored.targets?.t1 ?? 0;
  const t2 = scored.targets?.t2 ?? 0;

  const riskPct = pct(entryPrice, hardStop); // 음수(손실)
  const reward1Pct = pct(entryPrice, t1);
  const reward2Pct = pct(entryPrice, t2);

  const levels =
    `기준 레벨(참고용)\n` +
    `- 엔트리: ${int(entryPrice)}원\n` +
    `- 손절: ${int(hardStop)}원 (≈${one(riskPct)}%)\n` +
    `- 익절: 1차 ${int(t1)}원(${one(reward1Pct)}%), 2차 ${int(t2)}원(${one(
      reward2Pct
    )}%)`;

  const avwapRegimeText = formatAvwapRegime(f.avwap_regime);

  const text =
    `종목: ${name} (${code})\n` +
    `일자: ${scored.date}\n` +
    `가격: ${int(last.close)}원, 거래량: ${int(last.volume)}\n\n` +
    `점수: ${one(scored.score)}점, 시그널: ${scored.signal}\n\n` +
    levels +
    "\n\n" +
    "지표 요약\n" +
    `- SMA20/50/200: ${int(f.sma20)} / ${int(f.sma50)} / ${int(f.sma200)}\n` +
    `- 200일 기울기: ${int(f.sma200_slope)}\n` +
    `- RSI14: ${one(f.rsi14)}\n` +
    `- ROC14/21: ${one(f.roc14)} / ${one(f.roc21)}\n` +
    `- AVWAP 지지강도: ${one(f.avwap_support)}%\n` +
    `- AVWAP 레짐: ${avwapRegimeText}\n\n` +
    "관점/전략\n" +
    advice;

  const kb = createMultiRowKeyboard(2, [
    { text: "재계산", callback_data: `score:${code}` },
    { text: "매수 체크", callback_data: `buy:${code}` },
  ]);

  await tgSend("sendMessage", { chat_id: ctx.chatId, text, reply_markup: kb });
}
