// src/bot/commands/market.ts
// /시장 — 종합 시장 진단 (진단 로직은 services/marketDiagnosis.ts, 웹과 공용)

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
import { buildPersonalizedGuidance } from "../../services/personalizedGuidanceService";
import { buildMarketInsightLines } from "../../services/marketInsightService";
import { esc, LINE } from "../messages/format";
import { actionButtons, ACTIONS } from "../messages/layout";
import { describeBotBuyGate, diagnoseMarket, regimeLabel } from "../../services/marketDiagnosis";
import { withIndexTrendRatios } from "../../services/indexTrendRatios";
import { detectAutoTradeMarketPolicy } from "../../services/virtualAutoTradeSelection";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

function formatKstDateTimeLabel(iso?: string): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Seoul",
  });
}

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

/** 자동매매와 같은 시장 정책으로 봇 신규 매수 여부 (웹 시장진단과 같은 함수) */
async function resolveBotGate(marketData: Awaited<ReturnType<typeof fetchAllMarketData>>) {
  try {
    const overview = await withIndexTrendRatios(supabase, { ...marketData });
    return describeBotBuyGate(detectAutoTradeMarketPolicy({ overview: overview as any }));
  } catch {
    return null;
  }
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
  const botGate = await resolveBotGate(marketData);
  const topSectors = getTopSectors(sectorScores).slice(0, 5);
  const nextSectors = getNextSectorCandidates(sectorScores, 3e9).slice(0, 5);

  let msg = `<b>시장 종합 진단</b>\n${LINE}\n\n`;

  // 시장 상태
  msg += `<b>현재 국면</b> ${regimeLabel[diagnosis.regime]}\n`;
  msg += `리스크 지수  <code>${diagnosis.riskScore}/100</code>\n`;
  if (botGate) {
    msg += `<b>${botGate.paused ? "⏸" : "▶"} ${botGate.label}</b>\n${esc(botGate.detail)}\n`;
  }
  msg += "\n";

  // 글로벌 지표 요약
  msg += `<b>글로벌 환경</b>\n`;
  if (marketData.kospi)
    msg += `  KOSPI ${marketData.kospi.price.toLocaleString()} (${marketData.kospi.changeRate >= 0 ? "+" : ""}${marketData.kospi.changeRate.toFixed(1)}%)\n`;
  if (marketData.sp500)
    msg += `  S&P500 ${marketData.sp500.price.toLocaleString()} (${marketData.sp500.changeRate >= 0 ? "+" : ""}${marketData.sp500.changeRate.toFixed(1)}%)\n`;
  if (marketData.nasdaq)
    msg += `  NASDAQ ${marketData.nasdaq.price.toLocaleString()} (${marketData.nasdaq.changeRate >= 0 ? "+" : ""}${marketData.nasdaq.changeRate.toFixed(1)}%)\n`;
  if (marketData.dow)
    msg += `  DOW ${marketData.dow.price.toLocaleString()} (${marketData.dow.changeRate >= 0 ? "+" : ""}${marketData.dow.changeRate.toFixed(1)}%)\n`;
  if (marketData.vix)
    msg += `  VIX ${marketData.vix.price.toFixed(1)}\n`;
  if (marketData.usdkrw)
    msg += `  환율 ${marketData.usdkrw.price.toLocaleString()}원\n`;
  if (marketData.meta) {
    const quality = marketData.meta.isPartial ? "⚠️ 부분 수집" : "✅ 정상";
    const fetchedAt = formatKstDateTimeLabel(marketData.meta.fetchedAt);
    msg += `  데이터 상태 ${quality}`;
    if (fetchedAt) {
      msg += ` (${fetchedAt} KST)`;
    }
    msg += "\n";
    if (marketData.meta.isPartial && marketData.meta.missing.length) {
      msg += `  누락 지표 ${marketData.meta.missing.join(", ")}\n`;
    }
  }
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
    msg += `<b>순환매 후보</b> (수급 유입 시작 · 참고용, 봇 매수에 안 씀)\n`;
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

  const insightLines = buildMarketInsightLines({
    market: marketData,
    riskScore: diagnosis.riskScore,
    regimeLabel: regimeLabel[diagnosis.regime],
    topSectors,
    nextSectors,
  });

  if (insightLines.length) {
    msg += `<b>해석</b>\n`;
    insightLines.forEach((line) => {
      msg += `• ${esc(line)}\n`;
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

  // 위험지수가 높은 구간 가이드 — KOSPI 10년 검증: 이런 날 이후 20일 중앙값은 오히려 좋았고(+3.8%) 하락 폭도 컸다(하위 5% -13%)
  if (diagnosis.regime === "strong_bear" || diagnosis.regime === "bear") {
    msg += `\n<b>변동성 큰 구간 가이드</b>\n`;
    msg += `1) 보유 종목 손절선 재점검\n`;
    msg += `2) 신규 매수는 한 번에 하지 말고 나눠서 (1/3씩)\n`;
    msg += `3) 과거엔 이런 구간 뒤 반등이 많았지만 추가 하락 폭도 컸습니다\n`;
    msg += `4) 봇 매수 여부는 위 코스피 50일선 기준을 따릅니다\n`;
  }

  const personalLines = await buildPersonalizedGuidance({
    chatId: ctx.chatId,
    context: "market",
  }).catch(() => []);

  msg += `\n${LINE}`;

  const kb = actionButtons([...ACTIONS.marketHub, ...ACTIONS.autoCycleQuick], 2);
  if (personalLines.length > 0 && kb.inline_keyboard) {
    kb.inline_keyboard.push([
      { text: "👤 MY", callback_data: `my:market:market` },
    ]);
  }

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: msg,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: kb,
  });
}
