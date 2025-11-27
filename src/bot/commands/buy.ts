import type { ChatContext } from "../router";
import { createClient } from "@supabase/supabase-js";
import { searchByNameOrCode } from "../../search/normalize";
import { KO_MESSAGES } from "../messages/ko";
import { fetchRealtimePrice } from "../../utils/fetchRealtimePrice";

// Supabase 클라이언트
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// --- 유틸리티 함수: 숫자 포맷 ---
const fmt = (n: number) =>
  Number.isFinite(n) ? Math.round(n).toLocaleString("ko-KR") : "-";

// --- 매수 판독 로직 ---
// DB 정보 + 실시간 현재가를 인자로 받음
function evaluateBuyCondition(
  stock: any,
  currentPrice: number
): {
  canBuy: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];

  // 지표는 DB에 저장된 과거(어제 종가 기준) 값을 쓰되,
  // 가격 비교(이격도 등)는 실시간 가격을 씁니다.
  const sma20 = stock.sma20 || currentPrice;
  const rsi = stock.rsi14 || 50;

  // Supabase의 scores가 배열/객체로 올 수 있으므로 안전하게 추출
  const scoreData = Array.isArray(stock.scores)
    ? stock.scores[0]
    : stock.scores;
  const momentum = scoreData?.momentum_score || 0;

  // 1. 이격도 과열 (실시간 가격이 20일선보다 5% 이상 높으면 추격매수 금지)
  if (currentPrice > sma20 * 1.05) {
    reasons.push(`🚫 20일선 이격 과대 (눌림목 아님)`);
  }

  // 2. RSI 과열
  if (rsi > 70) {
    reasons.push(`🚫 RSI 과열권 (${rsi.toFixed(0)}) - 고점 위험`);
  }

  // 3. 모멘텀 약세 (점수 40점 미만)
  if (momentum < 40) {
    reasons.push(`🚫 상승 모멘텀 부족 (추세 미확인)`);
  }

  // 4. 소형주(Tail)인 경우 더 엄격하게 (RSI 60 이상이어야 매수 인정 등)
  if (stock.universe_level !== "core" && stock.universe_level !== "extended") {
    reasons.push(`⚠️ 소형주/변동성 주의 (비중 축소 필수)`);
    if (momentum < 50) reasons.push(`🚫 소형주는 강한 모멘텀 필수`);
  }

  const canBuy =
    reasons.length === 0 ||
    (reasons.length === 1 && reasons[0].includes("소형주")); // 소형주 경고만 있으면 매수 가능은 함

  return { canBuy, reasons };
}

// --- 메시지 빌더 ---
function buildMessage(
  stock: any,
  currentPrice: number,
  evaluation: { canBuy: boolean; reasons: string[] }
): string {
  const { name, code } = stock;
  const { canBuy, reasons } = evaluation;

  // 진입가/손절가 계산 (실시간 20일선 기준)
  // SMA20이 없으면 현재가 기준으로 대략 계산
  const basePrice = stock.sma20 || currentPrice;

  // 전략: 20일선 근처(1% 위)에서 진입 시도
  const entryPrice = Math.floor(basePrice * 1.01);
  const stopPrice = Math.floor(entryPrice * 0.93); // -7%
  const targetPrice = Math.floor(entryPrice * 1.1); // +10%

  const header = `🛒 *${name}* \`(${code})\` 매수 판독\n현재가: *${fmt(
    currentPrice
  )}원*`;

  let body = "";
  if (canBuy) {
    body = [
      `✅ **진입 가능 (Entry OK)**`,
      `• 눌림목 지지 확인됨`,
      `• 모멘텀 양호`,
      ``,
      `📐 *추천 전략*`,
      `  🎯 진입: \`${fmt(entryPrice)}원\` 부근`,
      `  🛡 손절: \`${fmt(stopPrice)}원\` (-7% 필) `,
    ].join("\n");
  } else {
    body = [
      `⛔ **관망 권장 (Wait)**`,
      `👇 *진입 불가 사유*`,
      ...reasons.map((r) => `  • ${r}`),
      ``,
      `💡 _"급등주는 보내주고, 다음 기회를 기다리세요."_`,
    ].join("\n");
  }

  return [header, body].join("\n\n");
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

  // 1. 종목 검색 (이름 -> 코드)
  const hits = await searchByNameOrCode(query, 1);
  if (!hits?.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.SCORE_NOT_FOUND,
    });
  }

  const { code, name } = hits[0];

  // 2. Supabase 데이터 직접 조회 (지표 포함)
  const { data: stock, error } = await supabase
    .from("stocks")
    .select(
      `
      code, name, close, sma20, rsi14, universe_level,
      scores ( momentum_score )
    `
    )
    .eq("code", code)
    .single();

  if (error || !stock) {
    console.error("Supabase query failed in handleBuyCommand:", error);
    const errorMessage = error ? error.message : "데이터를 찾을 수 없습니다.";
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `❌ 최신 데이터를 불러올 수 없습니다. (원인: ${errorMessage})`,
    });
  }

  // 3. 실시간 가격 조회 (추가된 부분)
  // Supabase의 'close'는 어제 종가일 가능성이 높으므로 실시간 API를 찌릅니다.
  const realtimePrice = await fetchRealtimePrice(code);

  // 실시간 가격이 있으면 그걸 쓰고, 없으면 DB의 close 사용
  const currentPrice = realtimePrice ?? stock.close;

  // 4. 평가 및 메시지 전송 (실시간 가격 기준)
  const evaluation = evaluateBuyCondition(stock, currentPrice);
  const msg = buildMessage(stock, currentPrice, evaluation);

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: msg,
    parse_mode: "Markdown",
  });
}
