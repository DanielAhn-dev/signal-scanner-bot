// src/bot/commands/economy.ts
// /경제 — 글로벌 경제지표 종합 조회

import type { ChatContext } from "../router";
import { fetchAllMarketData } from "../../utils/fetchMarketData";
import { LINE } from "../messages/format";

const arrow = (n: number) => (n > 0 ? "▲" : n < 0 ? "▼" : "―");

const fmtRate = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

function fearLabel(score: number): string {
  if (score <= 25) return "극단적 공포 😱";
  if (score <= 45) return "공포 😰";
  if (score <= 55) return "중립 😐";
  if (score <= 75) return "탐욕 🤑";
  return "극단적 탐욕 🔥";
}

function vixLabel(vix: number): string {
  if (vix >= 30) return "공포 (위험)";
  if (vix >= 20) return "불안 (주의)";
  return "안정";
}

export async function handleEconomyCommand(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: "경제지표 조회 중...",
  });

  const data = await fetchAllMarketData();

  let msg = `<b>글로벌 경제지표</b>\n${LINE}\n\n`;

  // 국내 증시
  msg += `<b>🇰🇷 국내 증시</b>\n`;
  if (data.kospi) {
    msg += `  KOSPI  <code>${data.kospi.price.toLocaleString()}</code>`;
    msg += `  ${arrow(data.kospi.change)} ${fmtRate(data.kospi.changeRate)}\n`;
  } else {
    msg += `  KOSPI  <i>데이터 없음</i>\n`;
  }
  if (data.kosdaq) {
    msg += `  KOSDAQ <code>${data.kosdaq.price.toLocaleString()}</code>`;
    msg += `  ${arrow(data.kosdaq.change)} ${fmtRate(data.kosdaq.changeRate)}\n`;
  }

  // 미국 증시
  msg += `\n<b>🇺🇸 미국 증시</b>\n`;
  if (data.sp500) {
    msg += `  S&P 500  <code>${data.sp500.price.toLocaleString()}</code>`;
    msg += `  ${arrow(data.sp500.change)} ${fmtRate(data.sp500.changeRate)}\n`;
  }
  if (data.nasdaq) {
    msg += `  NASDAQ   <code>${data.nasdaq.price.toLocaleString()}</code>`;
    msg += `  ${arrow(data.nasdaq.change)} ${fmtRate(data.nasdaq.changeRate)}\n`;
  }

  // 환율
  msg += `\n<b>💱 환율</b>\n`;
  if (data.usdkrw) {
    msg += `  USD/KRW  <code>${data.usdkrw.price.toLocaleString()}원</code>`;
    msg += `  ${arrow(data.usdkrw.change)} ${fmtRate(data.usdkrw.changeRate)}\n`;
  } else {
    msg += `  USD/KRW  <i>데이터 없음</i>\n`;
  }

  // 심리 지표
  msg += `\n<b>📊 심리 지표</b>\n`;
  if (data.vix) {
    msg += `  VIX (공포지수)  <code>${data.vix.price.toFixed(2)}</code>`;
    msg += `  ${vixLabel(data.vix.price)}\n`;
  }
  if (data.fearGreed) {
    msg += `  CNN 공포·탐욕  <code>${data.fearGreed.score}</code>`;
    msg += `  ${fearLabel(data.fearGreed.score)}\n`;
  }

  // 금리
  if (data.us10y) {
    msg += `\n<b>📈 금리</b>\n`;
    msg += `  미국 10년물  <code>${data.us10y.price.toFixed(2)}%</code>`;
    msg += `  ${arrow(data.us10y.change)} ${fmtRate(data.us10y.changeRate)}\n`;
  }

  // 시장 코멘트
  msg += `\n${LINE}\n`;
  const comments: string[] = [];
  if (data.vix && data.vix.price >= 30)
    comments.push("⚠️ VIX 30↑ — 변동성 극대, 보수적 접근 권장");
  else if (data.vix && data.vix.price >= 20)
    comments.push("⚠️ VIX 20~30 — 불안정, 리스크 관리 강화");

  if (data.fearGreed && data.fearGreed.score <= 25)
    comments.push("💡 극단적 공포 — 역발상 매수 기회 탐색");
  else if (data.fearGreed && data.fearGreed.score >= 80)
    comments.push("⚠️ 극단적 탐욕 — 차익실현 고려");

  if (data.usdkrw && data.usdkrw.price >= 1400)
    comments.push("💵 원화 약세 (1,400↑) — 외국인 매도 압력 가능");

  if (data.us10y && data.us10y.price >= 5.0)
    comments.push("📉 미국 10년물 5%↑ — 긴축 우려");

  msg += comments.length
    ? comments.join("\n")
    : "시장 특이사항 없음";

  msg += `\n\n/시장 — 종합 시장 진단\n/수급 — 수급 동향`;

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: msg,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}
