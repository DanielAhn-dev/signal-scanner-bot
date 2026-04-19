// src/bot/commands/watchlist.ts
// 가상 보유 포트폴리오 — 가상 매매 추적 + 실시간 가격

import type { ChatContext } from "../router";
import { createClient } from "@supabase/supabase-js";
import { searchByNameOrCode } from "../../search/normalize";
import { esc, fmtInt, fmtPct, LINE } from "../messages/format";
import {
  fetchRealtimePrice,
  fetchRealtimePriceBatch,
} from "../../utils/fetchRealtimePrice";
import { buildInvestmentPlan } from "../../lib/investPlan";
import { scaleScoreFactorsToReferencePrice } from "../../lib/priceScale";
import { buildStrategyMemo } from "../../lib/strategyMemo";
import {
  fetchWatchMicroSignalsByCodes,
  resolveWatchDecision,
  type ResponseAction,
} from "../../lib/watchlistSignals";
import {
  getUserInvestmentPrefs,
  setUserInvestmentPrefs,
} from "../../services/userService";
import {
  normalizeWatchlistHolding,
  syncVirtualPortfolio,
  calculateSectorConcentration,
  getSectorConcentrationWarnings,
  SECTOR_CONCENTRATION_WARNING_RATIO,
  SECTOR_CONCENTRATION_DANGER_RATIO,
  type VirtualTradeSide,
} from "../../services/portfolioService";
import {
  applyFifoSale,
  ensureTradeLotsForHolding,
  previewFifoSale,
  replaceTradeLotsForHolding,
} from "../../services/virtualLotService";
import {
  getEtfDistributionSummary,
  getEtfSnapshot,
  type EtfDistributionSummary,
  type EtfSnapshot,
} from "../../services/etfService";
import { fetchLatestScoresByCodes } from "../../services/scoreSourceService";

const MAX_ITEMS = 20; // 사용자당 최대 관심종목 수
const DEFAULT_TARGET_POSITIONS = 10;
const DEFAULT_FEE_RATE = 0.00015;
const DEFAULT_TAX_RATE = 0.0018;
const CORE_PLAN_STRATEGY_ID = "core.plan.v1";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 읽기 전용 (anon key)
const supabaseRead = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

