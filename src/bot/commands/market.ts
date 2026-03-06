// src/bot/commands/market.ts
// /시장 — 종합 시장 진단 & 하락장 대비 어드바이저

import type { ChatContext } from "../router";
import { createClient } from "@supabase/supabase-js";
import {
  fetchAllMarketData,
  type MarketOverview,
} from "../../utils/fetchMarketData";
import {
  scoreSectors,
  getTopSectors,
  getNextSectorCandidates,
  type SectorScore,
} from "../../lib/sectors";
import { esc, LINE } from "../messages/format";
import { actionButtons, ACTIONS } from "../messages/layout";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

type MarketRegime =
  | "strong_bull"
  | "bull"
  | "neutral"
  | "bear"
  | "strong_bear";

function diagnoseMarket(data: MarketOverview): {
  regime: MarketRegime;
  riskScore: number;
  signals: string[];
  advice: string[];
} {
  const signals: string[] = [];
  const advice: string[] = [];
  let riskScore = 50;

  // VIX
  if (data.vix) {
    if (data.vix.price >= 35) {
      riskScore += 20;
      signals.push("🔴 VIX 극단적 공포 구간 (35↑)");
      advice.push("현금 비중 50% 이상 유지");
      advice.push("추가 매수 자제, 보유 종목 손절 기준 엄수");
    } else if (data.vix.price >= 25) {
      riskScore += 10;
      signals.push("🟡 VIX 경계 구간 (25~35)");
      advice.push("신규 매수 비중 축소 (30% 이하)");
    } else if (data.vix.price < 15) {
      riskScore -= 5;
      signals.push("🟢 VIX 안정 (15 미만)");
    }
  }

  // Fear & Greed
  if (data.fearGreed) {
    if (data.fearGreed.score <= 20) {
      riskScore += 5;
      signals.push("🔴 극단적 공포 — 역발상 매수 기회 가능");
      advice.push("우량주 분할 매수 시작 고려");
    } else if (data.fearGreed.score >= 80) {
      riskScore += 15;
      signals.push("🟡 극단적 탐욕 — 차익실현 고려");
      advice.push("보유 종목 일부 익절, 현금화 추천");
    }
  }

  // 환율
  if (data.usdkrw) {
    if (data.usdkrw.price >= 1450) {
      riskScore += 10;
      signals.push("🔴 원화 급약세 (1,450↑) — 외국인 이탈 가능");
      advice.push("외국인 순매도 종목 주의");
    } else if (data.usdkrw.price >= 1350) {
      riskScore += 5;
      signals.push("🟡 원화 약세 (1,350↑)");
    }
  }

  // 미국 금리
  if (data.us10y) {
    if (data.us10y.price >= 5.0) {
      riskScore += 10;
      signals.push("🔴 미국 10년물 5%↑ — 긴축 우려 극대");
    } else if (data.us10y.price >= 4.5) {
      riskScore += 5;
      signals.push("🟡 미국 10년물 4.5%↑ — 고금리 지속");
    }
  }

  // KOSPI 등락
  if (data.kospi) {
    if (data.kospi.changeRate <= -2) {
      riskScore += 10;
      signals.push("🔴 KOSPI 급락 (-2%↑)");
    } else if (data.kospi.changeRate >= 1.5) {
      riskScore -= 5;
      signals.push("🟢 KOSPI 강세 (+1.5%↑)");
    }
  }

  riskScore = Math.max(0, Math.min(100, riskScore));

  let regime: MarketRegime;
  if (riskScore <= 20) regime = "strong_bull";
  else if (riskScore <= 40) regime = "bull";
  else if (riskScore <= 60) regime = "neutral";
  else if (riskScore <= 80) regime = "bear";
  else regime = "strong_bear";

  return { regime, riskScore, signals, advice };
}

const regimeLabel: Record<MarketRegime, string> = {
  strong_bull: "강세장 — 적극 매수",
  bull: "상승 추세 — 선별 매수",
  neutral: "중립 — 관망 위주",
  bear: "약세 — 방어 전략",
  strong_bear: "하락장 — 현금 확보 우선",
};

