import { createClient } from "@supabase/supabase-js";
import type { ChatContext } from "../router";
import { PORTFOLIO_TABLES } from "../../db/portfolioSchema";
import { getUserInvestmentPrefs } from "../../services/userService";
import {
  applyStrategyBuyConstraint,
  detectAutoTradeMarketPolicy,
  pickAutoTradeCandidates,
  resolveDeployableCash,
  type RankedCandidate,
} from "../../services/virtualAutoTradeSelection";
import { calculateAutoTradeBuySizing } from "../../services/virtualAutoTradeSizing";
import { fetchAllMarketData } from "../../utils/fetchMarketData";
import { buildInvestmentPlan } from "../../lib/investPlan";
import { scaleScoreFactorsToReferencePrice } from "../../lib/priceScale";
import { esc, fmtInt, fmtPct, LINE } from "../messages/format";
import { actionButtons, buildRecommendationActionButtons } from "../messages/layout";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

type ScoreCandidateRow = {
  code: string;
  total_score: number | null;
  signal?: string | null;
  factors?: Record<string, unknown> | null;
  stock:
    | {
        code: string;
        name: string | null;
        close: number | null;
        rsi14?: number | null;
        liquidity?: number | null;
        market?: string | null;
        market_cap?: number | null;
        universe_level?: string | null;
      }
    | Array<{
        code: string;
        name: string | null;
        close: number | null;
        rsi14?: number | null;
        liquidity?: number | null;
        market?: string | null;
        market_cap?: number | null;
        universe_level?: string | null;
      }>
    | null;
};

type AutoTradeSettingLike = {
  monday_buy_slots: number;
  max_positions: number;
  min_buy_score: number;
  selected_strategy?: string | null;
};

