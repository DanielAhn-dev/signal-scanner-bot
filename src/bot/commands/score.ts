import type { ChatContext } from "../router";
import { createMultiRowKeyboard } from "../../telegram/keyboards";
import { calculateScore } from "../../score/engine";
import { getDailySeries } from "../../adapters";
import { searchByNameOrCode, getNamesForCodes } from "../../search/normalize";
import type { StockOHLCV } from "../../data/types";
import { KO_MESSAGES } from "../messages/ko";

// --- 유틸리티 ---
const fmtInt = (n: number) =>
  Number.isFinite(n) ? Math.round(n).toLocaleString("ko-KR") : "-";
const fmtOne = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : "-");
const fmtPct = (n: number) =>
  Number.isFinite(n) ? `${n > 0 ? "+" : ""}${n.toFixed(1)}%` : "-";

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

  // 1. 위치 분석
  if (f.sma20 > 0 && Math.abs((last - f.sma20) / f.sma20) <= 0.03) {
    tips.push("• 20일선 근접: 지지 후 반등 또는 돌파 여부 관찰");
  }
  if (last > f.sma50 && f.rsi14 >= 55) {
    tips.push("• 추세 양호: 50일선 위 상승 흐름 유지 중");
  } else if (last < f.sma50) {
    tips.push("• 추세 약세: 50일선 아래, 저항 돌파 확인 필요");
  }

  // 2. 모멘텀 조언
  if (f.rsi14 >= 70) tips.push("• 과매수 구간: 단기 조정 가능성 주의");
  else if (f.rsi14 <= 30) tips.push("• 과매도 구간: 기술적 반등 가능성");
  else if (f.rsi14 >= 45 && f.rsi14 <= 55)
    tips.push("• 변곡점: 방향성 탐색 구간");

  // 3. 기본 원칙
  tips.push("• 손절 -7% 준수, 분할 매수/매도 권장");

  return tips.join("\n");
}

// --- 메시지 빌더 ---
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

  // 헤더
  const header = `📊 *${name}* \`(${code})\`\n🕒 ${date} 기준`;

  // 가격 정보
  const priceLine = `💰 현재가: *${fmtInt(last.close)}원* (거래량 ${fmtInt(
    last.volume
  )})`;

  // 점수 및 시그널
  const scoreIcon =
    scored.score >= 70 ? "🟢" : scored.score >= 40 ? "🟡" : "⚪";
  const scoreLine = `${scoreIcon} *종합 점수: ${fmtOne(
    scored.score
  )}점* (Signal: \`${scored.signal}\`)`;

  // 매매 레벨 (표 형태)
  const levels = [
    `🎯 *매매 기준 (Reference)*`,
    `  • 진입: \`${fmtInt(entry)}원\``,
    `  • 손절: \`${fmtInt(stop)}원\` (${fmtPct(riskPct)})`,
    `  • 목표: 1차 \`${fmtInt(t1)}\` / 2차 \`${fmtInt(t2)}\``,
  ].join("\n");

  // 기술적 지표 (그룹화)
  const trendIcon = f.sma200_slope > 0 ? "📈" : "📉";
  const avwapIcon =
    f.avwap_regime === "buyers"
      ? "🐂"
      : f.avwap_regime === "sellers"
      ? "🐻"
      : "⚖️";

  const indicators = [
    `🔍 *핵심 지표 분석*`,
    `  ${trendIcon} *추세*: 200일선 ${
      f.sma200_slope > 0 ? "우상향" : "우하향"
    }`,
    `     └ 20/50/200: ${fmtInt(f.sma20)} / ${fmtInt(f.sma50)} / ${fmtInt(
      f.sma200
    )}`,
    `  ⚡ *모멘텀*: RSI ${fmtOne(f.rsi14)} / ROC ${fmtOne(f.roc14)}`,
    `  ${avwapIcon} *AVWAP*: ${
      f.avwap_regime === "buyers" ? "매수우위" : "매도우위"
    } (지지 ${f.avwap_support}%)`,
  ].join("\n");

  // 코멘트
  const advice = [`💡 *전략 코멘트*`, makeStrategyComment(last.close, f)].join(
    "\n"
  );

  return [header, priceLine, scoreLine, levels, indicators, advice].join(
    "\n\n"
  );
}

// --- 메인 핸들러 ---
export async function handleScoreCommand(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const hits = await searchByNameOrCode(input, 1);
  if (!hits?.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.SCORE_NOT_FOUND,
    });
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
    { text: "🔄 재계산", callback_data: `score:${code}` },
    { text: "✅ 매수 체크", callback_data: `buy:${code}` },
  ]);

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: message,
    parse_mode: "Markdown", // 필수
    reply_markup: kb,
  });
}
