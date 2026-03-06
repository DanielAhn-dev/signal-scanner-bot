import type { ChatContext } from "../router";
import { createClient } from "@supabase/supabase-js";
import { searchByNameOrCode } from "../../search/normalize";
import { KO_MESSAGES } from "../messages/ko";
import { fetchRealtimePrice } from "../../utils/fetchRealtimePrice";
import { esc, fmtInt, LINE } from "../messages/format";
import { getUserInvestmentPrefs } from "../../services/userService";
import { getFundamentalSnapshot } from "../../services/fundamentalService";
import { actionButtons, ACTIONS } from "../messages/layout";

// Supabase 클라이언트
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// --- 매수 판독 로직 ---
function evaluateBuyCondition(
  stock: any,
  currentPrice: number,
  fundamentalQuality?: number
): {
  canBuy: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];

  const sma20 = stock.sma20 || currentPrice;
  const sma50 = stock.sma50 || 0;
  const rsi = stock.rsi14 || 50;

  const scoreData = Array.isArray(stock.scores)
    ? stock.scores[0]
    : stock.scores;
  const momentum = scoreData?.momentum_score || 0;

  // 20일선 이격도 계산
  const dist20 = ((currentPrice - sma20) / sma20) * 100;

  if (dist20 > 5) {
    reasons.push(`20일선 +${dist20.toFixed(1)}% 이격 — 눌림 대기`);
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

  // 50일선 하회 시 추가 경고
  if (sma50 > 0 && currentPrice < sma50 * 0.97) {
    reasons.push("50일선 하회 — 추세 약화 주의");
  }

  if (fundamentalQuality !== undefined) {
    if (fundamentalQuality < 40) {
      reasons.push(`재무건강도 낮음 (${fundamentalQuality}점) — 보수적 접근`);
    } else if (fundamentalQuality >= 70) {
      reasons.push(`재무건강도 우수 (${fundamentalQuality}점) — 중장기 보유 적합`);
    }
  }

  const canBuy =
    reasons.length === 0 ||
    (reasons.length === 1 &&
      (reasons[0].includes("소형주") || reasons[0].includes("재무건강도 우수")));

  return { canBuy, reasons };
}

// --- 이동평균 기반 진입가 계산 ---
function calculateEntryPrice(
  currentPrice: number,
  sma20: number,
  sma50: number
): { entryPrice: number; comment: string } {
  if (!sma20 || sma20 <= 0) {
    return { entryPrice: currentPrice, comment: "현재가 기준" };
  }

  const dist20 = ((currentPrice - sma20) / sma20) * 100;

  // 20일선 근접 (-3% ~ +3%) — 좋은 진입 지점
  if (dist20 >= -3 && dist20 <= 3) {
    return {
      entryPrice: currentPrice,
      comment: "20일선 근접 — 현재가 진입 가능",
    };
  }

  // 20일선보다 5% 이상 위 — 너무 높음, 20일선 부근 대기
  if (dist20 > 5) {
    return {
      entryPrice: Math.floor(sma20 * 1.01),
      comment: "20일선 +1% 부근 눌림 대기",
    };
  }

  // 20일선보다 3%~5% 위 — 분할 진입 가능
  if (dist20 > 3) {
    return {
      entryPrice: Math.floor((currentPrice + sma20) / 2),
      comment: "중간 가격대 분할 진입",
    };
  }

  // 20일선 -3% 아래 — 50일선 지지 확인
  if (sma50 > 0) {
    const dist50 = ((currentPrice - sma50) / sma50) * 100;
    if (dist50 >= -3 && dist50 <= 3) {
      return {
        entryPrice: currentPrice,
        comment: "50일선 지지 확인 — 현재가 진입 가능",
      };
    }
    if (dist50 > 0) {
      return {
        entryPrice: Math.floor(sma50 * 1.01),
        comment: "50일선 +1% 부근 분할 매수",
      };
    }
  }

  return {
    entryPrice: Math.floor(sma20 * 0.99),
    comment: "20일선 하회 — 반등 확인 후 진입",
  };
}