function toNumber(value: unknown, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toPositiveInt(value: unknown, fallback: number): number {
  const num = Math.floor(toNumber(value, fallback));
  return num > 0 ? num : fallback;
}

function riskProfileLabel(profile?: "safe" | "balanced" | "active"): string {
  if (profile === "balanced") return "균형형";
  if (profile === "active") return "공격형";
  return "안전형";
}

function marketPolicyLabel(mode: string): string {
  if (mode === "large-cap-defense") return "방어";
  if (mode === "rotation") return "확장";
  return "균형";
}

function normalizeStock(input: ScoreCandidateRow["stock"]) {
  const row = Array.isArray(input) ? input[0] : input;
  if (!row) return null;
  const close = toNumber(row.close, 0);
  if (close <= 0) return null;
  return {
    name: String(row.name ?? ""),
    close,
    rsi14: toNumber((row as Record<string, unknown>).rsi14, 0) || null,
    liquidity: toNumber((row as Record<string, unknown>).liquidity, 0) || null,
    market: String((row as Record<string, unknown>).market ?? "") || null,
    marketCap: toNumber((row as Record<string, unknown>).market_cap, 0) || null,
    universeLevel: String((row as Record<string, unknown>).universe_level ?? "") || null,
  };
}

function isMissingScoresSignalColumn(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const rec = error as Record<string, unknown>;
  const code = String(rec.code ?? "").trim();
  const message = String(rec.message ?? rec.details ?? "").toLowerCase();
  return code === "42703" || (message.includes("scores.signal") && message.includes("does not exist"));
}

function buildDefaultSetting(profile?: "safe" | "balanced" | "active"): AutoTradeSettingLike {
  if (profile === "active") {
    return { monday_buy_slots: 3, max_positions: 12, min_buy_score: 74 };
  }
  if (profile === "balanced") {
    return { monday_buy_slots: 2, max_positions: 10, min_buy_score: 72 };
  }
  return { monday_buy_slots: 2, max_positions: 8, min_buy_score: 70 };
}

function resolveEntryPrice(plan: ReturnType<typeof buildInvestmentPlan>, currentPrice: number): number {
  if (plan.status === "buy-now") return Math.max(1, Math.round(currentPrice));
  if (currentPrice >= plan.entryLow && currentPrice <= plan.entryHigh) {
    return Math.round(currentPrice);
  }
  return Math.max(1, Math.round(plan.entryLow));
}

function buildOrderLines(input: {
  rank: number;
  candidate: RankedCandidate;
  plan: ReturnType<typeof buildInvestmentPlan>;
  quantity: number;
  orderPrice: number;
  investedAmount: number;
}): string[] {
  const firstSellQty = input.quantity <= 1 ? input.quantity : Math.max(1, Math.floor(input.quantity / 2));
  const secondSellQty = Math.max(0, input.quantity - firstSellQty);
  const statusLabel = input.plan.status === "buy-now" ? "즉시" : input.plan.status === "buy-on-pullback" ? "눌림대기" : "관망";

  return [
    `<b>${input.rank}. ${esc(input.candidate.name)}</b> <code>${input.candidate.code}</code>`,
    `- 판단 ${statusLabel} · 점수 <code>${input.candidate.score.toFixed(1)}</code>`,
    `- 매수주문 <code>${input.quantity}주 x ${fmtInt(input.orderPrice)}원</code> = <code>${fmtInt(input.investedAmount)}원</code>`,
    `- 진입구간 <code>${fmtInt(input.plan.entryLow)}원</code> ~ <code>${fmtInt(input.plan.entryHigh)}원</code>`,
    `- 손절 <code>${fmtInt(input.plan.stopPrice)}원</code> (${fmtPct(-input.plan.stopPct * 100)})`,
    `- 1차매도 <code>${firstSellQty}주 @ ${fmtInt(input.plan.target1)}원</code> (${fmtPct(input.plan.target1Pct * 100)})`,
    secondSellQty > 0
      ? `- 2차매도 <code>${secondSellQty}주 @ ${fmtInt(input.plan.target2)}원</code> (${fmtPct(input.plan.target2Pct * 100)})`
      : `- 2차매도 없음 (1차 전량 정리)`,
    `- 시야 ${input.plan.holdDays[0]}~${input.plan.holdDays[1]}거래일 · 손익비 ${input.plan.riskReward}:1`,
    `- 근거 ${esc(input.plan.summary)}`,
  ];
}

async function fetchLatestRankedRows(limit: number): Promise<{
  latestAsof: string | null;
  rows: RankedCandidate[];
  factorByCode: Map<string, Record<string, unknown>>;
}> {
  const { data: latestRows, error: latestError } = await supabase
    .from("scores")
    .select("asof")
    .order("asof", { ascending: false })
    .limit(1);

  if (latestError) {
    throw new Error(`점수 기준일 조회 실패: ${latestError.message}`);
  }

  const latestAsof = (latestRows?.[0]?.asof as string | undefined) ?? null;
  if (!latestAsof) {
    return { latestAsof: null, rows: [], factorByCode: new Map() };
  }

  const selectWithSignal = [
    "code",
    "total_score",
    "signal",
    "factors",
    "stock:stocks!inner(code, name, close, rsi14, liquidity, market, market_cap, universe_level)",
  ].join(",");
  const selectWithoutSignal = [
    "code",
    "total_score",
    "factors",
    "stock:stocks!inner(code, name, close, rsi14, liquidity, market, market_cap, universe_level)",
  ].join(",");

  let data: unknown[] | null = null;
  let error: unknown = null;

  ({ data, error } = await supabase
    .from("scores")
    .select(selectWithSignal)
    .eq("asof", latestAsof)
    .order("total_score", { ascending: false })
    .limit(limit));

  if (error && isMissingScoresSignalColumn(error)) {
    ({ data, error } = await supabase
      .from("scores")
      .select(selectWithoutSignal)
      .eq("asof", latestAsof)
      .order("total_score", { ascending: false })
      .limit(limit));
  }

  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`장전 후보 조회 실패: ${message}`);
  }

  const rows: RankedCandidate[] = [];
  const factorByCode = new Map<string, Record<string, unknown>>();

  for (const row of (data ?? []) as ScoreCandidateRow[]) {
    const stock = normalizeStock(row.stock);
    if (!stock) continue;
    rows.push({
      code: row.code,
      close: stock.close,
      score: toNumber(row.total_score, 0),
      name: stock.name || row.code,
      signal: row.signal ?? null,
      rsi14: stock.rsi14 ?? null,
      liquidity: stock.liquidity ?? null,
      market: stock.market ?? null,
      marketCap: stock.marketCap ?? null,
      universeLevel: stock.universeLevel ?? null,
    });
    factorByCode.set(row.code, (row.factors as Record<string, unknown> | null) ?? {});
  }

  return { latestAsof, rows, factorByCode };
}

