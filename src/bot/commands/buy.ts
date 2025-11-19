// src/bot/commands/buy.ts
import type { ChatContext } from "../router";
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

function calcVolumeRatio(series: StockOHLCV[]): number {
  const n = Math.min(20, series.length);
  if (n <= 1) return NaN;
  const slice = series.slice(-n);
  const sum = slice.reduce((acc, c) => acc + (c.volume || 0), 0);
  const avg = sum / n;
  const last = slice[slice.length - 1];
  return avg > 0 ? last.volume / avg : NaN;
}

type BuyDecision = {
  canBuy: boolean;
  reasons: string[]; // 미충족/참고 사유
  tags: string[]; // 충족된 트리거 요약
  volumeRatio: number;
  rr1: number; // NaN 허용 (값으로만)
  rr2: number; // NaN 허용 (값으로만)
};

function evaluateBuyDecision(
  last: StockOHLCV,
  volumeRatio: number,
  entryPrice: number,
  hardStop: number,
  t1: number,
  t2: number,
  f: {
    sma20: number;
    sma50: number;
    sma200: number;
    sma200_slope?: number;
    rsi14: number;
    roc14: number;
    roc21: number;
    avwap_support: number;
    avwap_regime?: "buyers" | "sellers" | "neutral";
  }
): BuyDecision {
  const reasons: string[] = [];
  const tags: string[] = [];

  const riskPct = pct(entryPrice, hardStop); // 음수
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

  const close = last.close;
  const near20 = f.sma20 > 0 && Math.abs((close - f.sma20) / f.sma20) <= 0.03;
  const above20 = f.sma20 > 0 && close >= f.sma20;
  const above50 = f.sma50 > 0 && close >= f.sma50;
  const trendUp200 =
    typeof f.sma200_slope === "number" ? f.sma200_slope > 0 : true;

  const hasAvwapSupport = f.avwap_regime === "buyers" && f.avwap_support >= 50; // 매수자 우위 + 지지

  const volOk = Number.isFinite(volumeRatio) && volumeRatio >= 1.5;
  const rsiOk = f.rsi14 >= 50;
  const rocOk = f.roc14 >= 0 && f.roc21 >= -5;

  // 대표 트리거: 20SMA±3% & AVWAP 상회 & 거래량/모멘텀 동시 충족
  const breakoutTrigger =
    near20 && above20 && hasAvwapSupport && volOk && rsiOk && rocOk;

  if (breakoutTrigger) tags.push("20SMA·AVWAP 돌파 + 거래량/모멘텀 동시 충족");

  // 보조 트리거: 상승 추세에서 50일선 위 추세 추종
  const trendTrigger =
    above50 && trendUp200 && hasAvwapSupport && rsiOk && rocOk;

  if (trendTrigger) tags.push("상승 추세 50일선 위 추세 추종");

  // 손익비 필터 (최소 1:2 권장)
  const rrOk = Number.isFinite(rr1) && rr1 >= 2;

  if (!volOk) reasons.push("거래량이 20일 평균의 1.5배 미만");
  if (!hasAvwapSupport)
    reasons.push("AVWAP 상회·매수자 우위 레짐이 아니거나 지지강도 부족");
  if (!rsiOk) reasons.push("RSI14가 50 미만");
  if (!rocOk) reasons.push("ROC14/21 모멘텀이 약하거나 음수");
  if (!near20 && !trendTrigger)
    reasons.push("20SMA ±3% 구간이 아니고, 50일선 기반 추세 트리거도 아님");
  if (!rrOk) reasons.push("손익비가 1:2 미만 (리스크 대비 기대수익 부족)");

  const canBuy = breakoutTrigger || trendTrigger;
  if (!canBuy && reasons.length === 0) {
    reasons.push("시스템 매수 트리거가 충족되지 않음");
  }

  return {
    canBuy: canBuy && rrOk,
    reasons: rrOk ? reasons : [...reasons, "손익비 필터(1:2 이상) 미충족"],
    tags,
    volumeRatio,
    rr1,
    rr2,
  };
}