// --- 메시지 빌더 (HTML) ---
function buildMessage(
  stock: any,
  currentPrice: number,
  evaluation: { canBuy: boolean; reasons: string[] },
  fundamental?: {
    qualityScore: number;
    per?: number;
    pbr?: number;
    roe?: number;
    debtRatio?: number;
    salesGrowthPct?: number;
    opIncomeGrowthPct?: number;
    netIncomeGrowthPct?: number;
  },
  investPlan?: {
    capital: number;
    splitCount: number;
    perSplitAmount: number;
    targetProfitPct: number;
    expectedProfit: number;
    expectedTotal: number;
  }
): string {
  const { name, code } = stock;
  const { canBuy, reasons } = evaluation;

  const sma20 = stock.sma20 || currentPrice;
  const sma50 = stock.sma50 || 0;
  const entry = calculateEntryPrice(currentPrice, sma20, sma50);
  const stopPrice = Math.floor(entry.entryPrice * 0.93);

  // 등락 표시
  const changeStr = stock._realtimeChange !== undefined
    ? `${stock._realtimeChange >= 0 ? "▲" : "▼"} ${Math.abs(stock._realtimeChangeRate ?? 0).toFixed(2)}%`
    : "";

  const header = [
    `<b>${esc(name)}</b>  <code>${code}</code>  매수 판독`,
    `현재가  <code>${fmtInt(currentPrice)}원</code>  ${changeStr}`,
  ].join("\n");

  let body = "";
  if (canBuy) {
    body = [
      LINE,
      `<b>▸ 진입 가능</b>`,
      `  ${entry.comment}`,
      ``,
      `▸ 진입  <code>${fmtInt(entry.entryPrice)}원</code>`,
      `▸ 손절  <code>${fmtInt(stopPrice)}원</code> (-7%)`,
      `▸ 20MA  <code>${fmtInt(sma20)}원</code>`,
      sma50 > 0 ? `▸ 50MA  <code>${fmtInt(sma50)}원</code>` : "",
    ]
      .filter(Boolean)
      .join("\n");
  } else {
    body = [
      LINE,
      `<b>▸ 관망 권장</b>`,
      ...reasons.map((r) => `  · ${r}`),
      ``,
      `▸ 20MA  <code>${fmtInt(sma20)}원</code>`,
      sma50 > 0 ? `▸ 50MA  <code>${fmtInt(sma50)}원</code>` : "",
      ``,
      `<i>급등주는 보내주고, 다음 기회를 기다리세요.</i>`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  const planBlock = investPlan
    ? [
        "",
        LINE,
        "<b>▸ 내 투자금 기준 계획</b>",
        `  투자금  <code>${fmtInt(investPlan.capital)}원</code>`,
        `  분할매수  <code>${investPlan.splitCount}회</code> (회당 ${fmtInt(
          investPlan.perSplitAmount
        )}원)`,
        `  목표가정  +${investPlan.targetProfitPct.toFixed(1)}%`,
        `  예상수익  <code>${fmtInt(investPlan.expectedProfit)}원</code>`,
        `  목표도달시  <code>${fmtInt(investPlan.expectedTotal)}원</code>`,
      ].join("\n")
    : "";

  const fundamentalBlock = fundamental
    ? [
        "",
        LINE,
        "<b>▸ 재무 건강도</b>",
        `  ${fundamental.qualityScore}점 (PER ${
          fundamental.per !== undefined ? fundamental.per.toFixed(2) : "-"
        } · PBR ${
          fundamental.pbr !== undefined ? fundamental.pbr.toFixed(2) : "-"
        } · ROE ${
          fundamental.roe !== undefined ? `${fundamental.roe.toFixed(2)}%` : "-"
        } · 부채 ${
          fundamental.debtRatio !== undefined
            ? `${fundamental.debtRatio.toFixed(2)}%`
            : "-"
        })`,
        `  성장률  매출 ${
          fundamental.salesGrowthPct !== undefined
            ? `${fundamental.salesGrowthPct.toFixed(1)}%`
            : "-"
        } · 영업 ${
          fundamental.opIncomeGrowthPct !== undefined
            ? `${fundamental.opIncomeGrowthPct.toFixed(1)}%`
            : "-"
        } · 순익 ${
          fundamental.netIncomeGrowthPct !== undefined
            ? `${fundamental.netIncomeGrowthPct.toFixed(1)}%`
            : "-"
        }`,
      ].join("\n")
    : "";

  return [header, body, fundamentalBlock, planBlock].filter(Boolean).join("\n");
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
    const keyboard = actionButtons(btns, 1);
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
      code, name, close, sma20, sma50, rsi14, universe_level,
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

  // 3. 실시간 가격 조회
  const { fetchRealtimeStockData } = await import("../../utils/fetchRealtimePrice");
  const realtimeData = await fetchRealtimeStockData(code);

  // 실시간 가격이 있으면 그걸 쓰고, 없으면 DB의 close 사용
  const currentPrice = realtimeData?.price ?? stock.close;

  // 실시간 변동 정보를 stock 객체에 첨부
  const enrichedStock = {
    ...stock,
    _realtimeChange: realtimeData?.change,
    _realtimeChangeRate: realtimeData?.changeRate,
  };

  // 4. 평가 및 메시지 전송 (실시간 가격 기준)
  const fundamental = await getFundamentalSnapshot(code).catch(() => null);
  const evaluation = evaluateBuyCondition(
    enrichedStock,
    currentPrice,
    fundamental?.qualityScore
  );
  const prefs = await getUserInvestmentPrefs(ctx.from?.id ?? ctx.chatId);

  const capital = prefs.capital_krw ?? 0;
  const splitCount = prefs.split_count ?? 3;
  const targetProfitPct = prefs.target_profit_pct ?? 8;

  const investPlan =
    capital > 0 && splitCount > 0
      ? {
          capital,
          splitCount,
          perSplitAmount: Math.floor(capital / splitCount),
          targetProfitPct,
          expectedProfit: Math.floor(capital * (targetProfitPct / 100)),
          expectedTotal: Math.floor(capital * (1 + targetProfitPct / 100)),
        }
      : undefined;

  const msg = buildMessage(
    enrichedStock,
    currentPrice,
    evaluation,
    fundamental
      ? {
          qualityScore: fundamental.qualityScore,
          per: fundamental.per,
          pbr: fundamental.pbr,
          roe: fundamental.roe,
          debtRatio: fundamental.debtRatio,
          salesGrowthPct: fundamental.salesGrowthPct,
          opIncomeGrowthPct: fundamental.opIncomeGrowthPct,
          netIncomeGrowthPct: fundamental.netIncomeGrowthPct,
        }
      : undefined,
    investPlan
  );

  const kb = actionButtons(ACTIONS.analyzeStock(code), 3);

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: msg,
    parse_mode: "HTML",
    reply_markup: kb,
  });
}