export async function handlePreMarketPlanCommand(
  _input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const tgId = ctx.from?.id ?? ctx.chatId;
  const prefs = await getUserInvestmentPrefs(tgId);

  if (!prefs.capital_krw && !prefs.virtual_seed_capital) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "장전 주문 플랜을 만들려면 먼저 /투자금 설정이 필요합니다. 예) /투자금 300만원 3 8 안전형 5",
    });
    return;
  }

  const defaultSetting = buildDefaultSetting(prefs.risk_profile);
  const { data: settingRow } = await supabase
    .from("virtual_autotrade_settings")
    .select("monday_buy_slots, max_positions, min_buy_score, selected_strategy")
    .eq("chat_id", tgId)
    .maybeSingle();

  const setting: AutoTradeSettingLike = {
    ...defaultSetting,
    ...((settingRow as Partial<AutoTradeSettingLike> | null) ?? {}),
  };

  const { data: holdingsData } = await supabase
    .from(PORTFOLIO_TABLES.positionsLegacy)
    .select("code, status")
    .eq("chat_id", tgId);

  const heldCodes = new Set(
    ((holdingsData ?? []) as Array<{ code: string; status?: string | null }>)
      .filter((row) => (row.status ?? "holding") !== "closed")
      .map((row) => String(row.code))
  );
  const activeCount = heldCodes.size;
  const rawSlots = Math.max(0, Math.min(toPositiveInt(setting.monday_buy_slots, 2), toPositiveInt(setting.max_positions, 8) - activeCount));
  const buyConstraint = applyStrategyBuyConstraint({
    selectedStrategy: setting.selected_strategy,
    requestedSlots: rawSlots,
    baseMinBuyScore: toPositiveInt(setting.min_buy_score, defaultSetting.min_buy_score),
    activeCount,
  });

  const seedCapital = Math.max(0, toNumber(prefs.virtual_seed_capital, toNumber(prefs.capital_krw, 0)));
  const availableCash = Math.max(0, toNumber(prefs.virtual_cash, seedCapital));
  const marketOverview = await fetchAllMarketData().catch(() => null);
  const marketPolicy = detectAutoTradeMarketPolicy({ overview: marketOverview });
  let deployableCash = resolveDeployableCash({
    availableCash,
    seedCapital,
    minCashReservePct: marketPolicy.minCashReservePct,
  });

  if (buyConstraint.buySlots <= 0) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        "<b>장전 주문 플랜</b>",
        LINE,
        `현재 전략상 신규 진입 슬롯이 없습니다.`,
        buyConstraint.note ? esc(buyConstraint.note) : "전략 또는 보유 수 기준으로 신규 주문을 보류합니다.",
      ].join("\n"),
      parse_mode: "HTML",
    });
    return;
  }

  if (deployableCash <= 0) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        "<b>장전 주문 플랜</b>",
        LINE,
        `투자가능 현금이 부족해 오늘은 신규 주문을 만들지 않았습니다.`,
        `가용현금 <code>${fmtInt(availableCash)}원</code> · 주문가능 <code>${fmtInt(deployableCash)}원</code>`,
      ].join("\n"),
      parse_mode: "HTML",
    });
    return;
  }

  const { latestAsof, rows, factorByCode } = await fetchLatestRankedRows(300);
  const selection = pickAutoTradeCandidates({
    rows,
    preferredMinBuyScore: buyConstraint.minBuyScore,
    limit: Math.max(12, buyConstraint.buySlots * 4),
    heldCodes,
    marketPolicy,
  });

  const marketEnv = marketOverview
    ? {
        vix: marketOverview.vix?.price,
        fearGreed: marketOverview.fearGreed?.score,
        usdkrw: marketOverview.usdkrw?.price,
      }
    : undefined;

  const actionable: Array<{
    candidate: RankedCandidate;
    plan: ReturnType<typeof buildInvestmentPlan>;
    orderPrice: number;
    quantity: number;
    investedAmount: number;
  }> = [];

  let plannedHoldingCount = activeCount;
  let slotsLeft = Math.min(buyConstraint.buySlots, 3);

  for (const candidate of selection.candidates) {
    if (slotsLeft <= 0) break;
    const rawFactors = factorByCode.get(candidate.code) ?? {};
    const plan = buildInvestmentPlan({
      currentPrice: candidate.close,
      factors: scaleScoreFactorsToReferencePrice(
        {
          sma20: Number(rawFactors.sma20 ?? candidate.close),
          sma50: Number(rawFactors.sma50 ?? candidate.close),
          sma200: Number(rawFactors.sma200 ?? candidate.close),
          rsi14: Number(rawFactors.rsi14 ?? candidate.rsi14 ?? 50),
          roc14: Number(rawFactors.roc14 ?? 0),
          roc21: Number(rawFactors.roc21 ?? 0),
          avwap_support: Number(rawFactors.avwap_support ?? 50),
          atr14: Number(rawFactors.atr14 ?? 0),
          atr_pct: Number(rawFactors.atr_pct ?? 0),
          vol_ratio: Number(rawFactors.vol_ratio ?? 1),
          macd_cross:
            rawFactors.macd_cross === "golden" || rawFactors.macd_cross === "dead"
              ? rawFactors.macd_cross
              : null,
        },
        candidate.close,
        candidate.close
      ),
      technicalScore: candidate.score,
      variantSeed: `premarket:${candidate.code}`,
      marketEnv,
    });

    if (plan.status === "wait") continue;

    const orderPrice = resolveEntryPrice(plan, candidate.close);
    const sizing = calculateAutoTradeBuySizing({
      availableCash: deployableCash,
      price: orderPrice,
      slotsLeft,
      currentHoldingCount: plannedHoldingCount,
      maxPositions: toPositiveInt(setting.max_positions, defaultSetting.max_positions),
      stopLossPct: Math.abs(plan.stopPct * 100),
      prefs,
    });

    if (sizing.quantity <= 0 || sizing.investedAmount <= 0) continue;

    actionable.push({
      candidate,
      plan,
      orderPrice,
      quantity: sizing.quantity,
      investedAmount: sizing.investedAmount,
    });
    deployableCash = Math.max(0, deployableCash - sizing.investedAmount);
    plannedHoldingCount += 1;
    slotsLeft -= 1;
  }

  const summaryLines = [
    `<b>장전 주문 플랜</b>`,
    LINE,
    `투자성향 <code>${riskProfileLabel(prefs.risk_profile)}</code> · 시장모드 <code>${marketPolicyLabel(marketPolicy.mode)}</code>`,
    `가용현금 <code>${fmtInt(availableCash)}원</code> · 신규주문 가능 <code>${fmtInt(resolveDeployableCash({ availableCash, seedCapital, minCashReservePct: marketPolicy.minCashReservePct }))}원</code>`,
    `신규 슬롯 <code>${buyConstraint.buySlots}건</code> · 기준점수 <code>${buyConstraint.minBuyScore}점</code>`,
    latestAsof ? `점수 기준일 <code>${esc(latestAsof)}</code>` : "점수 기준일 없음",
  ];

  if (!actionable.length) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        ...summaryLines,
        "",
        `오늘은 장전 주문으로 바로 넣을 만한 후보가 없습니다.`,
        selection.latestTopScore > 0
          ? `상위 점수 <code>${selection.latestTopScore.toFixed(1)}점</code> · 선별기준 <code>${selection.thresholdUsed}점</code> · 모드 <code>${selection.selectionMode}</code>`
          : "점수 후보가 비어 있습니다.",
        "권장: /자동사이클 점검 또는 /브리핑 으로 시장 상태를 다시 확인하세요.",
      ].join("\n"),
      parse_mode: "HTML",
      reply_markup: actionButtons([
        { text: "자동 점검", callback_data: "cmd:autocycle:entry-check" },
        { text: "브리핑", callback_data: "cmd:brief" },
      ], 2),
    });
    return;
  }

  const blocks = actionable.flatMap((item, index) => ["", ...buildOrderLines({
    rank: index + 1,
    candidate: item.candidate,
    plan: item.plan,
    quantity: item.quantity,
    orderPrice: item.orderPrice,
    investedAmount: item.investedAmount,
  })]);

  const footer = [
    "",
    `<b>주문 원칙</b>`,
    `- 매수는 장전 예약 기준으로 계산했으며 실제 시초가 갭은 반영되지 않습니다.`,
    `- 1차 매도 체결 후 잔량은 2차 목표가 또는 보유대응 기준으로 관리합니다.`,
    `- 장이 약하면 /자동사이클 점검으로 먼저 재확인하는 편이 안전합니다.`,
  ];

  const buttons = buildRecommendationActionButtons(
    actionable.map((item) => ({ code: item.candidate.code, label: `${item.candidate.name}` })),
    [
      { text: "자동 점검", callback_data: "cmd:autocycle:entry-check" },
      { text: "브리핑", callback_data: "cmd:brief" },
      { text: "다시 생성", callback_data: "cmd:premarket" },
    ]
  );

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: [...summaryLines, ...blocks, ...footer].join("\n"),
    parse_mode: "HTML",
    reply_markup: actionButtons(buttons, 2),
  });
}