function formatShortDate(raw?: string | null): string {
  if (!raw) return "--.--.--";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "--.--.--";
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}.${mm}.${dd}`;
}

function toPositiveNumber(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function toSafeNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function buildPlanFromScoreSnapshot(input: {
  currentPrice: number;
  baselinePrice?: number;
  stockRsi?: number;
  scoreRow?: {
    total_score?: number | null;
    momentum_score?: number | null;
    factors?: Record<string, any> | null;
  } | null;
}) {
  const currentPrice = toPositiveNumber(input.currentPrice) ?? 0;
  const baselinePrice = toPositiveNumber(input.baselinePrice) ?? currentPrice;
  const latestFactors =
    input.scoreRow?.factors && typeof input.scoreRow.factors === "object"
      ? input.scoreRow.factors
      : null;

  const factors = scaleScoreFactorsToReferencePrice(
    {
      sma20: Number(latestFactors?.sma20 ?? baselinePrice),
      sma50: Number(latestFactors?.sma50 ?? baselinePrice),
      sma200: Number(latestFactors?.sma200 ?? baselinePrice),
      rsi14: Number(latestFactors?.rsi14 ?? input.stockRsi ?? 50),
      roc14: Number(latestFactors?.roc14 ?? 0),
      roc21: Number(latestFactors?.roc21 ?? 0),
      avwap_support: Number(latestFactors?.avwap_support ?? 50),
      atr14: Number(latestFactors?.atr14 ?? 0),
      atr_pct: Number(latestFactors?.atr_pct ?? 0),
      vol_ratio: Number(latestFactors?.vol_ratio ?? 1),
      macd_cross:
        latestFactors?.macd_cross === "golden" || latestFactors?.macd_cross === "dead"
          ? latestFactors.macd_cross
          : "none",
    },
    currentPrice,
    baselinePrice
  );

  const technicalScore =
    Number(input.scoreRow?.total_score ?? input.scoreRow?.momentum_score ?? 0) ||
    undefined;

  return buildInvestmentPlan({
    currentPrice,
    factors,
    technicalScore,
  });
}

function hasVirtualPosition(item: any): boolean {
  const buyPrice = toPositiveNumber(item?.buy_price);
  const qty = Math.max(0, Math.floor(Number(item?.quantity ?? 0)));
  return Boolean(buyPrice && qty > 0);
}

function isWatchOnlyItem(item: any): boolean {
  return !hasVirtualPosition(item);
}

async function fetchWatchlistRows(chatId: number): Promise<{ items: any[]; error: any }> {
  const { data, error } = await supabaseRead
    .from("watchlist")
    .select(
      `
      code, buy_price, buy_date, memo, created_at, quantity, invested_amount,
      stock:stocks!inner ( name, market, close, rsi14, sector_id )
    `
    )
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });

  return {
    items: (data ?? []) as any[],
    error,
  };
}

/**
 * 섹터 집중도 배열을 받아 경고 문자열을 반환한다.
 * 30% 초과 섹터만 표시. 경고가 없으면 빈 문자열.
 */
function buildConcentrationWarning(
  concentrations: ReturnType<typeof calculateSectorConcentration>
): string {
  const warned = getSectorConcentrationWarnings(concentrations);
  if (!warned.length) return "";

  const lines = warned.map((c) => {
    const icon = c.level === "danger" ? "🔴" : "⚠️";
    return `  ${icon} ${c.sectorName} ${c.ratio.toFixed(0)}%`;
  });

  return [
    LINE,
    `<b>섹터 집중도 경고</b> (${SECTOR_CONCENTRATION_WARNING_RATIO}% 초과)` ,
    ...lines,
    `<i>${SECTOR_CONCENTRATION_DANGER_RATIO}% 초과는 강한 집중 구간입니다. 분산 투자 검토 권장</i>`,
  ].join("\n");
}

function isKstMarketOpen(now = new Date()): boolean {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay();
  if (day === 0 || day === 6) return false;
  const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const open = 9 * 60;
  const close = 15 * 60 + 30;
  return minutes >= open && minutes <= close;
}

function estimateElapsedTradingDays(raw?: string | null, now = new Date()): number {
  if (!raw) return 0;
  const start = new Date(raw);
  if (Number.isNaN(start.getTime()) || start.getTime() > now.getTime()) return 0;

  const dayMs = 24 * 60 * 60 * 1000;
  const startUtcMidnight = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endUtcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  let elapsed = 0;
  for (let t = startUtcMidnight; t <= endUtcMidnight; t += dayMs) {
    const day = new Date(t).getUTCDay();
    if (day !== 0 && day !== 6) elapsed += 1;
  }

  // 진입 당일은 제외하고 경과 거래일로 계산한다.
  return Math.max(0, elapsed - 1);
}

function formatEtfMonthList(months: number[]): string {
  if (!months.length) return "확인 필요";
  return months.map((month) => `${month}월`).join(", ");
}

function buildEtfActionSummary(input: {
  premiumRate?: number;
  nextExpectedDate?: string;
  latestPayoutDate?: string;
}): string {
  const premiumRate = input.premiumRate;
  const premiumLabel = premiumRate == null
    ? "괴리율 확인"
    : Math.abs(premiumRate) >= 1
      ? `괴리율 ${fmtPct(premiumRate)} 점검`
      : `괴리율 ${fmtPct(premiumRate)} 안정권`;
  const payoutLabel = input.latestPayoutDate
    ? `실지급 ${input.latestPayoutDate}`
    : input.nextExpectedDate
      ? `다음 예상 ${input.nextExpectedDate}`
      : "분배 공시 대기";
  return `${premiumLabel} · ${payoutLabel}`;
}

async function appendVirtualTradeLog(payload: {
  chatId: number;
  code: string;
  side: VirtualTradeSide;
  price: number;
  quantity: number;
  grossAmount: number;
  netAmount: number;
  feeAmount?: number;
  taxAmount?: number;
  pnlAmount?: number;
  memo?: string;
}): Promise<{ ok: boolean; error?: string; id?: number }> {
  try {
    const { data, error } = await supabase
      .from("virtual_trades")
      .insert({
        chat_id: payload.chatId,
        code: payload.code,
        side: payload.side,
        price: payload.price,
        quantity: payload.quantity,
        gross_amount: payload.grossAmount,
        net_amount: payload.netAmount,
        fee_amount: payload.feeAmount ?? 0,
        tax_amount: payload.taxAmount ?? 0,
        pnl_amount: payload.pnlAmount ?? 0,
        memo: payload.memo ?? null,
        traded_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      console.error("appendVirtualTradeLog error:", error);
      return { ok: false, error: error.message };
    }

    return { ok: true, id: Number((data as any)?.id) || undefined };
  } catch (e) {
    console.error("appendVirtualTradeLog error:", e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function buildAdjustmentMemo(input: {
  prevPrice: number | null;
  nextPrice: number;
  prevQty: number;
  nextQty: number;
}): string {
  return [
    "watchlist-adjust:v2",
    `prevPrice=${input.prevPrice ?? 0}`,
    `nextPrice=${input.nextPrice}`,
    `prevQty=${input.prevQty}`,
    `nextQty=${input.nextQty}`,
  ].join(";");
}

function parseAdjustmentValue(raw?: string | null): number | null {
  const num = Number(String(raw ?? "").trim());
  return Number.isFinite(num) && num > 0 ? num : null;
}

function parseAdjustmentPair(raw?: string | null): [number | null, number | null] {
  const parts = String(raw ?? "")
    .split(/(?:→|->|=>|~>|→\uFE0E?)/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    return [parseAdjustmentValue(parts[0]), parseAdjustmentValue(parts[1])];
  }

  return [null, null];
}

function parseAdjustmentMemo(raw?: string | null): {
  prevPrice: number | null;
  nextPrice: number | null;
  prevQty: number | null;
  nextQty: number | null;
} | null {
  const memo = String(raw ?? "");
  const v2Match = memo.match(
    /watchlist-adjust:v2;prevPrice=([^;]+);nextPrice=([^;]+);prevQty=([^;]+);nextQty=([^;]+)/i
  );
  if (v2Match) {
    return {
      prevPrice: parseAdjustmentValue(v2Match[1]),
      nextPrice: parseAdjustmentValue(v2Match[2]),
      prevQty: parseAdjustmentValue(v2Match[3]),
      nextQty: parseAdjustmentValue(v2Match[4]),
    };
  }

  const legacyMatch = memo.match(/watchlist-adjust:buy=([^;]+);qty=([^;]+)/i);
  if (!legacyMatch) return null;

  const [prevPrice, nextPrice] = parseAdjustmentPair(legacyMatch[1]);
  const [prevQty, nextQty] = parseAdjustmentPair(legacyMatch[2]);

  return {
    prevPrice,
    nextPrice,
    prevQty: prevQty != null ? Math.floor(prevQty) : null,
    nextQty: nextQty != null ? Math.floor(nextQty) : null,
  };
}

function formatFifoMatchSummary(
  matches: Array<{ quantity: number; unitCost: number }>
): string {
  if (!matches.length) return "";

  const parts = matches
    .slice(0, 3)
    .map((match) => `${match.quantity}주@${fmtInt(match.unitCost)}원`);
  const extra = matches.length > 3 ? ` 외 ${matches.length - 3}건` : "";
  return `FIFO ${parts.join(" + ")}${extra}`;
}

async function allocateVirtualBuy(payload: {
  chatId: number;
  tgId: number;
  code: string;
  buyPrice: number | null;
  currentHoldingCount: number;
}): Promise<{
  quantity: number | null;
  investedAmount: number | null;
  walletNote: string;
  nextCash: number | null;
  seedCapital: number | null;
  targetPositions: number;
}> {
  const buyPrice = toPositiveNumber(payload.buyPrice);
  if (!buyPrice) {
    return {
      quantity: null,
      investedAmount: null,
      walletNote: "",
      nextCash: null,
      seedCapital: null,
      targetPositions: DEFAULT_TARGET_POSITIONS,
    };
  }

  const prefs = await getUserInvestmentPrefs(payload.tgId);
  const cap = toPositiveNumber(prefs.capital_krw) ?? 0;
  if (cap <= 0) {
    return {
      quantity: null,
      investedAmount: null,
      walletNote: "",
      nextCash: null,
      seedCapital: null,
      targetPositions: DEFAULT_TARGET_POSITIONS,
    };
  }

  const seedCapital = toPositiveNumber(prefs.virtual_seed_capital) ?? cap;
  const targetPositions = Math.max(
    1,
    Math.floor(toPositiveNumber(prefs.virtual_target_positions) ?? DEFAULT_TARGET_POSITIONS)
  );
  const currentCash =
    toPositiveNumber(prefs.virtual_cash) ?? (seedCapital > 0 ? seedCapital : cap);

  if (currentCash <= 0) {
    return {
      quantity: null,
      investedAmount: null,
      walletNote: "\n가상매수 미반영: 잔액이 부족합니다. /투자금으로 원금을 조정해 주세요.",
      nextCash: null,
      seedCapital: seedCapital || cap,
      targetPositions,
    };
  }

  const slotsLeft = Math.max(targetPositions - payload.currentHoldingCount, 1);
  const budgetPerPosition = Math.floor(currentCash / slotsLeft);
  const qty = Math.floor(budgetPerPosition / buyPrice);

  if (qty < 1) {
    return {
      quantity: null,
      investedAmount: null,
      walletNote: "\n가상매수 미반영: 현재 잔액 기준 1주 매수가 어려워요.",
      nextCash: null,
      seedCapital: seedCapital || cap,
      targetPositions,
    };
  }

  const investedAmount = qty * buyPrice;
  const nextCash = Math.max(0, currentCash - investedAmount);

  return {
    quantity: qty,
    investedAmount,
    walletNote: `\n가상매수 ${qty}주 · 사용 ${fmtInt(investedAmount)}원 · 잔액 ${fmtInt(nextCash)}원`,
    nextCash,
    seedCapital: seedCapital || cap,
    targetPositions,
  };
}

// ─── /관심 (목록 조회) ─────────────────────
export async function handleWatchOnlyCommand(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const { items: allItems, error } = await fetchWatchlistRows(ctx.chatId);

  if (error) {
    console.error("watch-only query error:", error);
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "관심 목록 조회 중 오류가 발생했습니다.",
    });
  }

  const items = allItems.filter(isWatchOnlyItem);
  if (!items.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        "관심 목록이 비어 있습니다.",
        "",
        "/관심추가 종목명",
        "예) /관심추가 삼성전자",
        "추가한 종목은 /관심대응 또는 /브리핑에서 추이를 확인할 수 있습니다.",
      ].join("\n"),
    });
  }

  const codes = items.map((it: any) => String(it.code));
  const [realtimeMap, scoreResult] = await Promise.all([
    fetchRealtimePriceBatch(codes),
    fetchLatestScoresByCodes(supabaseRead, codes).catch(() => null),
  ]);

  const lines = items.map((item: any, idx: number) => {
    const stock = item.stock as any;
    const code = String(item.code);
    const name = stock?.name ?? code;
    const dbClose = Number(stock?.close ?? 0);
    const close = toPositiveNumber(realtimeMap[code]?.price) ?? dbClose;
    const plan = buildPlanFromScoreSnapshot({
      currentPrice: close,
      baselinePrice: dbClose,
      stockRsi: stock?.rsi14 ?? undefined,
      scoreRow: scoreResult?.byCode.get(code),
    });
    const addedDate = formatShortDate(item.created_at as string | null | undefined);
    const changeStr = realtimeMap[code]
      ? `${realtimeMap[code].change >= 0 ? "▲" : "▼"} ${Math.abs(realtimeMap[code].changeRate).toFixed(1)}%`
      : "";

    return [
      `${idx + 1}. <b>${esc(name)}</b> (${code}) · 추가 (${addedDate})`,
      `    현재 <code>${fmtInt(close)}원</code> ${changeStr}`,
      `    상태 ${plan.statusLabel} · 진입 ${fmtInt(plan.entryLow)}~${fmtInt(plan.entryHigh)}`,
      `    손절 ${fmtInt(plan.stopPrice)} · 1차 ${fmtPct(plan.target1Pct * 100)}`,
    ].join("\n");
  });

  const msg = [
    "<b>관심 종목 목록</b>",
    LINE,
    `관심 ${items.length}/${MAX_ITEMS}종목 · 가상 체결은 /가상매수 에서 별도 실행`,
    "",
    ...lines,
    "",
    "/관심추가 종목 · /관심제거 종목",
    "/관심대응 · /가상매수 종목 [매수가]",
  ].join("\n");

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: msg,
    parse_mode: "HTML",
  });
}

export async function handleWatchOnlyAdd(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const query = (input || "").trim();
  if (!query) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "사용법: /관심추가 종목명\n예) /관심추가 삼성전자",
    });
  }

  const { count } = await supabaseRead
    .from("watchlist")
    .select("id", { count: "exact", head: true })
    .eq("chat_id", ctx.chatId);

  if ((count ?? 0) >= MAX_ITEMS) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `최대 ${MAX_ITEMS}개까지 등록할 수 있습니다.\n/관심제거 또는 /가상매도 후 다시 추가해주세요.`,
    });
  }

  const hits = await searchByNameOrCode(query, 1);
  if (!hits?.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "종목을 찾을 수 없습니다. 이름 또는 코드를 확인해주세요.",
    });
  }

  const { code, name } = hits[0];
  const { data: existing } = await supabaseRead
    .from("watchlist")
    .select("id, buy_price, quantity")
    .eq("chat_id", ctx.chatId)
    .eq("code", code)
    .maybeSingle();

  if (existing) {
    if (hasVirtualPosition(existing)) {
      return tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: `${esc(name)} (${code})은 이미 가상 보유 포트폴리오에 있습니다.\n/보유 에서 확인해주세요.`,
        parse_mode: "HTML",
      });
    }
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `${esc(name)} (${code})은 이미 관심 목록에 있습니다.`,
      parse_mode: "HTML",
    });
  }

  const { error } = await supabase
    .from("watchlist")
    .insert({
      chat_id: ctx.chatId,
      code,
      buy_price: null,
      buy_date: null,
      quantity: null,
      invested_amount: null,
      status: "closed",
      memo: "watch-only",
    });

  if (error) {
    console.error("watch-only add error:", error);
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "관심추가 처리 중 오류가 발생했습니다.",
    });
  }

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: `${esc(name)} (${code}) 관심 목록에 추가했습니다.\n/관심 으로 추이 확인\n진입 시 /가상매수 ${name}`,
    parse_mode: "HTML",
  });
}

export async function handleWatchOnlyRemove(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const query = (input || "").trim();
  if (!query) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "사용법: /관심제거 종목명\n예) /관심제거 삼성전자",
    });
  }

  const hits = await searchByNameOrCode(query, 1);
  if (!hits?.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "종목을 찾을 수 없습니다.",
    });
  }

  const { code, name } = hits[0];
  const { data: row, error: rowError } = await supabaseRead
    .from("watchlist")
    .select("id, buy_price, quantity")
    .eq("chat_id", ctx.chatId)
    .eq("code", code)
    .maybeSingle();

  if (rowError) {
    console.error("watch-only remove fetch error:", rowError);
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "관심제거 조회 중 오류가 발생했습니다.",
    });
  }

  if (!row) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `${esc(name)} (${code})은 관심 목록에 없습니다.`,
      parse_mode: "HTML",
    });
  }

  if (hasVirtualPosition(row)) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `${esc(name)} (${code})은 가상 보유 종목입니다.\n/가상매도 또는 /보유수정 으로 관리해주세요.`,
      parse_mode: "HTML",
    });
  }

  const { error } = await supabase
    .from("watchlist")
    .delete()
    .eq("chat_id", ctx.chatId)
    .eq("code", code);

  if (error) {
    console.error("watch-only remove error:", error);
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "관심제거 처리 중 오류가 발생했습니다.",
    });
  }

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: `${esc(name)} (${code}) 관심 목록에서 제거했습니다.`,
    parse_mode: "HTML",
  });
}

export async function handleWatchOnlyReset(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const token = String(input || "").trim().toLowerCase();
  const confirmedFull = ["전체확인", "fullreset", "all"].includes(token);
  const confirmed = confirmedFull || ["확인", "yes", "y", "run", "실행"].includes(token);

  const { items: allItems, error } = await fetchWatchlistRows(ctx.chatId);
  if (error) {
    console.error("watch-only reset query error:", error);
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "관심 초기화 조회 중 오류가 발생했습니다.",
    });
  }

  const watchOnlyItems = allItems.filter(isWatchOnlyItem);
  const holdingItems = allItems.filter((item: any) => !isWatchOnlyItem(item));

  // 전체 초기화 (관심 + 보유 모두 삭제, 거래기록 미생성)
  if (confirmedFull) {
    if (!allItems.length) {
      return tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "관심/보유 목록이 이미 비어 있습니다.",
      });
    }

    const { error: deleteError, count } = await supabase
      .from("watchlist")
      .delete({ count: "exact" })
      .eq("chat_id", ctx.chatId);

    if (deleteError) {
      console.error("full reset delete error:", deleteError);
      return tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "전체 초기화 처리 중 오류가 발생했습니다.",
      });
    }

    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        "<b>관심/보유 전체 초기화 완료</b>",
        LINE,
        `삭제 ${count ?? allItems.length}건 (관심 ${watchOnlyItems.length} + 보유 ${holdingItems.length})`,
        "⚠️ 보유 포지션도 거래기록 없이 삭제되었습니다.",
        "",
        "다음: /관심추가 종목명 또는 /가상매수 종목명 으로 다시 구성하세요.",
      ].join("\n"),
      parse_mode: "HTML",
    });
  }

  if (!watchOnlyItems.length && !holdingItems.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "초기화할 관심 종목이 없습니다.\n/관심 으로 현재 상태를 확인해주세요.",
    });
  }

  if (!confirmed) {
    const lines = [
      "<b>관심 초기화 안내</b>",
      LINE,
      `현재 관심-only ${watchOnlyItems.length}종목을 한 번에 삭제합니다.`,
      "가상 보유 포지션(/보유)은 삭제되지 않습니다.",
      "",
      "실행: <code>/관심초기화 확인</code>",
    ];
    if (holdingItems.length) {
      lines.push("");
      lines.push(`💡 보유 포지션(${holdingItems.length}종목)까지 모두 지우려면:`);
      lines.push("<code>/관심초기화 전체확인</code>  ← 거래기록 없이 전체 삭제 (테스트용)");
    }
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: lines.join("\n"),
      parse_mode: "HTML",
    });
  }

  if (!watchOnlyItems.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        "삭제할 관심-only 종목이 없습니다.",
        holdingItems.length
          ? `보유 포지션 ${holdingItems.length}종목도 지우려면 <code>/관심초기화 전체확인</code>`
          : "",
      ].filter(Boolean).join("\n"),
      parse_mode: "HTML",
    });
  }

  const deleteIds = watchOnlyItems
    .map((item: any) => Number(item.id ?? 0))
    .filter((id) => Number.isFinite(id) && id > 0);

  if (!deleteIds.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "초기화 대상 식별에 실패했습니다. 잠시 후 다시 시도해주세요.",
    });
  }

  const { error: deleteError, count } = await supabase
    .from("watchlist")
    .delete({ count: "exact" })
    .eq("chat_id", ctx.chatId)
    .in("id", deleteIds);

  if (deleteError) {
    console.error("watch-only reset delete error:", deleteError);
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "관심 초기화 처리 중 오류가 발생했습니다.",
    });
  }

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: [
      "<b>관심 초기화 완료</b>",
      LINE,
      `삭제 ${count ?? deleteIds.length}건`,
      holdingItems.length
        ? `보유 포지션 ${holdingItems.length}종목은 유지되었습니다.\n보유까지 전체 삭제: <code>/관심초기화 전체확인</code>`
        : "보유 포지션은 유지되었습니다.",
      "",
      "다음: /관심추가 종목명 으로 새 후보를 다시 구성하세요.",
    ].join("\n"),
    parse_mode: "HTML",
  });
}

export async function handleWatchOnlyResponseCommand(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const { items: allItems, error } = await fetchWatchlistRows(ctx.chatId);

  if (error) {
    console.error("watch-only response query error:", error);
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "관심 대응 플랜 생성 중 오류가 발생했습니다.",
    });
  }

  const items = allItems.filter(isWatchOnlyItem);
  if (!items.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "관심 종목이 없어 대응 계획을 만들 수 없습니다.\n/관심추가 후 다시 실행해주세요.",
    });
  }

  const codes = items.map((it: any) => String(it.code));
  const [realtimeMap, scoreResult] = await Promise.all([
    fetchRealtimePriceBatch(codes),
    fetchLatestScoresByCodes(supabaseRead, codes).catch(() => null),
  ]);

  const lines = items.map((item: any) => {
    const stock = item.stock as any;
    const code = String(item.code);
    const name = String(stock?.name ?? code);
    const dbClose = Number(stock?.close ?? 0);
    const close = toPositiveNumber(realtimeMap[code]?.price) ?? dbClose;
    const plan = buildPlanFromScoreSnapshot({
      currentPrice: close,
      baselinePrice: dbClose,
      stockRsi: stock?.rsi14 ?? undefined,
      scoreRow: scoreResult?.byCode.get(code),
    });
    const nextAction =
      plan.status === "buy-now"
        ? "분할 진입 검토"
        : plan.status === "buy-on-pullback"
          ? "눌림 구간 대기"
          : "관망 유지";

    return [
      `- <b>${esc(name)}</b> (${code})`,
      `  기준가 ${fmtInt(close)}원 · 상태 ${plan.statusLabel}`,
      `  진입 ${fmtInt(plan.entryLow)}~${fmtInt(plan.entryHigh)} · 손절 ${fmtInt(plan.stopPrice)}`,
      `  1차목표 ${fmtInt(plan.target1)}원 · 대응 ${nextAction}`,
      `  체결 시: /가상매수 ${name} ${fmtInt(close)}`,
    ].join("\n");
  });

  const msg = [
    "<b>관심대응 플랜</b>",
    LINE,
    "관심 종목은 체결 없이 추이만 점검합니다.",
    "실제 가상매매는 /가상매수 로 별도 실행하세요.",
    "",
    ...lines,
  ].join("\n");

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: msg,
    parse_mode: "HTML",
  });
}

// ─── /보유 (목록 조회) ─────────────────────
export async function handleWatchlistCommand(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const tgId = ctx.from?.id ?? ctx.chatId;
  const prefs = await getUserInvestmentPrefs(tgId);

  const { data: scoreDateRows } = await supabaseRead
    .from("scores")
    .select("asof")
    .order("asof", { ascending: false })
    .limit(1);
  const scoreAsOf = scoreDateRows?.[0]?.asof ?? null;

  const { items: allItems, error } = await fetchWatchlistRows(ctx.chatId);

  if (error) {
    console.error("watchlist query error:", error);
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "보유 포트폴리오 조회 중 오류가 발생했습니다.",
    });
  }

  const items = allItems.filter(hasVirtualPosition);

  if (!items.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        "가상 보유 포트폴리오가 비어 있습니다.",
        "",
        "/관심추가 종목명",
        "예) /관심추가 삼성전자",
        "/가상매수 종목명 [매수가]",
        "예) /가상매수 삼성전자 72000",
        "관심은 /관심, 가상체결은 /보유에서 분리해 점검할 수 있습니다.",
      ].join("\n"),
    });
  }

  // 실시간 가격 일괄 조회
  const codes = items.map((it: any) => it.code);
  const realtimeMap = await fetchRealtimePriceBatch(codes);
  const scoresByCode = new Map<
    string,
    {
      total_score?: number | null;
      momentum_score?: number | null;
      factors?: Record<string, any> | null;
    }
  >();
  const etfCodes = items
    .filter((item: any) => String((item.stock as any)?.market ?? "") === "ETF")
    .map((item: any) => String(item.code));
  const etfMetaMap = new Map<string, { snapshot: EtfSnapshot | null; distribution: EtfDistributionSummary | null }>();

  await Promise.all(
    etfCodes.map(async (code) => {
      const matched = items.find((item: any) => String(item.code) === code);
      const matchedStock = Array.isArray(matched?.stock) ? matched?.stock[0] : matched?.stock;
      const name = matchedStock?.name;
      const [snapshot, distribution] = await Promise.all([
        getEtfSnapshot(code).catch(() => null),
        getEtfDistributionSummary(code, name).catch(() => null),
      ]);
      etfMetaMap.set(code, { snapshot, distribution });
    })
  );

  if (scoreAsOf && codes.length) {
    const { data: scoreRows } = await supabaseRead
      .from("scores")
      .select("code, total_score, momentum_score")
      .eq("asof", scoreAsOf)
      .in("code", codes);

    for (const row of scoreRows ?? []) {
      scoresByCode.set(row.code as string, {
        total_score: Number((row as any).total_score ?? 0),
        momentum_score: Number((row as any).momentum_score ?? 0),
        factors:
          (row as any).factors && typeof (row as any).factors === "object"
            ? ((row as any).factors as Record<string, any>)
            : null,
      });
    }
  }

  let totalCost = 0;
  let totalValue = 0;
  let actionable = 0;
  let pullback = 0;
  let wait = 0;
  let etfCount = 0;
  let stockCount = 0;

  const lines = items.map((item: any, idx: number) => {
    const stock = item.stock as any;
    const name = stock?.name ?? item.code;
    const market = String(stock?.market ?? "");
    if (market === "ETF") etfCount += 1;
    else stockCount += 1;
    const etfMeta = etfMetaMap.get(String(item.code));
    const dbClose = Number(stock?.close ?? 0);
    const rt = realtimeMap[item.code];
    const close = rt?.price ?? dbClose;
    const buyPrice = Number(item.buy_price ?? 0);
    const qty = Math.max(0, Math.floor(Number(item.quantity ?? (buyPrice > 0 ? 1 : 0))));
    const invested = toPositiveNumber(item.invested_amount) ?? (qty > 0 && buyPrice > 0 ? qty * buyPrice : 0);
    const hasBuy = buyPrice > 0;
    const score = scoresByCode.get(item.code);
    const plan = buildPlanFromScoreSnapshot({
      currentPrice: close,
      baselinePrice: dbClose,
      stockRsi: stock?.rsi14 ?? undefined,
      scoreRow: score,
    });

    if (plan.status === "buy-now") actionable += 1;
    else if (plan.status === "buy-on-pullback") pullback += 1;
    else wait += 1;

    // 등락 표시
    const changeStr = rt
      ? `${rt.change >= 0 ? "▲" : "▼"} ${Math.abs(rt.changeRate).toFixed(1)}%`
      : "";

    let plStr = "";
    if (hasBuy && close > 0 && qty > 0) {
      const valueNow = close * qty;
      const plPct = invested > 0 ? ((valueNow - invested) / invested) * 100 : 0;
      const plAmt = valueNow - invested;
      const plSign = plPct >= 0 ? "▲" : "▼";
      plStr = `\n    수익 ${plSign} ${fmtPct(plPct)} (${plAmt >= 0 ? "+" : ""}${fmtInt(plAmt)}원)`;
      totalCost += invested;
      totalValue += valueNow;
    }

    const buyStr = hasBuy
      ? `\n    매수 <code>${fmtInt(buyPrice)}원</code> · ${qty}주 · 원금 ${fmtInt(invested)}원`
      : "";
    const addedDate = formatShortDate(item.created_at as string | null | undefined);
    const actionStr =
      market === "ETF"
        ? `\n    ETF 체크 ${buildEtfActionSummary({
            premiumRate: etfMeta?.snapshot?.premiumRate,
            nextExpectedDate: etfMeta?.distribution?.nextExpectedDate,
            latestPayoutDate: etfMeta?.distribution?.latestPayoutDate,
          })}`
        : plan.status === "buy-on-pullback"
          ? `\n    액션 ${plan.statusLabel} · 진입 ${fmtInt(plan.entryLow)}~${fmtInt(plan.entryHigh)}`
          : `\n    액션 ${plan.statusLabel} · 손절 ${fmtInt(plan.stopPrice)} · 1차 ${fmtPct(plan.target1Pct * 100)}`;
    const etfStr = market === "ETF"
      ? [
          etfMeta?.snapshot?.latestNav || etfMeta?.snapshot?.nav
            ? `\n    ETF NAV <code>${fmtInt(Number(etfMeta?.snapshot?.latestNav ?? etfMeta?.snapshot?.nav ?? 0))}원</code> · 괴리율 ${etfMeta?.snapshot?.premiumRate != null ? fmtPct(etfMeta.snapshot.premiumRate) : "확인중"}`
            : "",
          etfMeta?.distribution
            ? `\n    분배 ${etfMeta.distribution.cadenceLabel} · 월 ${formatEtfMonthList(etfMeta.distribution.monthList)}${etfMeta.distribution.annualAmount != null ? ` · 올해누적 ${fmtInt(etfMeta.distribution.annualAmount)}원` : etfMeta.distribution.latestAmount != null ? ` · 최근 ${fmtInt(etfMeta.distribution.latestAmount)}원` : ""}${etfMeta.distribution.nextExpectedDate ? ` · 다음 예상 ${etfMeta.distribution.nextExpectedDate}` : ""}`
            : "",
        ].join("")
      : "";

    return (
      `${idx + 1}. <b>${esc(name)}</b> (${item.code})${market === "ETF" ? " · ETF" : ""} · 추가 (${addedDate})\n` +
      `    현재 <code>${fmtInt(close)}원</code>  ${changeStr}` +
      buyStr +
      plStr +
      actionStr +
      etfStr
    );
  });

  // 전체 수익률
  let summaryLine = "";
  if (totalCost > 0) {
    const totalPl = ((totalValue - totalCost) / totalCost) * 100;
    const sign = totalPl >= 0 ? "▲" : "▼";
    summaryLine = `\n${LINE}\n전체 ${sign} ${fmtPct(totalPl)}  (${items.length}/${MAX_ITEMS}종목)`;
  } else {
    summaryLine = `\n${LINE}\n${items.length}/${MAX_ITEMS}종목`;
  }

  // 섹터 집중도 경고
  const concentrationWarning = buildConcentrationWarning(
    calculateSectorConcentration(
      items.map((item: any) => ({
        sectorId: (item.stock as any)?.sector_id ?? null,
        investedAmount: toPositiveNumber(item.invested_amount),
      }))
    )
  );

  const seedCapital = toSafeNumber(
    prefs.virtual_seed_capital ?? prefs.capital_krw,
    0
  );
  const cash = toSafeNumber(prefs.virtual_cash, seedCapital);
  const realized = toSafeNumber(prefs.virtual_realized_pnl, 0);
  const evalValue = totalValue;
  const totalAsset = cash + evalValue;
  const totalPnl = totalAsset - seedCapital;
  const walletSummary =
    seedCapital > 0
      ? [
          LINE,
          `<b>가상지갑</b> 원금 ${fmtInt(seedCapital)}원 · 잔액 ${fmtInt(cash)}원`,
          `평가자산 ${fmtInt(evalValue)}원 · 총자산 ${fmtInt(totalAsset)}원`,
          `총손익 ${totalPnl >= 0 ? "+" : ""}${fmtInt(totalPnl)}원 · 실현 ${realized >= 0 ? "+" : ""}${fmtInt(realized)}원`,
        ].join("\n")
      : "";

  const msg = [
    `<b>가상 보유 포트폴리오</b>`,
    LINE,
    `오늘 액션 ${actionable}건 · 눌림 대기 ${pullback}건 · 관망 ${wait}건`,
    `주식 ${stockCount}건 · ETF ${etfCount}건`,
    "",
    ...lines,
    summaryLine,
    ...concentrationWarning ? [concentrationWarning] : [],
    walletSummary,
    "",
    `/가상매수 종목 [매수가] · /가상매도 종목`,
    `/보유수정 종목 매수가 [수량]`,
    `/자동매도점검 · /보유대응`,
    `/거래기록`,
  ].join("\n");

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: msg,
    parse_mode: "HTML",
  });
}

// ─── /가상매수 <종목> [매수가] ───────────
export async function handleWatchlistAdd(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const parts = (input || "").trim().split(/\s+/);
  const query = parts[0];
  const rawPrice = parts[1];

  if (!query) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "사용법: /가상매수 종목명 [매수가]\n예) /가상매수 삼성전자 72000",
    });
  }

  // 종목 수 제한 체크
  const { count } = await supabaseRead
    .from("watchlist")
    .select("id", { count: "exact", head: true })
    .eq("chat_id", ctx.chatId);

  if ((count ?? 0) >= MAX_ITEMS) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `보유 포트폴리오는 최대 ${MAX_ITEMS}개까지 등록할 수 있습니다.\n/가상매도 로 정리 후 추가해주세요.`,
    });
  }

  // 종목 검색
  const hits = await searchByNameOrCode(query, 1);
  if (!hits?.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "종목을 찾을 수 없습니다. 이름 또는 코드를 확인해주세요.",
    });
  }

  const { code, name } = hits[0];
  const explicitBuyPrice = rawPrice ? Number(rawPrice.replace(/,/g, "")) : null;

  const { data: existing } = await supabaseRead
    .from("watchlist")
    .select("id")
    .eq("chat_id", ctx.chatId)
    .eq("code", code)
    .maybeSingle();

  if (existing) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `${esc(name)} (${code})은 이미 보유 포트폴리오에 있습니다.\n/보유수정 ${name} 매수가 수량 으로 수정해주세요.`,
      parse_mode: "HTML",
    });
  }

  const realtimePrice = await fetchRealtimePrice(code);
  const buyPrice =
    toPositiveNumber(explicitBuyPrice) ??
    toPositiveNumber(realtimePrice);

  const tgId = ctx.from?.id ?? ctx.chatId;
  const alloc = await allocateVirtualBuy({
    chatId: ctx.chatId,
    tgId,
    code,
    buyPrice,
    currentHoldingCount: count ?? 0,
  });
  const quantity = alloc.quantity;
  const investedAmount = alloc.investedAmount;
  const walletNote = alloc.walletNote;

  // 중복 확인 & 업서트
  const { data: inserted, error } = await supabase
    .from("watchlist")
    .insert(
      {
        chat_id: ctx.chatId,
        code,
        buy_price: buyPrice,
        buy_date: new Date().toISOString().slice(0, 10),
        quantity,
        invested_amount: investedAmount,
      },
    )
    .select("id, created_at, buy_date")
    .single();

  if (error) {
    console.error("watchlist upsert error:", error);
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "가상 매수 처리 중 오류가 발생했습니다.",
    });
  }

  if (alloc.nextCash !== null) {
    await setUserInvestmentPrefs(tgId, {
      virtual_seed_capital: alloc.seedCapital ?? undefined,
      virtual_cash: alloc.nextCash,
      virtual_target_positions: alloc.targetPositions,
    });
  }

  let tradeLogId: number | null = null;
  if (quantity && investedAmount && buyPrice) {
    const tradeLog = await appendVirtualTradeLog({
      chatId: ctx.chatId,
      code,
      side: "BUY",
      price: buyPrice,
      quantity,
      grossAmount: investedAmount,
      netAmount: investedAmount,
      memo: buildStrategyMemo({
        strategyId: CORE_PLAN_STRATEGY_ID,
        event: "manual-buy",
        note: "watchlist-add",
      }),
    });
    tradeLogId = tradeLog.id ?? null;
  }

  if (quantity && investedAmount && buyPrice) {
    try {
      await replaceTradeLotsForHolding({
        chatId: ctx.chatId,
        watchlistId: Number((inserted as any)?.id ?? 0) || null,
        code,
        quantity,
        investedAmount,
        buyPrice,
        acquiredAt: String((inserted as any)?.created_at ?? "") || null,
        buyDate: String((inserted as any)?.buy_date ?? "") || null,
        note: "watchlist-add",
        sourceTradeId: tradeLogId,
      });
    } catch (lotError) {
      console.error("watchlist add lot sync error:", lotError);
    }
  }

  try {
    await syncVirtualPortfolio(ctx.chatId, tgId);
  } catch (syncError) {
    console.error("watchlist add sync error:", syncError);
  }

  const priceNote = buyPrice ? `  매수가 ${fmtInt(buyPrice)}원` : "";
  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: `${esc(name)} (${code}) 가상 매수 완료${priceNote}${walletNote}\n/보유 로 목록 확인\n/브리핑 에서 추천 후보와 함께 점검`,
    parse_mode: "HTML",
  });
}

// ─── /가상매도 <종목> ────────────────────
export async function handleWatchlistRemove(
  input: string,
  ctx: ChatContext,
  tgSend: any,
  options?: { sellMemo?: string; silentSuccess?: boolean; resolvedStock?: { code: string; name: string } }
): Promise<void> {
  const raw = (input || "").trim();
  const tokens = raw.split(/\s+/).filter(Boolean);
  const maybeQty = tokens.length >= 2 ? Number(tokens[tokens.length - 1].replace(/,/g, "")) : NaN;
  const hasQtyArg = Number.isFinite(maybeQty) && maybeQty > 0;
  const sellQtyRequested = hasQtyArg ? Math.floor(maybeQty) : null;
  const query = hasQtyArg ? tokens.slice(0, -1).join(" ") : raw;

  let code: string;
  let name: string;

  if (options?.resolvedStock) {
    // /전체매도 등 강제 일괄 처리 경로: 검색 없이 미리 확인된 코드/이름 사용
    code = options.resolvedStock.code;
    name = options.resolvedStock.name;
  } else {
    if (!query) {
      return tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "사용법: /가상매도 종목명 [수량]\n예) /가상매도 삼성전자 3",
      });
    }

    // 종목 검색
    const hits = await searchByNameOrCode(query, 1);
    if (!hits?.length) {
      return tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "종목을 찾을 수 없습니다.",
      });
    }
    code = hits[0].code;
    name = hits[0].name;
  }

  const { data: row, error: rowError } = await supabaseRead
    .from("watchlist")
    .select("id, code, buy_price, buy_date, created_at, quantity, invested_amount, stock:stocks(close)")
    .eq("chat_id", ctx.chatId)
    .eq("code", code)
    .maybeSingle();

  if (rowError) {
    console.error("watchlist fetch before delete error:", rowError);
  }

  const tgId = ctx.from?.id ?? ctx.chatId;
  const prefs = await getUserInvestmentPrefs(tgId);
  const watchlistId = Number((row as any)?.id ?? 0) || null;
  const qty = Math.max(0, Math.floor(Number((row as any)?.quantity ?? 0)));
  const buyPrice = Number((row as any)?.buy_price ?? 0);
  const invested = toPositiveNumber((row as any)?.invested_amount) ?? (qty > 0 && buyPrice > 0 ? qty * buyPrice : 0);
  const holdingCreatedAt = String((row as any)?.created_at ?? "") || null;
  const holdingBuyDate = String((row as any)?.buy_date ?? "") || null;

  if (sellQtyRequested !== null && qty > 0 && sellQtyRequested > qty) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `${esc(name)} (${code}) 보유수량은 ${qty}주입니다.\n/가상매도 ${name} ${qty} 처럼 입력해주세요.`,
      parse_mode: "HTML",
    });
  }

  const sellQty = qty > 0 ? (sellQtyRequested ?? qty) : 0;

  if (qty > 0 && sellQty <= 0) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "매도 수량은 1주 이상이어야 합니다.",
    });
  }

  const isFullExit = qty <= 0 || sellQty >= qty;
  const remainQty = Math.max(0, qty - sellQty);
  let fifoCost = Math.round(((invested > 0 && qty > 0 ? invested / qty : buyPrice) || 0) * sellQty);
  let remainInvested = Math.max(0, invested - fifoCost);
  let nextBuyPrice: number | null = remainQty > 0 && remainInvested > 0
    ? Number((remainInvested / remainQty).toFixed(4))
    : null;

  if (qty > 0 && sellQty > 0) {
    try {
      await ensureTradeLotsForHolding({
        chatId: ctx.chatId,
        watchlistId,
        code,
        quantity: qty,
        investedAmount: invested,
        buyPrice,
        acquiredAt: holdingCreatedAt,
        buyDate: holdingBuyDate,
      });
      const fifoPreview = await previewFifoSale({
        chatId: ctx.chatId,
        code,
        quantity: sellQty,
      });
      fifoCost = fifoPreview.totalCost;
      remainInvested = Math.max(0, invested - fifoCost);
      nextBuyPrice = remainQty > 0 && remainInvested > 0
        ? Number((remainInvested / remainQty).toFixed(4))
        : null;
    } catch (fifoError) {
      console.error("watchlist FIFO preview error:", fifoError);
      // FIFO 계산 실패 시에도 매도 자체는 계속 진행하고, 기본 원가 추정값을 사용한다.
    }
  }

  let dbError: any = null;
  let affectedCount = 0;

  if (qty > 0 && !isFullExit) {
    const { error: updateError, count: updateCount } = await supabase
      .from("watchlist")
      .update({
        quantity: remainQty,
        buy_price: nextBuyPrice,
        invested_amount: remainInvested,
        status: "holding",
      }, { count: "exact" })
      .eq("chat_id", ctx.chatId)
      .eq("code", code);
    dbError = updateError;
    affectedCount = updateCount ?? 0;
  } else {
    const { error: deleteError, count: deleteCount } = await supabase
      .from("watchlist")
      .delete({ count: "exact" })
      .eq("chat_id", ctx.chatId)
      .eq("code", code);
    dbError = deleteError;
    affectedCount = deleteCount ?? 0;
  }

  if (dbError) {
    console.error("watchlist sell/delete error:", dbError);
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "가상 매도 처리 중 오류가 발생했습니다.",
    });
  }

  if (!affectedCount) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `${esc(name)} (${code})은 보유 포트폴리오에 없습니다.`,
      parse_mode: "HTML",
    });
  }

  if (qty > 0 && invested > 0 && sellQty > 0) {
    const rt = await fetchRealtimePrice(code);
    const fallbackClose = Number(((row as any)?.stock as any)?.close ?? 0);
    const exitPrice = toPositiveNumber(rt) ?? toPositiveNumber(fallbackClose) ?? buyPrice;

    const feeRate = toPositiveNumber(prefs.virtual_fee_rate) ?? DEFAULT_FEE_RATE;
    const taxRate = toPositiveNumber(prefs.virtual_tax_rate) ?? DEFAULT_TAX_RATE;
    const gross = sellQty * exitPrice;
    const feeAmount = Math.round(gross * feeRate);
    const taxAmount = Math.round(gross * taxRate);
    const net = Math.max(0, gross - feeAmount - taxAmount);
    const soldCost = fifoCost;
    const pnl = net - soldCost;

    const baseCash = toPositiveNumber(prefs.virtual_cash) ?? (toPositiveNumber(prefs.virtual_seed_capital) ?? toPositiveNumber(prefs.capital_krw) ?? 0);
    const baseRealized = Number(prefs.virtual_realized_pnl ?? 0);
    const nextCash = baseCash + net;
    const nextRealized = baseRealized + pnl;

    await setUserInvestmentPrefs(tgId, {
      virtual_seed_capital:
        toPositiveNumber(prefs.virtual_seed_capital) ??
        toPositiveNumber(prefs.capital_krw) ??
        0,
      virtual_cash: nextCash,
      virtual_realized_pnl: nextRealized,
      virtual_fee_rate: feeRate,
      virtual_tax_rate: taxRate,
      virtual_target_positions:
        Math.max(1, Math.floor(toPositiveNumber(prefs.virtual_target_positions) ?? DEFAULT_TARGET_POSITIONS)),
    });

    const tradeLog = await appendVirtualTradeLog({
      chatId: ctx.chatId,
      code,
      side: "SELL",
      price: exitPrice,
      quantity: sellQty,
      grossAmount: gross,
      netAmount: net,
      feeAmount,
      taxAmount,
      pnlAmount: pnl,
      memo: buildStrategyMemo({
        strategyId: CORE_PLAN_STRATEGY_ID,
        event: isFullExit ? "manual-full-exit" : "manual-partial-exit",
        note:
          options?.sellMemo ??
          (isFullExit ? "watchlist-full-exit" : "watchlist-partial-exit"),
      }),
    });

    try {
      const fifoPreview = await previewFifoSale({
        chatId: ctx.chatId,
        code,
        quantity: sellQty,
      });
      await applyFifoSale({
        chatId: ctx.chatId,
        code,
        exitPrice,
        tradeId: tradeLog.id ?? null,
        allocations: fifoPreview.allocations,
      });
    } catch (lotError) {
      console.error("watchlist FIFO apply error:", lotError);
      try {
        await replaceTradeLotsForHolding({
          chatId: ctx.chatId,
          watchlistId: isFullExit ? null : watchlistId,
          code,
          quantity: remainQty,
          investedAmount: isFullExit ? 0 : remainInvested,
          buyPrice: isFullExit ? null : nextBuyPrice,
          acquiredAt: holdingCreatedAt,
          buyDate: holdingBuyDate,
          note: "watchlist-fifo-rebuilt-after-sell",
        });
      } catch (rebuildError) {
        console.error("watchlist FIFO rebuild error:", rebuildError);
      }
    }

    try {
      await syncVirtualPortfolio(ctx.chatId, tgId);
    } catch (syncError) {
      console.error("watchlist sell sync error:", syncError);
    }

    if (!options?.silentSuccess) {
      const remainQtyNote = qty - sellQty;
      return tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: isFullExit
          ? `${esc(name)} (${code}) ${sellQty}주 가상 매도 완료 후 보유 포트폴리오에서 제거되었습니다.\n정산금 ${fmtInt(net)}원 · 실현손익 ${pnl >= 0 ? "+" : ""}${fmtInt(pnl)}원\n/거래기록 으로 가상 거래 내역 확인`
          : `${esc(name)} (${code}) ${sellQty}주 부분 가상 매도 완료 (잔여 ${remainQtyNote}주)\n정산금 ${fmtInt(net)}원 · 실현손익 ${pnl >= 0 ? "+" : ""}${fmtInt(pnl)}원\n/보유 로 잔여 포지션 확인`,
        parse_mode: "HTML",
      });
    }
    return;
  }

  try {
    await syncVirtualPortfolio(ctx.chatId, tgId);
  } catch (syncError) {
    console.error("watchlist delete sync error:", syncError);
  }

  if (!options?.silentSuccess) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `${esc(name)} (${code}) 보유 포트폴리오에서 제거 완료\n/보유 로 목록 확인\n/거래기록 으로 가상 거래 내역 확인`,
      parse_mode: "HTML",
    });
  }
}

// ─── /전체매도 [확인] (보유 포지션 일괄 정리) ───
export async function handleWatchlistLiquidateAllCommand(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const token = String(input || "").trim().toLowerCase();
  const confirmed = ["확인", "yes", "y", "run", "실행"].includes(token);

  if (!confirmed) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        "<b>전체매도 안내</b>",
        LINE,
        "보유 포트폴리오(가상매수 체결 종목)만 전량 매도합니다.",
        "관심만 등록된 미체결 종목은 유지됩니다.",
        "",
        "실행: <code>/전체매도 확인</code>",
      ].join("\n"),
      parse_mode: "HTML",
    });
  }

  const { data: rows, error } = await supabaseRead
    .from("watchlist")
    .select("code, quantity, buy_price, stock:stocks(name)")
    .eq("chat_id", ctx.chatId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("watchlist liquidate-all query error:", error);
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "전체매도 조회 중 오류가 발생했습니다.",
    });
  }

  const allRows = (rows ?? []) as any[];
  const holdings = allRows
    .map((row: any) => ({
      code: String(row.code ?? ""),
      quantity: Math.max(0, Math.floor(Number(row.quantity ?? 0))),
      buyPrice: Number(row.buy_price ?? 0),
      name: String((Array.isArray(row.stock) ? row.stock[0] : row.stock)?.name ?? row.code ?? ""),
    }))
    .filter((row) => row.code && row.quantity > 0);

  if (!holdings.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "전량 매도할 보유 포지션이 없습니다.\n/관심 은 유지되고 /보유 만 비어 있는 상태입니다.",
    });
  }

  const watchOnlyCount = Math.max(0, allRows.length - holdings.length);
  const liquidateStartedAt = new Date().toISOString();

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: [
      "<b>전체매도 실행</b>",
      LINE,
      `보유 전량 대상 ${holdings.length}종목 매도 처리 시작`,
      watchOnlyCount > 0 ? `관심-only ${watchOnlyCount}종목은 유지` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    parse_mode: "HTML",
  });

  for (const holding of holdings) {
    try {
      await handleWatchlistRemove(
        `${holding.code} ${holding.quantity}`,
        ctx,
        tgSend,
        {
          sellMemo: "watchlist-liquidation-all (수동일괄)",
          silentSuccess: true,
          resolvedStock: { code: holding.code, name: holding.name },
        }
      );
    } catch (e) {
      console.error("watchlist liquidate-all sell error:", holding.code, e);
    }
  }

  const holdingMap = new Map(
    holdings.map((h) => [h.code, h] as const)
  );

  const { data: soldRows, error: soldRowsError } = await supabaseRead
    .from("virtual_trades")
    .select("code, quantity, pnl_amount")
    .eq("chat_id", ctx.chatId)
    .eq("side", "SELL")
    .gte("traded_at", liquidateStartedAt)
    .like("memo", "%watchlist-liquidation-all%")
    .order("traded_at", { ascending: true });

  if (soldRowsError) {
    console.error("watchlist liquidate-all verify query error:", soldRowsError);
  }

  const soldByCode = new Map<string, { quantity: number; pnl: number }>();
  for (const row of soldRows ?? []) {
    const code = String((row as any).code ?? "");
    if (!code) continue;
    const prev = soldByCode.get(code) ?? { quantity: 0, pnl: 0 };
    soldByCode.set(code, {
      quantity: prev.quantity + Math.max(0, Math.floor(Number((row as any).quantity ?? 0))),
      pnl: prev.pnl + Number((row as any).pnl_amount ?? 0),
    });
  }

  const success = soldByCode.size;
  const failedHoldings = holdings.filter((h) => !soldByCode.has(h.code));
  const failed = failedHoldings.length;
  const totalPnl = Array.from(soldByCode.values()).reduce((acc, cur) => acc + cur.pnl, 0);
  const resultLines = Array.from(soldByCode.entries())
    .slice(0, 12)
    .map(([code, sold]) => {
      const base = holdingMap.get(code);
      const name = base?.name ?? code;
      const pnlSign = sold.pnl >= 0 ? "+" : "";
      return `- ${esc(name)} (${code}) ${sold.quantity}주 · 실현 ${pnlSign}${fmtInt(sold.pnl)}원`;
    });
  const resultMore = soldByCode.size > resultLines.length
    ? `외 ${soldByCode.size - resultLines.length}종목`
    : "";

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: [
      "<b>전체매도 완료</b>",
      LINE,
      `대상 ${holdings.length}종목 · 체결 ${success}종목 · 미체결 ${failed}종목`,
      `일괄매도 실현손익 ${totalPnl >= 0 ? "+" : ""}${fmtInt(totalPnl)}원`,
      watchOnlyCount > 0 ? `관심-only ${watchOnlyCount}종목은 유지` : "",
      "",
      resultLines.length ? "체결 내역" : "",
      ...resultLines,
      resultMore,
      failedHoldings.length
        ? `미체결 종목: ${failedHoldings.map((h) => `${h.name}(${h.code})`).join(", ")}`
        : "",
      "",
      "다음 권장 순서",
      "1) /거래기록 7 로 실현손익 확인",
      "2) /보유 로 잔여 포지션 확인",
      "3) /자동사이클 실행 daily 로 새 기준 시작",
    ]
      .filter(Boolean)
      .join("\n"),
    parse_mode: "HTML",
  });
}

// ─── /자동매도점검 (기계적 자동 판정·기록) ───
export async function handleWatchlistAutoCommand(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const { data: items, error } = await supabaseRead
    .from("watchlist")
    .select(
      `
      code, buy_price, quantity,
      stock:stocks!inner ( name, close, rsi14 )
    `
    )
    .eq("chat_id", ctx.chatId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("watchlist auto query error:", error);
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "자동 매도 점검 중 오류가 발생했습니다.",
    });
  }

  if (!items || items.length === 0) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "보유 종목이 없어 자동 점검할 항목이 없습니다.\n/가상매수 후 다시 실행해주세요.",
    });
  }

  const codes = items.map((it: any) => it.code);
  const [realtimeMap, microByCode, scoreResult] = await Promise.all([
    fetchRealtimePriceBatch(codes),
    fetchWatchMicroSignalsByCodes(supabaseRead, codes),
    fetchLatestScoresByCodes(supabaseRead, codes).catch(() => null),
  ]);

  const holdLines: string[] = [];
  const sellTargets: Array<{
    name: string;
    code: string;
    qty: number;
    reason: string;
    action: ResponseAction;
    pnlPct: number;
    triggers: string[];
    confidence: number;
  }> = [];

  for (const item of items) {
    const stock = item.stock as any;
    const code = String(item.code);
    const name = String(stock?.name ?? code);
    const buyPrice = Number(item.buy_price ?? 0);
    const qty = Math.max(0, Math.floor(Number(item.quantity ?? 0)));
    if (qty <= 0 || buyPrice <= 0) continue;

    const dbClose = Number(stock?.close ?? 0);
    const rt = realtimeMap[code];
    const close = toPositiveNumber(rt?.price) ?? dbClose;
    if (close <= 0) {
      holdLines.push(
        [
          `- <b>${esc(name)}</b> (${code}) · 보유 유지`,
          "  → 사유: 데이터 부족",
        ].join("\n")
      );
      continue;
    }

    const plan = buildPlanFromScoreSnapshot({
      currentPrice: close,
      baselinePrice: dbClose,
      stockRsi: stock?.rsi14 ?? undefined,
      scoreRow: scoreResult?.byCode.get(code),
    });
    const decision = resolveWatchDecision({
      close,
      buyPrice,
      plan,
      microSignal: microByCode.get(code),
    });

    if (decision.action === "HOLD") {
      holdLines.push(
        [
          `- <b>${esc(name)}</b> (${code}) · 보유 유지`,
          `  → 손익: ${fmtPct(decision.pnlPct)}`,
          `  → 판단: ${decision.reason}`,
          `  → 트리거: ${decision.triggerReasons.length ? decision.triggerReasons.join(", ") : "대기"}`,
        ].join("\n")
      );
      continue;
    }

    sellTargets.push({
      name,
      code,
      qty,
      reason: decision.reason,
      action: decision.action,
      pnlPct: decision.pnlPct,
      triggers: decision.triggerReasons,
      confidence: decision.confidence,
    });
  }

  let executed = 0;
  const executedLines: string[] = [];
  for (const target of sellTargets) {
    await handleWatchlistRemove(
      `${target.code} ${target.qty}`,
      ctx,
      tgSend,
      {
        sellMemo:
          target.action === "TAKE_PROFIT"
            ? "watchlist-auto-take-profit (자동)"
            : "watchlist-auto-stop-loss (자동)",
      }
    );
    executed += 1;
    executedLines.push(
      [
        `- <b>${esc(target.name)}</b> (${target.code}) · 자동매도`,
        `  → 사유: ${target.reason}`,
        `  → 손익: ${fmtPct(target.pnlPct)} · 신뢰도 ${target.confidence}%`,
        `  → 트리거: ${target.triggers.length ? target.triggers.join(", ") : "대기"}`,
      ].join("\n")
    );
  }

  // 2-1: 일손실 한도 체크 — 신규 매수 진입 억제 상태 안내
  let dailyLossGateNote = "";
  try {
    const DEFAULT_DAILY_LOSS_LIMIT_PCT = 5;
    const prefs = await getUserInvestmentPrefs(ctx.from?.id ?? ctx.chatId);
    const riskBaseCapital = Number(prefs.virtual_seed_capital ?? prefs.capital_krw ?? 0);
    const dailyLossLimitPct = Number(prefs.daily_loss_limit_pct ?? DEFAULT_DAILY_LOSS_LIMIT_PCT);
    const dailyLossLimitAmount = riskBaseCapital > 0 && dailyLossLimitPct > 0
      ? (riskBaseCapital * dailyLossLimitPct) / 100 : 0;
    if (dailyLossLimitAmount > 0) {
      const dayMs = 24 * 60 * 60 * 1000;
      const kstOffsetMs = 9 * 60 * 60 * 1000;
      const kstNowMs = Date.now() + kstOffsetMs;
      const kstStartMs = Math.floor(kstNowMs / dayMs) * dayMs;
      const utcStartIso = new Date(kstStartMs - kstOffsetMs).toISOString();
      const utcEndIso = new Date(kstStartMs - kstOffsetMs + dayMs).toISOString();
      const { data: tradeRows } = await supabaseRead
        .from("virtual_trades")
        .select("pnl_amount")
        .eq("chat_id", ctx.chatId)
        .gte("traded_at", utcStartIso)
        .lt("traded_at", utcEndIso);
      const dailyPnl = (tradeRows ?? []).reduce((sum: number, row: any) => {
        const pnl = Number(row?.pnl_amount ?? 0);
        return Number.isFinite(pnl) ? sum + pnl : sum;
      }, 0);
      if (dailyPnl <= -dailyLossLimitAmount) {
        dailyLossGateNote = `\n⛔ 오늘 일손실 한도 도달 — 신규 매수 진입 자제 권고\n  실현손익 ${fmtInt(dailyPnl)}원 / 한도 -${fmtInt(dailyLossLimitAmount)}원`;
      }
    }
  } catch {
    // 일손실 체크 실패는 자동매매를 차단하지 않음
  }

  const msg = [
    "<b>자동매도점검 결과</b>",
    LINE,
    `실행 시점 ${isKstMarketOpen() ? "장중" : "장마감/비개장"} 기준`,
    `자동매도 ${executed}건 · 보유유지 ${holdLines.length}건`,
    "",
    "<b>자동매도</b>",
    ...(executedLines.length ? executedLines : ["- 조건 충족 종목이 없습니다."]),
    "",
    "<b>보유 유지</b>",
    ...(holdLines.length ? holdLines : ["- 해당 종목이 없습니다."]),
    "",
    "자동 실행 건은 /거래기록 에 (자동)으로 남습니다.",
    ...(dailyLossGateNote ? [dailyLossGateNote] : []),
  ].join("\n");

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: msg,
    parse_mode: "HTML",
  });
}

// ─── /보유대응 (익일 액션 플랜) ───────────
export async function handleWatchlistResponseCommand(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const { data: items, error } = await supabaseRead
    .from("watchlist")
    .select(
      `
      code, buy_price, buy_date, quantity, created_at,
      stock:stocks!inner ( name, close, rsi14 )
    `
    )
    .eq("chat_id", ctx.chatId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("watchlist response query error:", error);
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "보유 대응 플랜 생성 중 오류가 발생했습니다.",
    });
  }

  if (!items || items.length === 0) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "보유 종목이 없어 대응 계획을 만들 수 없습니다.\n/가상매수 후 다시 실행해주세요.",
    });
  }

  const marketOpen = isKstMarketOpen();
  const lines: string[] = [];
  const codes = items.map((it: any) => String(it.code));
  const [microByCode, scoreResult] = await Promise.all([
    fetchWatchMicroSignalsByCodes(supabaseRead, codes),
    fetchLatestScoresByCodes(supabaseRead, codes).catch(() => null),
  ]);

  for (const item of items) {
    const stock = item.stock as any;
    const code = String(item.code);
    const name = String(stock?.name ?? code);
    const close = Number(stock?.close ?? 0);
    const buyPrice = Number(item.buy_price ?? 0);
    const qty = Math.max(0, Math.floor(Number(item.quantity ?? 0)));
    if (qty <= 0 || close <= 0 || buyPrice <= 0) continue;

    const plan = buildPlanFromScoreSnapshot({
      currentPrice: close,
      baselinePrice: close,
      stockRsi: stock?.rsi14 ?? undefined,
      scoreRow: scoreResult?.byCode.get(code),
    });
    const acquiredAt: string | null = (item as any).buy_date ?? (item as any).created_at ?? null;
    const elapsedTradingDays = estimateElapsedTradingDays(acquiredAt);
    const decision = resolveWatchDecision({
      close,
      buyPrice,
      plan,
      microSignal: microByCode.get(code),
    });
    const microSignal = microByCode.get(code);
    const recommended =
      decision.action === "TAKE_PROFIT"
        ? "익절 고려"
        : decision.action === "STOP_LOSS"
          ? "손절 우선"
          : "보유 관찰";

    const reentryWatch =
      decision.action === "HOLD" &&
      plan.status === "buy-now" &&
      decision.pnlPct <= -3 &&
      Boolean(microSignal?.valueAnomaly || microSignal?.flowShift)
        ? "  재진입 감시: 손실권이지만 수급/거래대금 트리거가 회복돼 1회 분할 재진입 후보입니다."
        : null;

    // 2-3: 손절 미이행 경고
    const blockedStopLossLines: string[] = [];
    if (decision.blockedStopLoss) {
      blockedStopLossLines.push("  ⚠️ <b>손절 미이행 주의</b> — 손절 조건 충족이지만 트리거 미충족으로 억제됨");
      if (elapsedTradingDays >= 3) {
        blockedStopLossLines.push(`  🔴 장기 미이행 (약 ${elapsedTradingDays}거래일) — 즉시 점검 권고`);
      }
    }

    const maturityWarningLine = elapsedTradingDays > plan.holdDays[1]
      ? `  ⏰ 보유기간 상한(${plan.holdDays[1]}거래일) 초과 — 익절·손절 여부 재판단 권고 (현재 약 ${elapsedTradingDays}거래일)`
      : null;

    lines.push(
      [
        `- <b>${esc(name)}</b> (${code}) · ${qty}주`,
        `  기준가 ${fmtInt(close)}원 · 손익 ${fmtPct(decision.pnlPct)}`,
        `  계획 진입 ${fmtInt(plan.entryLow)}~${fmtInt(plan.entryHigh)}원`,
        `  손절 ${fmtInt(plan.stopPrice)}원 · 1차목표 ${fmtInt(plan.target1)}원`,
        `  내일 대응: ${recommended} (${decision.reason})`,
        `  트리거: ${decision.triggerReasons.length ? decision.triggerReasons.join(", ") : "대기"} · 신뢰도 ${decision.confidence}%`,
        ...(maturityWarningLine ? [maturityWarningLine] : []),
        ...(reentryWatch ? [reentryWatch] : []),
        ...blockedStopLossLines,
      ].join("\n")
    );
  }

  if (!lines.length) {
    lines.push("- 보유 수량/매수가가 없는 항목만 있어 대응안을 생성하지 못했습니다.");
  }

  const msg = [
    "<b>보유대응 플랜</b>",
    LINE,
    marketOpen
      ? "장중 조회: 현재 종가 기반 참고 플랜입니다."
      : "장마감 이후: 최신 종가 기준 내일 대응안입니다.",
    "실제 매매/기록은 하지 않습니다.",
    "",
    ...lines,
  ].join("\n");

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: msg,
    parse_mode: "HTML",
  });
}

// ─── /보유수정 <종목> <매수가> ────────────
export async function handleWatchlistEdit(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const parts = (input || "").trim().split(/\s+/);
  const query = parts[0];
  const rawPrice = parts[1];
  const rawQty = parts[2];

  if (!query || !rawPrice) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "사용법: /보유수정 종목명 매수가 [수량]\n예) /보유수정 삼성전자 72000 5",
    });
  }

  const hits = await searchByNameOrCode(query, 1);
  if (!hits?.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "종목을 찾을 수 없습니다.",
    });
  }

  const { code, name } = hits[0];
  const newPrice = Number(rawPrice.replace(/,/g, ""));

  if (!Number.isFinite(newPrice) || newPrice <= 0) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "유효한 매수가를 입력해주세요.\n예) /보유수정 삼성전자 72000 5",
    });
  }

  const parsedQtyValue = rawQty ? Number(rawQty.replace(/,/g, "")) : null;
  if (rawQty && (!Number.isFinite(parsedQtyValue) || (parsedQtyValue ?? 0) <= 0)) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "수량은 1주 이상 정수로 입력해주세요.\n예) /보유수정 삼성전자 72000 5",
    });
  }

  // 기존 관심종목인지 확인
  const { data: existing } = await supabaseRead
    .from("watchlist")
    .select("id, quantity, buy_price, invested_amount, buy_date, created_at")
    .eq("chat_id", ctx.chatId)
    .eq("code", code)
    .single();

  if (!existing) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `${esc(name)} (${code})은 보유 포트폴리오에 없습니다.\n/가상매수 로 먼저 추가해주세요.`,
      parse_mode: "HTML",
    });
  }

  const previous = normalizeWatchlistHolding({
    id: Number((existing as any).id),
    quantity: (existing as any).quantity,
    buyPrice: (existing as any).buy_price,
    investedAmount: (existing as any).invested_amount,
  });
  const nextQty = rawQty ? Math.floor(parsedQtyValue ?? 0) : Math.max(previous.quantity, 1);
  const nextInvested = Math.round(nextQty * newPrice);

  const { error } = await supabase
    .from("watchlist")
    .update({
      buy_price: newPrice,
      quantity: nextQty,
      invested_amount: nextInvested,
      status: "holding",
    })
    .eq("chat_id", ctx.chatId)
    .eq("code", code);

  if (error) {
    console.error("watchlist edit error:", error);
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "매수가 수정 중 오류가 발생했습니다.",
    });
  }

  const tradeLog = await appendVirtualTradeLog({
    chatId: ctx.chatId,
    code,
    side: "ADJUST",
    price: newPrice,
    quantity: nextQty,
    grossAmount: nextInvested,
    netAmount: nextInvested,
    memo: buildAdjustmentMemo({
      prevPrice: previous.buyPrice,
      nextPrice: newPrice,
      prevQty: previous.quantity,
      nextQty,
    }),
  });

  try {
    await replaceTradeLotsForHolding({
      chatId: ctx.chatId,
      watchlistId: Number((existing as any).id ?? 0) || null,
      code,
      quantity: nextQty,
      investedAmount: nextInvested,
      buyPrice: newPrice,
      acquiredAt: String((existing as any).created_at ?? "") || null,
      buyDate: String((existing as any).buy_date ?? "") || null,
      note: "watchlist-adjust-reset",
      sourceTradeId: tradeLog.id ?? null,
    });
  } catch (lotError) {
    console.error("watchlist edit lot sync error:", lotError);
  }

  const tgId = ctx.from?.id ?? ctx.chatId;
  let syncedCash: number | null = null;
  try {
    const synced = await syncVirtualPortfolio(ctx.chatId, tgId);
    syncedCash = synced.cashBalance;
  } catch (syncError) {
    console.error("watchlist edit sync error:", syncError);
  }

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: [
      `${esc(name)} (${code}) 수정 완료`,
      `매수가 <code>${fmtInt(previous.buyPrice ?? 0)}원</code> → <code>${fmtInt(newPrice)}원</code>`,
      `수량 <code>${previous.quantity}주</code> → <code>${nextQty}주</code>`,
      `원금 <code>${fmtInt(nextInvested)}원</code>${syncedCash !== null ? ` · 잔액 <code>${fmtInt(syncedCash)}원</code>` : ""}`,
      tradeLog.ok
        ? `/보유 · /거래기록 으로 확인`
        : `/보유 는 반영됐지만 거래 기록 저장은 실패했습니다.`,
    ].join("\n"),
    parse_mode: "HTML",
  });
}

// ─── 가상매수 Quick (콜백 버튼에서 사용) ──
export async function handleWatchlistQuickAdd(
  code: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  // 실시간 가격으로 매수가 자동 설정
  const price = await fetchRealtimePrice(code);

  const { data: stockRow } = await supabaseRead
    .from("stocks")
    .select("name")
    .eq("code", code)
    .single();
  const name = stockRow?.name || code;

  const { data: existing } = await supabaseRead
    .from("watchlist")
    .select("id")
    .eq("chat_id", ctx.chatId)
    .eq("code", code)
    .maybeSingle();

  if (existing) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `${esc(name)} (${code})은 이미 보유 포트폴리오에 있습니다.`,
      parse_mode: "HTML",
    });
  }

  // 종목 수 제한 체크
  const { count } = await supabaseRead
    .from("watchlist")
    .select("id", { count: "exact", head: true })
    .eq("chat_id", ctx.chatId);

  if ((count ?? 0) >= MAX_ITEMS) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `보유 포트폴리오는 최대 ${MAX_ITEMS}개까지 등록할 수 있습니다.\n/가상매도 로 정리 후 추가해주세요.`,
    });
  }

  const tgId = ctx.from?.id ?? ctx.chatId;
  const alloc = await allocateVirtualBuy({
    chatId: ctx.chatId,
    tgId,
    code,
    buyPrice: toPositiveNumber(price),
    currentHoldingCount: count ?? 0,
  });

  const { data: inserted, error } = await supabase
    .from("watchlist")
    .insert({
      chat_id: ctx.chatId,
      code,
      buy_price: price && Number.isFinite(price) ? price : null,
      buy_date: new Date().toISOString().slice(0, 10),
      quantity: alloc.quantity,
      invested_amount: alloc.investedAmount,
    });
    
  const insertedRow = !error
    ? await supabase
      .from("watchlist")
      .select("id, created_at, buy_date")
      .eq("chat_id", ctx.chatId)
      .eq("code", code)
      .single()
    : null;

  if (error) {
    console.error("watchlist quick-add error:", error);
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "가상 매수 처리 중 오류가 발생했습니다.",
    });
  }

  if (alloc.nextCash !== null) {
    await setUserInvestmentPrefs(tgId, {
      virtual_seed_capital: alloc.seedCapital ?? undefined,
      virtual_cash: alloc.nextCash,
      virtual_target_positions: alloc.targetPositions,
    });
  }

  let tradeLogId: number | null = null;
  if (alloc.quantity && alloc.investedAmount && price) {
    const tradeLog = await appendVirtualTradeLog({
      chatId: ctx.chatId,
      code,
      side: "BUY",
      price,
      quantity: alloc.quantity,
      grossAmount: alloc.investedAmount,
      netAmount: alloc.investedAmount,
      memo: "watchlist-quick-add",
    });
    tradeLogId = tradeLog.id ?? null;
  }

  if (alloc.quantity && alloc.investedAmount && price) {
    try {
      await replaceTradeLotsForHolding({
        chatId: ctx.chatId,
        watchlistId: Number((insertedRow?.data as any)?.id ?? 0) || null,
        code,
        quantity: alloc.quantity,
        investedAmount: alloc.investedAmount,
        buyPrice: price,
        acquiredAt: String((insertedRow?.data as any)?.created_at ?? "") || null,
        buyDate: String((insertedRow?.data as any)?.buy_date ?? "") || null,
        note: "watchlist-quick-add",
        sourceTradeId: tradeLogId,
      });
    } catch (lotError) {
      console.error("watchlist quick-add lot sync error:", lotError);
    }
  }

  try {
    await syncVirtualPortfolio(ctx.chatId, tgId);
  } catch (syncError) {
    console.error("watchlist quick-add sync error:", syncError);
  }

  const priceNote = price ? `  매수가 ${fmtInt(price)}원 (현재가 자동저장)` : "";
  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: `${esc(name)} (${code}) 가상 매수 완료${priceNote}${alloc.walletNote}\n/보유 로 목록 확인\n/브리핑 에서 함께 점검\n/보유수정 ${name} 가격 수량 — 매수가/수량 변경`,
    parse_mode: "HTML",
  });
}

// ─── /거래기록 (가상 매매 내역) ───────────
export async function handleWatchlistHistoryCommand(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const raw = (input || "").trim();
  const parsedDays = Number(raw);
  const days = Number.isFinite(parsedDays) && parsedDays > 0 ? Math.floor(parsedDays) : null;
  const maxDays = days ? Math.min(days, 365) : null;
  const sinceIso = maxDays
    ? new Date(Date.now() - maxDays * 24 * 60 * 60 * 1000).toISOString()
    : null;

  let query = supabaseRead
    .from("virtual_trades")
    .select("id, code, side, price, quantity, gross_amount, net_amount, fee_amount, tax_amount, pnl_amount, memo, traded_at, stock:stocks(name)")
    .eq("chat_id", ctx.chatId)
    .order("traded_at", { ascending: false })
    .limit(30);

  if (sinceIso) {
    query = query.gte("traded_at", sinceIso);
  }

  const { data: rows, error } = await query;

  if (error) {
    console.error("virtual_trades query error:", error);
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "거래 기록 조회 중 오류가 발생했습니다.",
    });
  }

  const tgId = ctx.from?.id ?? ctx.chatId;
  const prefs = await getUserInvestmentPrefs(tgId);
  const cash = Number(prefs.virtual_cash ?? 0);
  const realized = Number(prefs.virtual_realized_pnl ?? 0);

  const tradeIds = (rows ?? [])
    .map((row: any) => Number(row.id ?? 0))
    .filter((id: number) => Number.isFinite(id) && id > 0);
  const lotMatchMap = new Map<number, Array<{ quantity: number; unitCost: number }>>();

  if (tradeIds.length) {
    const { data: lotMatches, error: lotMatchError } = await supabaseRead
      .from("virtual_trade_lot_matches")
      .select("trade_id, quantity, unit_cost")
      .in("trade_id", tradeIds);

    if (lotMatchError) {
      console.error("virtual_trade_lot_matches query error:", lotMatchError);
    } else {
      for (const row of lotMatches ?? []) {
        const tradeId = Number((row as any).trade_id ?? 0);
        if (!tradeId) continue;
        const current = lotMatchMap.get(tradeId) ?? [];
        current.push({
          quantity: Math.max(0, Math.floor(Number((row as any).quantity ?? 0))),
          unitCost: Number((row as any).unit_cost ?? 0),
        });
        lotMatchMap.set(tradeId, current);
      }
    }
  }

  if (!rows || rows.length === 0) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        "<b>가상 매매 기록</b>",
        LINE,
        "아직 기록이 없습니다.",
        maxDays ? `최근 ${maxDays}일 내 기록이 없습니다.` : "/가상매수 로 가상 매수를 시작해보세요.",
      ].join("\n"),
      parse_mode: "HTML",
    });
  }

  const lines = rows.map((r: any, idx: number) => {
    const d = formatShortDate(r.traded_at as string | null | undefined);
    const sideValue = String(r.side ?? "").toUpperCase();
    const side = sideValue === "SELL" ? "매도" : sideValue === "ADJUST" ? "수정" : "매수";
    const qty = Math.max(0, Math.floor(Number(r.quantity ?? 0)));
    const price = Number(r.price ?? 0);
    const stockName = String((Array.isArray((r as any).stock) ? (r as any).stock[0] : (r as any).stock)?.name ?? "").trim();
    const codeLabel = stockName ? `${esc(stockName)} ${r.code}` : String(r.code ?? "");
    const base = `${idx + 1}. (${d}) ${side} ${codeLabel} ${qty}주 @ ${fmtInt(price)}원`;
    const autoTag = String(r.memo ?? "").includes("(자동)") ? " (자동)" : "";

    if (sideValue === "ADJUST") {
      const parsed = parseAdjustmentMemo(r.memo as string | null | undefined);
      if (parsed) {
        const prevPrice = parsed.prevPrice ?? Number(r.price ?? 0);
        const nextPrice = parsed.nextPrice ?? Number(r.price ?? 0);
        const prevQty = parsed.prevQty ?? Math.max(0, Math.floor(Number(r.quantity ?? 0)));
        const nextQty = parsed.nextQty ?? Math.max(0, Math.floor(Number(r.quantity ?? 0)));
        return `${idx + 1}. (${d}) 수정 ${codeLabel}${autoTag}\n    매수가 ${fmtInt(prevPrice)}원 → ${fmtInt(nextPrice)}원 · 수량 ${prevQty}주 → ${nextQty}주`;
      }
      const gross = Number(r.gross_amount ?? 0);
      return `${idx + 1}. (${d}) 수정 ${codeLabel}${autoTag}\n    현재 기준 ${fmtInt(price)}원 · ${qty}주 · 보유원금 ${fmtInt(gross)}원`;
    }

    if (sideValue === "SELL") {
      const pnl = Number(r.pnl_amount ?? 0);
      const fee = Number(r.fee_amount ?? 0);
      const tax = Number(r.tax_amount ?? 0);
      const pnlSign = pnl >= 0 ? "+" : "";
      const fifoSummary = formatFifoMatchSummary(
        lotMatchMap.get(Number(r.id ?? 0)) ?? []
      );
      return `${base}${autoTag}\n    실현손익 ${pnlSign}${fmtInt(pnl)}원 · 비용 ${fmtInt(fee + tax)}원${fifoSummary ? `\n    ${fifoSummary}` : ""}`;
    }

    const gross = Number(r.gross_amount ?? 0);
    return `${base}${autoTag}\n    매수금액 ${fmtInt(gross)}원`;
  });

  const sellRows = rows.filter((r: any) => String(r.side) === "SELL");
  const buyRows = rows.filter((r: any) => String(r.side) === "BUY");
  const adjustRows = rows.filter((r: any) => String(r.side) === "ADJUST");
  const winCount = sellRows.filter((r: any) => Number(r.pnl_amount ?? 0) > 0).length;
  const loseCount = sellRows.filter((r: any) => Number(r.pnl_amount ?? 0) < 0).length;
  const totalSell = sellRows.length;
  const winRate = totalSell > 0 ? (winCount / totalSell) * 100 : 0;

  const msg = [
    "<b>가상 매매 기록</b>",
    LINE,
    maxDays ? `조회 기간 최근 ${maxDays}일` : "조회 기간 전체",
    `기록 합계 ${rows.length}건 (매수 ${buyRows.length} · 매도 ${totalSell} · 수정 ${adjustRows.length})`,
    "매도 손익은 FIFO 기준으로 계산됩니다.",
    "",
    ...lines,
    "",
    LINE,
    `매도 ${totalSell}건 · 승 ${winCount} · 패 ${loseCount} · 승률 ${winRate.toFixed(1)}%`,
    `가상 잔액 <code>${fmtInt(cash)}원</code>`,
    `누적 실현손익 <code>${realized >= 0 ? "+" : ""}${fmtInt(realized)}원</code>`,
  ].join("\n");

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: msg,
    parse_mode: "HTML",
  });
}
