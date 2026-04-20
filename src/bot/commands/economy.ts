// src/bot/commands/economy.ts
// /경제 — 글로벌 경제지표 종합 조회

import type { ChatContext } from "../router";
import { fetchAllMarketData } from "../../utils/fetchMarketData";
import {
  header,
  section,
  bullets,
  divider,
  buildMessage,
  actionButtons,
  ACTIONS,
} from "../messages/layout";
import { buildPersonalizedGuidance } from "../../services/personalizedGuidanceService";

const arrow = (n: number) => (n > 0 ? "▲" : n < 0 ? "▼" : "―");

const fmtRate = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

function riskTag(vix?: number, fearGreed?: number): string {
  if (vix != null) {
    if (vix >= 30) return "고위험";
    if (vix >= 20) return "주의";
  }
  if (fearGreed != null) {
    if (fearGreed <= 25) return "공포";
    if (fearGreed >= 80) return "과열";
  }
  return "중립";
}

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

  const domestic: string[] = [];
  if (data.kospi) {
    domestic.push(
      `KOSPI  <code>${data.kospi.price.toLocaleString()}</code>  ${arrow(
        data.kospi.change
      )} ${fmtRate(data.kospi.changeRate)}`
    );
  } else {
    domestic.push(`KOSPI  <i>데이터 없음</i>`);
  }
  if (data.kosdaq) {
    domestic.push(
      `KOSDAQ <code>${data.kosdaq.price.toLocaleString()}</code>  ${arrow(
        data.kosdaq.change
      )} ${fmtRate(data.kosdaq.changeRate)}`
    );
  }

  const us: string[] = [];
  if (data.sp500) {
    us.push(
      `S&P 500  <code>${data.sp500.price.toLocaleString()}</code>  ${arrow(
        data.sp500.change
      )} ${fmtRate(data.sp500.changeRate)}`
    );
  }
  if (data.nasdaq) {
    us.push(
      `NASDAQ   <code>${data.nasdaq.price.toLocaleString()}</code>  ${arrow(
        data.nasdaq.change
      )} ${fmtRate(data.nasdaq.changeRate)}`
    );
  }

  const fx: string[] = [];
  if (data.usdkrw) {
    fx.push(
      `USD/KRW  <code>${data.usdkrw.price.toLocaleString()}원</code>  ${arrow(
        data.usdkrw.change
      )} ${fmtRate(data.usdkrw.changeRate)}`
    );
  } else {
    fx.push(`USD/KRW  <i>데이터 없음</i>`);
  }

  const sentiment: string[] = [];
  if (data.vix) {
    sentiment.push(
      `VIX  <code>${data.vix.price.toFixed(2)}</code>  ${vixLabel(data.vix.price)}`
    );
  }
  if (data.fearGreed) {
    sentiment.push(
      `공포·탐욕  <code>${data.fearGreed.score}</code>  ${fearLabel(
        data.fearGreed.score
      )}`
    );
  }

  const rates: string[] = [];
  if (data.us10y) {
    rates.push(
      `미국 10년물  <code>${data.us10y.price.toFixed(2)}%</code>  ${arrow(
        data.us10y.change
      )} ${fmtRate(data.us10y.changeRate)}`
    );
  }

  const materials: string[] = [];
  if (data.gold || data.silver || data.copper) {
    if (data.gold) {
      materials.push(
        `Gold   <code>$${data.gold.price.toLocaleString()}</code>  ${arrow(
          data.gold.change
        )} ${fmtRate(data.gold.changeRate)}`
      );
    }
    if (data.silver) {
      materials.push(
        `Silver <code>$${data.silver.price.toFixed(2)}</code>  ${arrow(
          data.silver.change
        )} ${fmtRate(data.silver.changeRate)}`
      );
    }
    if (data.copper) {
      materials.push(
        `Copper <code>$${data.copper.price.toFixed(4)}</code>  ${arrow(
          data.copper.change
        )} ${fmtRate(data.copper.changeRate)}`
      );
    }
  }

  const energy: string[] = [];
  if (data.wtiOil) {
    energy.push(
      `WTI 원유  <code>$${data.wtiOil.price.toFixed(2)}</code>  ${arrow(
        data.wtiOil.change
      )} ${fmtRate(data.wtiOil.changeRate)}`
    );
  }

  const crypto: string[] = [];
  if (data.bitcoin) {
    crypto.push(
      `비트코인  <code>$${data.bitcoin.price.toLocaleString()}</code>  ${arrow(
        data.bitcoin.change
      )} ${fmtRate(data.bitcoin.changeRate)}`
    );
  }

  const comments: string[] = [];
  if (data.vix && data.vix.price >= 30)
    comments.push("VIX 30↑ — 변동성 극대, 보수적 접근 권장");
  else if (data.vix && data.vix.price >= 20)
    comments.push("VIX 20~30 — 불안정, 리스크 관리 강화");

  if (data.fearGreed && data.fearGreed.score <= 25)
    comments.push("극단적 공포 — 역발상 매수 기회 탐색");
  else if (data.fearGreed && data.fearGreed.score >= 80)
    comments.push("극단적 탐욕 — 차익실현 고려");

  if (data.usdkrw && data.usdkrw.price >= 1400)
    comments.push("원화 약세 (1,400↑) — 외국인 매도 압력 가능");

  if (data.us10y && data.us10y.price >= 5.0)
    comments.push("미국 10년물 5%↑ — 긴축 우려");

  if (data.gold && data.gold.changeRate >= 2)
    comments.push("금 가격 급등 — 안전자산 선호 심리");

  if (data.wtiOil && data.wtiOil.price >= 100)
    comments.push("유가 $100↑ — 인플레이션 · 비용 부담 확대");

  if (data.bitcoin && data.bitcoin.changeRate <= -5)
    comments.push("비트코인 급락 — 위험자산 회피 심리");
  else if (data.bitcoin && data.bitcoin.changeRate >= 5)
    comments.push("비트코인 급등 — 위험선호 강화");

  const personalLines = await buildPersonalizedGuidance({
    chatId: ctx.chatId,
    context: "economy",
  }).catch(() => []);

  const msg = buildMessage([
    header("글로벌 경제지표", "핵심 거시 지표 요약"),
    section("요약", [
      `시장 온도: <code>${riskTag(data.vix?.price, data.fearGreed?.score)}</code>`,
    ]),
    ...(personalLines.length > 0 ? [section("내 상황 제안", personalLines)] : []),
    section("국내 증시", domestic),
    section("미국 증시", us),
    section("환율", fx),
    section("심리 지표", sentiment),
    rates.length ? section("금리", rates) : undefined,
    materials.length ? section("원자재", materials) : undefined,
    energy.length ? section("에너지", energy) : undefined,
    crypto.length ? section("암호화폐", crypto) : undefined,
    divider(),
    section("코멘트", comments.length ? bullets(comments) : ["• 시장 특이사항 없음"]),
    divider(),
  ]);

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: msg,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: actionButtons(ACTIONS.marketFlow, 2),
  });
}
