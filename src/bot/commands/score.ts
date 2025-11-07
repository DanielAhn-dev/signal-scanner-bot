// src/bot/commands/score.ts
import type { ChatContext } from "../router";
import { createMultiRowKeyboard } from "../../telegram/keyboards";
import { calculateScore } from "../../score/engine";
import { getDailySeries } from "../../adapters";
import { searchByNameOrCode } from "../../search/normalize";
import type { StockOHLCV } from "../../data/types";
import { KO_MESSAGES } from "../messages/ko";

function fmt(n: number, d = 2) {
  return Number.isFinite(n) ? n.toFixed(d) : "-";
}

export async function handleScoreCommand(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const results = await searchByNameOrCode(input, 1);
  if (!results?.length) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.SCORE_NOT_FOUND,
    });
    return;
  }
  const { code, name } = results[0];

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

  const last = series[series.length - 1];
  const f = scored.factors;
  const text =
    `종목: ${name} (${code})\n` +
    `일자: ${scored.date}\n` +
    `가격: ${fmt(last.close, 2)}원, 거래량: ${fmt(last.volume, 0)}\n\n` +
    `점수: ${fmt(scored.score, 1)}점, 시그널: ${scored.signal}\n` +
    `- SMA20/50/200: ${fmt(f.sma20)} / ${fmt(f.sma50)} / ${fmt(f.sma200)}\n` +
    `- 200일 기울기: ${fmt(f.sma200_slope)}\n` +
    `- RSI14: ${fmt(f.rsi14)}\n` +
    `- ROC14/21: ${fmt(f.roc14)} / ${fmt(f.roc21)}\n` +
    `- AVWAP 지지강도: ${fmt(f.avwap_support)}\n\n` +
    `제안: 엔트리(20SMA±3% AVWAP 재돌파·거래량+50%), 손절(−7~−8% 또는 50SMA/AVWAP 이탈), 익절(+20~25% 분할·트레일링)`;

  const kb = createMultiRowKeyboard(2, [
    { text: "재계산", callback_data: `score:${code}` },
  ]);
  await tgSend("sendMessage", { chat_id: ctx.chatId, text, reply_markup: kb });
}
