import type { ChatContext } from "../router";
import { calculateScore } from "../../score/engine";
import { getDailySeries } from "../../adapters";
import { searchByNameOrCode, getNamesForCodes } from "../../search/normalize";
import type { StockOHLCV } from "../../data/types";
import { KO_MESSAGES } from "../messages/ko";

// --- 유틸리티 함수 ---
const fmt = (n: number) =>
  Number.isFinite(n) ? Math.round(n).toLocaleString("ko-KR") : "-";
const fmtPct = (n: number) =>
  Number.isFinite(n) ? `${n > 0 ? "+" : ""}${n.toFixed(1)}%` : "-";
const calcVolumeRatio = (series: StockOHLCV[]): number => {
  const n = Math.min(20, series.length);
  if (n <= 1) return NaN;
  const slice = series.slice(-n);
  const avg = slice.reduce((acc, c) => acc + (c.volume || 0), 0) / n;
  return avg > 0 ? slice[slice.length - 1].volume / avg : NaN;
};

// --- 데이터 타입 ---
type BuyDecision = {
  canBuy: boolean;
  reasons: string[];
  tags: string[];
  volumeRatio: number;
  rr: string; // 손익비 문자열 미리 포맷팅
};

// --- 핵심 로직 분리 (평가) ---
function evaluateBuyDecision(
  last: StockOHLCV,
  volumeRatio: number,
  entryPrice: number,
  hardStop: number,
  t1: number,
  t2: number,
  f: any // factor 객체
): BuyDecision {
  const reasons: string[] = [];
  const tags: string[] = [];

  // 조건 계산
  const close = last.close;
  const isNear20 = f.sma20 > 0 && Math.abs((close - f.sma20) / f.sma20) <= 0.03;
  const isAbove20 = f.sma20 > 0 && close >= f.sma20;
  const isAbove50 = f.sma50 > 0 && close >= f.sma50;
  const isTrendUp200 =
    typeof f.sma200_slope === "number" ? f.sma200_slope > 0 : true;
  const hasAvwapSupport = f.avwap_regime === "buyers" && f.avwap_support >= 50;

  const isVolOk = Number.isFinite(volumeRatio) && volumeRatio >= 1.5;
  const isRsiOk = f.rsi14 >= 50;
  const isRocOk = f.roc14 >= 0 && f.roc21 >= -5;

  // 트리거 정의
  const triggerBreakout =
    isNear20 && isAbove20 && hasAvwapSupport && isVolOk && isRsiOk && isRocOk;
  const triggerTrend =
    isAbove50 && isTrendUp200 && hasAvwapSupport && isRsiOk && isRocOk;

  if (triggerBreakout) tags.push("🚀 20SMA·AVWAP 돌파");
  if (triggerTrend) tags.push("📈 50일선 위 추세 추종");

  // 미충족 사유
  if (!isVolOk)
    reasons.push(`거래량 부족 (${volumeRatio.toFixed(1)}배 < 1.5배)`);
  if (!hasAvwapSupport) reasons.push("AVWAP 지지력 약함");
  if (!isRsiOk) reasons.push(`모멘텀 약세 (RSI ${f.rsi14.toFixed(0)} < 50)`);
  if (!isRocOk) reasons.push("단기 추세 약세 (ROC 음수)");
  if (!triggerBreakout && !triggerTrend)
    reasons.push("주요 이평선/매물대 조건 미달");

  // 손익비 계산
  const risk = Math.abs(entryPrice - hardStop);
  const reward = Math.abs(t1 - entryPrice);
  const rrVal = risk > 0 ? reward / risk : 0;
  const isRrOk = rrVal >= 2;

  if (!isRrOk) reasons.push(`손익비 부족 (1:${rrVal.toFixed(1)} < 1:2.0)`);

  const canBuy = (triggerBreakout || triggerTrend) && isRrOk;

  return {
    canBuy,
    reasons,
    tags,
    volumeRatio,
    rr: `1:${rrVal.toFixed(1)}`,
  };
}