export async function handleBuyCommand(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const query = (input || "").trim();

  // 인자가 없으면 사용법 안내
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

  // 1) 이름/코드로 종목 검색
  let hit = await searchByNameOrCode(query, 1);
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

  // 2) 일봉 시계열 가져오기
  const series: StockOHLCV[] = await getDailySeries(code, 420);
  if (!series || series.length < 200) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.INSUFFICIENT,
    });
    return;
  }

  // 3) 점수/레벨 계산
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

  const entryPrice = scored.entry?.buy ?? last.close;
  const addPrice = scored.entry?.add;
  const hardStop = scored.stops?.hard ?? 0;
  const t1 = scored.targets?.t1 ?? 0;
  const t2 = scored.targets?.t2 ?? 0;

  const riskPct = pct(entryPrice, hardStop); // 음수(손실)
  const reward1Pct = pct(entryPrice, t1);
  const reward2Pct = pct(entryPrice, t2);

  const volumeRatio = calcVolumeRatio(series);

  const decision = evaluateBuyDecision(
    last,
    volumeRatio,
    entryPrice,
    hardStop,
    t1,
    t2,
    {
      sma20: f.sma20,
      sma50: f.sma50,
      sma200: f.sma200,
      sma200_slope: f.sma200_slope,
      rsi14: f.rsi14,
      roc14: f.roc14,
      roc21: f.roc21,
      avwap_support: f.avwap_support,
      avwap_regime: f.avwap_regime,
    }
  );

  const header = [
    `종목: ${name} (${code})`,
    `현재가: ${int(last.close)}원, 거래량: ${int(
      last.volume
    )} (20일 평균 대비 ×${one(decision.volumeRatio)})`,
  ];

  const levelLines = [
    `엔트리: ${int(entryPrice)}원` +
      (addPrice ? `, 추가: ${int(addPrice)}원` : ""),
    `손절: ${int(hardStop)}원 (≈${one(riskPct)}%)`,
    `익절: 1차 ${int(t1)}원(${one(reward1Pct)}%), 2차 ${int(t2)}원(${one(
      reward2Pct
    )}%)`,
  ];

  const rrText =
    Number.isFinite(decision.rr1) && Number.isFinite(decision.rr2)
      ? `손익비: 1:${one(decision.rr1)} ~ 1:${one(decision.rr2)}`
      : Number.isFinite(decision.rr1)
      ? `손익비: 1:${one(decision.rr1)}`
      : "";

  // 포지션 크기: 점수 엔진에서 산출한 sizeFactor 기준(예: 계좌 1~2% 리스크)
  const sizeText = Number.isFinite(scored.sizeFactor)
    ? `추천 포지션 크기: 기준 대비 x${one(
        scored.sizeFactor!
      )} (계좌 1~2% 리스크 가정)`
    : "";

  const ruleText =
    "규칙: 손절 −7~−8%, 익절 +20~25% 분할, 50일선/AVWAP 이탈 시 청산, 3주 내 +20% 급등 시 8주 보유 예외, 트레일링 스탑 참고.";

  if (!decision.canBuy) {
    const lines = [
      ...header,
      "",
      "시스템 매수 조건: 미충족 (관망 권장)",
      ...(decision.tags.length
        ? [`참고 트리거: ${decision.tags.join(" / ")}`]
        : []),
      ...(decision.reasons.length
        ? ["미충족 사유:", ...decision.reasons.map((r) => `- ${r}`)]
        : []),
      "",
      "참고 기준 레벨:",
      ...levelLines,
      rrText || "",
      "",
      ruleText,
    ].filter(Boolean);

    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: lines.join("\n"),
    });
    return;
  }

  // 매수 허용 케이스
  const okLines = [
    ...header,
    "",
    "시스템 매수 조건: 충족 (매수 허용)",
    decision.tags.length ? `트리거: ${decision.tags.join(" / ")}` : "",
    "",
    ...levelLines,
    rrText || "",
    sizeText || "",
    "",
    ruleText,
  ].filter(Boolean);

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: okLines.join("\n"),
  });
}
