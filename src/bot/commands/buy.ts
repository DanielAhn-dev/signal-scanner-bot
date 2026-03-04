import type { ChatContext } from "../router";
import { createClient } from "@supabase/supabase-js";
import { searchByNameOrCode } from "../../search/normalize";
import { KO_MESSAGES } from "../messages/ko";
import { fetchRealtimePrice } from "../../utils/fetchRealtimePrice";
import { esc, fmtInt, LINE } from "../messages/format";

// Supabase 클라이언트
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// --- 매수 판독 로직 ---
function evaluateBuyCondition(
  stock: any,
  currentPrice: number
): {
  canBuy: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];

  const sma20 = stock.sma20 || currentPrice;
  const rsi = stock.rsi14 || 50;

  const scoreData = Array.isArray(stock.scores)
    ? stock.scores[0]
    : stock.scores;
  const momentum = scoreData?.momentum_score || 0;

  if (currentPrice > sma20 * 1.05) {
    reasons.push("20일선 이격 과대 (눌림목 아님)");
  }

  if (rsi > 70) {
    reasons.push(`RSI 과열권 (${rsi.toFixed(0)}) — 고점 위험`);
  }

  if (momentum < 40) {
    reasons.push("상승 모멘텀 부족 (추세 미확인)");
  }

  if (stock.universe_level !== "core" && stock.universe_level !== "extended") {
    reasons.push("소형주/변동성 주의 (비중 축소)");
    if (momentum < 50) reasons.push("소형주는 강한 모멘텀 필수");
  }

  const canBuy =
    reasons.length === 0 ||
    (reasons.length === 1 && reasons[0].includes("소형주"));

  return { canBuy, reasons };
}

// --- 메시지 빌더 (HTML) ---
function buildMessage(
  stock: any,
  currentPrice: number,
  evaluation: { canBuy: boolean; reasons: string[] }
): string {
  const { name, code } = stock;
  const { canBuy, reasons } = evaluation;

  const basePrice = stock.sma20 || currentPrice;
  const entryPrice = Math.floor(basePrice * 1.01);
  const stopPrice = Math.floor(entryPrice * 0.93);

  const header = [
    `<b>${esc(name)}</b>  <code>${code}</code>  매수 판독`,
    `현재가  <code>${fmtInt(currentPrice)}원</code>`,
  ].join("\n");

  let body = "";
  if (canBuy) {
    body = [
      LINE,
      `<b>▸ 진입 가능</b>`,
      `  눌림목 지지 확인 · 모멘텀 양호`,
      ``,
      `▸ 진입  <code>${fmtInt(entryPrice)}원</code> 부근`,
      `▸ 손절  <code>${fmtInt(stopPrice)}원</code> (-7%)`,
    ].join("\n");
  } else {
    body = [
      LINE,
      `<b>▸ 관망 권장</b>`,
      ...reasons.map((r) => `  · ${r}`),
      ``,
      `<i>급등주는 보내주고, 다음 기회를 기다리세요.</i>`,
    ].join("\n");
  }

  return [header, body].join("\n");
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
      text: "사용법: /매수 종목명 또는 코드\n예) /매수 삼성전자",
    });
  }

  // 1. 종목 검색
  const hits = await searchByNameOrCode(query, 5);
  if (!hits?.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.SCORE_NOT_FOUND,
    });
  }

  if (hits.length > 1 && !/^\d{6}$/.test(query.trim())) {
    const btns = hits.slice(0, 5).map((h) => ({
      text: `${h.name} (${h.code})`,
      callback_data: `buy:${h.code}`,
    }));
    const { createMultiRowKeyboard } = await import("../../telegram/keyboards");
    const keyboard = createMultiRowKeyboard(1, btns);
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `'${esc(query)}' 검색 결과 ${hits.length}건 — 종목을 선택하세요`,
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
    return;
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
    parse_mode: "HTML",
  });
}