// --- 메시지 빌더 (Markdown 포맷 적용) ---
function buildBuyMessage(params: {
  name: string;
  code: string;
  last: StockOHLCV;
  decision: BuyDecision;
  entry: number;
  stop: number;
  t1: number;
  t2: number;
}): string {
  const { name, code, last, decision, entry, stop, t1, t2 } = params;
  const closeFmt = fmt(last.close);
  const stopPct = fmtPct(((stop - entry) / entry) * 100);

  // 1. 헤더: 종목명과 현재가 강조
  const header = [
    `📌 *${name}* \`(${code})\``,
    `현재가: *${closeFmt}원*`,
    `거래량: 전일대비 ${decision.volumeRatio.toFixed(1)}배`,
  ].join("\n");

  // 2. 진단 결과: 이모지와 볼드체로 명확히 구분
  let verdict = "";
  if (decision.canBuy) {
    verdict = [`✅ *매수 시그널 포착*`, `└ ${decision.tags.join(", ")}`].join(
      "\n"
    );
  } else {
    verdict = [
      `⛔ *관망 권장* (조건 미충족)`,
      `👇 *주요 원인*:`,
      ...decision.reasons.map((r) => `  • ${r}`),
    ].join("\n");
  }

  // 3. 매매 전략: 수치를 코드블록(`)으로 감싸 눈에 띄게 함
  const strategy = [
    `📐 *매매 전략* (손익비 ${decision.rr})`,
    `  🎯 진입: \`${fmt(entry)}원\``,
    `  🛡 손절: \`${fmt(stop)}원\` (${stopPct})`,
    `  💰 익절: \`${fmt(t1)}\` / \`${fmt(t2)}원\``,
  ].join("\n");

  // 4. 풋터: 긴 규칙을 짧은 팁으로 요약
  const footer = `💡 _손절 -7% 원칙, 분할 매도로 수익 보존_`;

  return [header, verdict, strategy, footer].join("\n\n");
}

// --- 메인 핸들러 ---
export async function handleBuyCommand(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const query = (input || "").trim();
  if (!query) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "사용법: /buy <종목명/코드>\n예) /buy 삼성전자",
    });
  }

  // 1. 종목 검색
  const hits = await searchByNameOrCode(query, 1);
  if (!hits?.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.SCORE_NOT_FOUND,
    });
  }

  let { code, name } = hits[0];
  if (!name || name === code) {
    const map = await getNamesForCodes([code]);
    name = map[code] || code;
  }

  // 2. 데이터 조회
  const series = await getDailySeries(code, 300);
  if (!series || series.length < 200) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.INSUFFICIENT,
    });
  }

  // 3. 분석 및 점수화
  const scored = calculateScore(series);
  if (!scored) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.SCORE_NOT_FOUND,
    });
  }

  const last = series[series.length - 1];
  const f = scored.factors;
  const decision = evaluateBuyDecision(
    last,
    calcVolumeRatio(series),
    scored.entry?.buy ?? last.close,
    scored.stops?.hard ?? 0,
    scored.targets?.t1 ?? 0,
    scored.targets?.t2 ?? 0,
    {
      sma20: f.sma20,
      sma50: f.sma50,
      sma200_slope: f.sma200_slope,
      rsi14: f.rsi14,
      roc14: f.roc14,
      roc21: f.roc21,
      avwap_support: f.avwap_support,
      avwap_regime: f.avwap_regime,
    }
  );

  // 4. 메시지 전송
  const msg = buildBuyMessage({
    name,
    code,
    last,
    decision,
    entry: scored.entry?.buy ?? last.close,
    stop: scored.stops?.hard ?? 0,
    t1: scored.targets?.t1 ?? 0,
    t2: scored.targets?.t2 ?? 0,
  });

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: msg,
    parse_mode: "Markdown", // 필수: 마크다운 적용
  });
}