function fmtKorMoney(n: number): string {
  const eok = Math.round(n / 100_000_000);
  const jo = Math.floor(Math.abs(eok) / 10_000);
  const restEok = Math.abs(eok) % 10_000;
  const sign = eok < 0 ? "-" : "+";
  if (jo > 0) {
    if (restEok > 0) return `${sign}${jo}조 ${restEok.toLocaleString("ko-KR")}억`;
    return `${sign}${jo}조`;
  }
  return `${sign}${Math.abs(eok).toLocaleString("ko-KR")}억`;
}

export async function handleMarketCommand(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: "시장 종합 진단 분석 중...",
  });

  const todayStr = new Date().toISOString().slice(0, 10);

  const [marketData, sectorScores] = await Promise.all([
    fetchAllMarketData(),
    scoreSectors(todayStr).catch(() => [] as SectorScore[]),
  ]);

  const diagnosis = diagnoseMarket(marketData);
  const topSectors = getTopSectors(sectorScores).slice(0, 5);
  const nextSectors = getNextSectorCandidates(sectorScores, 3e9).slice(0, 5);

  let msg = `<b>시장 종합 진단</b>\n${LINE}\n\n`;

  // 시장 상태
  msg += `<b>현재 국면</b> ${regimeLabel[diagnosis.regime]}\n`;
  msg += `리스크 지수  <code>${diagnosis.riskScore}/100</code>\n\n`;

  // 글로벌 지표 요약
  msg += `<b>글로벌 환경</b>\n`;
  if (marketData.kospi)
    msg += `  KOSPI ${marketData.kospi.price.toLocaleString()} (${marketData.kospi.changeRate >= 0 ? "+" : ""}${marketData.kospi.changeRate.toFixed(1)}%)\n`;
  if (marketData.vix)
    msg += `  VIX ${marketData.vix.price.toFixed(1)}\n`;
  if (marketData.usdkrw)
    msg += `  환율 ${marketData.usdkrw.price.toLocaleString()}원\n`;
  msg += "\n";

  // 시그널
  if (diagnosis.signals.length) {
    msg += `<b>진단 시그널</b>\n`;
    diagnosis.signals.forEach((s) => {
      msg += `• ${s}\n`;
    });
    msg += "\n";
  }

  // 주도 섹터
  if (topSectors.length) {
    msg += `<b>주도 섹터</b> (수급 유입 중)\n`;
    topSectors.slice(0, 3).forEach((s) => {
      const flows: string[] = [];
      if (s.flowF5) flows.push(`외 ${fmtKorMoney(s.flowF5)}`);
      if (s.flowI5) flows.push(`기 ${fmtKorMoney(s.flowI5)}`);
      msg += `  ▸ ${esc(s.name)}  ${s.score}점`;
      if (flows.length) msg += `  ${flows.join(" ")}`;
      msg += "\n";
    });
    msg += "\n";
  }

  // 순환매 후보
  if (nextSectors.length) {
    msg += `<b>순환매 후보</b> (수급 유입 시작)\n`;
    nextSectors.slice(0, 3).forEach((s) => {
      const flows: string[] = [];
      if (s.flowF5) flows.push(`외 ${fmtKorMoney(s.flowF5)}`);
      if (s.flowI5) flows.push(`기 ${fmtKorMoney(s.flowI5)}`);
      msg += `  ▸ ${esc(s.name)}`;
      if (flows.length) msg += `  ${flows.join(" ")}`;
      msg += "\n";
    });
    msg += "\n";
  }

  // 투자 전략
  msg += `${LINE}\n<b>투자 전략</b>\n`;
  if (diagnosis.advice.length) {
    diagnosis.advice.forEach((a) => {
      msg += `• ${a}\n`;
    });
  } else {
    msg += "• 현재 시장 특이사항 없음\n";
    msg += "• 평소 전략 유지 (분할 매수/매도, 손절 -7%)\n";
  }

  // 하락장 대응 가이드
  if (diagnosis.regime === "strong_bear" || diagnosis.regime === "bear") {
    msg += `\n<b>하락장 대응 가이드</b>\n`;
    msg += `1) 보유 종목 손절선 재점검 (-7%)\n`;
    msg += `2) 현금 비중 최소 40% 유지\n`;
    msg += `3) 방어주(배당/필수소비) 비중 확대\n`;
    msg += `4) 신규 매수는 분할 (1/3씩)\n`;
    msg += `5) 외국인 순매도 종목 우선 정리\n`;
  }

  msg += `\n${LINE}`;

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: msg,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: actionButtons(ACTIONS.marketHub, 2),
  });
}
