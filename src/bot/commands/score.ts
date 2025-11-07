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
  const near20 = Math.abs((last - s20) / s20) <= 0.03;
  if (near20 && avwapSupportPct >= 66 && rsi14 >= 50 && roc14 >= 0)
    adv.push("돌파 매수: 20SMA±3% 구간 AVWAP 상회·거래량 확대 시 진입");
  if (last > s50 && rsi14 >= 55 && roc21 >= 0)
    adv.push("추세 추종: 50SMA 위·RSI55+·ROC21 양의 구간에서 분할 진입");
  if (rsi14 >= 40 && rsi14 < 50 && roc14 >= -1)
    adv.push("되돌림: RSI 40→50 재진입 시 소량 추적 매수");
  if (adv.length === 0)
    adv.push("관망: 50SMA/AVWAP 지지 재확인 또는 거래량 증가 신호 대기");
  adv.push(
    "리스크: 손절 −7~−8% 또는 50SMA/AVWAP 이탈, 익절 +20~25% 분할·트레일링"
  );
  return adv.join("\n");
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

  // 이름 보강(확정적으로 매핑)
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

  const text =
    `종목: ${name} (${code})\n` +
    `일자: ${scored.date}\n` +
    `가격: ${int(last.close)}원, 거래량: ${int(last.volume)}\n\n` +
    `점수: ${one(scored.score)}점, 시그널: ${scored.signal}\n` +
    `- SMA20/50/200: ${int(f.sma20)} / ${int(f.sma50)} / ${int(f.sma200)}\n` +
    `- 200일 기울기: ${int(f.sma200_slope)}\n` +
    `- RSI14: ${one(f.rsi14)}\n` +
    `- ROC14/21: ${one(f.roc14)} / ${one(f.roc21)}\n` +
    `- AVWAP 지지강도: ${one(f.avwap_support)}%\n\n` +
    advice;

  const kb = createMultiRowKeyboard(2, [
    { text: "재계산", callback_data: `score:${code}` },
  ]);
  await tgSend("sendMessage", { chat_id: ctx.chatId, text, reply_markup: kb });
}
