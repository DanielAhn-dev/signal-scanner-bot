// src/bot/commands/buy.ts

import type { ChatContext } from "../router";

import { calculateScore } from "../../score/engine";
import { getDailySeries } from "../../adapters";
import { searchByNameOrCode, getNamesForCodes } from "../../search/normalize";
import type { StockOHLCV } from "../../data/types";
import { KO_MESSAGES } from "../messages/ko";

// score.ts 와 동일한 헬퍼들 (TS2554 방지)[attached_file:9][web:26]
const int = (n: number) =>
  Number.isFinite(n) ? Math.round(n).toLocaleString("ko-KR") : "-";

const one = (n: number) =>
  Number.isFinite(n) ? Number(n.toFixed(1)).toLocaleString("ko-KR") : "-";

const pct = (from: number, to: number) => {
  if (!Number.isFinite(from) || from === 0 || !Number.isFinite(to)) return NaN;
  return ((to - from) / from) * 100;
};

export async function handleBuyCommand(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const query = (input || "").trim();

  // 인자가 없으면 사용법 안내[attached_file:9]
  if (!query) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text:
        "사용법: /buy <종목명 또는 코드>\n\n" +
        "예) /buy 삼성전자\n" +
        "예) /buy 005930",
    });
    return;
  }

  // 1) 이름/코드로 종목 검색[attached_file:9]
  let hit = await searchByNameOrCode(query, 1);
  if (!hit?.length) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.SCORE_NOT_FOUND,
    });
    return;
  }

  let { code, name } = hit[0];

  // 이름 보강[attached_file:9]
  if (!name || name === code) {
    const map = await getNamesForCodes([code]);
    name = map[code] || name || code;
  }

  // 2) 일봉 시계열 가져오기[attached_file:9]
  const series: StockOHLCV[] = await getDailySeries(code, 420);
  if (!series || series.length < 200) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.INSUFFICIENT,
    });
    return;
  }

  // 3) 점수/레벨 계산[attached_file:9]
  const scored = calculateScore(series);
  if (!scored) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.SCORE_NOT_FOUND,
    });
    return;
  }

  // 한 번 더 이름 보강 (코드만 있었던 경우)[attached_file:9]
  if (!name || name === code) {
    const m = await getNamesForCodes([code]);
    name = m[code] || code;
  }

  const last = series[series.length - 1];

  const entryPrice = scored.entry?.buy ?? last.close;
  const addPrice = scored.entry?.add;
  const hardStop = scored.stops?.hard ?? 0;
  const t1 = scored.targets?.t1 ?? 0;
  const t2 = scored.targets?.t2 ?? 0;

  const riskPct = pct(entryPrice, hardStop); // 음수(손실)[attached_file:9]
  const reward1Pct = pct(entryPrice, t1);
  const reward2Pct = pct(entryPrice, t2);

  const rr1 =
    Number.isFinite(riskPct) && riskPct < 0 && Number.isFinite(reward1Pct)
      ? Math.abs(reward1Pct / riskPct)
      : NaN;
  const rr2 =
    Number.isFinite(riskPct) && riskPct < 0 && Number.isFinite(reward2Pct)
      ? Math.abs(reward2Pct / riskPct)
      : NaN;

  const rrText =
    Number.isFinite(rr1) && Number.isFinite(rr2)
      ? `손익비: 1:${one(rr1)} ~ 1:${one(rr2)}`
      : Number.isFinite(rr1)
      ? `손익비: 1:${one(rr1)}`
      : "";

  const lines = [
    `종목: ${name} (${code})`,
    `현재가: ${int(last.close)}원, 거래량: ${int(last.volume)}`,
    "",
    `엔트리: ${int(entryPrice)}원` +
      (addPrice ? `, 추가: ${int(addPrice)}원` : ""),
    `손절: ${int(hardStop)}원 (≈${one(riskPct)}%)`,
    `익절: 1차 ${int(t1)}원(${one(reward1Pct)}%), 2차 ${int(t2)}원(${one(
      reward2Pct
    )}%)`,
    rrText || "",
    "",
    "규칙: 손절 −7~−8%, 익절 +20~25% 분할, 50일선/AVWAP 이탈 시 청산, 3주 내 +20% 급등 시 8주 보유 예외, 트레일링 스탑 참고.",
  ].filter(Boolean);

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: lines.join("\n"),
  });
}
