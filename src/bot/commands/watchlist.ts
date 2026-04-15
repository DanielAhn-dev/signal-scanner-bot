// src/bot/commands/watchlist.ts
// 관심종목 포트폴리오 — 가상 매매 추적 + 실시간 가격

import type { ChatContext } from "../router";
import { createClient } from "@supabase/supabase-js";
import { searchByNameOrCode } from "../../search/normalize";
import { esc, fmtInt, fmtPct, LINE } from "../messages/format";
import {
  fetchRealtimePrice,
  fetchRealtimePriceBatch,
} from "../../utils/fetchRealtimePrice";
import { buildInvestmentPlan } from "../../lib/investPlan";
import {
  getUserInvestmentPrefs,
  setUserInvestmentPrefs,
} from "../../services/userService";

const MAX_ITEMS = 20; // 사용자당 최대 관심종목 수
const DEFAULT_TARGET_POSITIONS = 10;
const DEFAULT_FEE_RATE = 0.00015;
const DEFAULT_TAX_RATE = 0.0018;

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

async function appendVirtualTradeLog(payload: {
  chatId: number;
  code: string;
  side: "BUY" | "SELL";
  price: number;
  quantity: number;
  grossAmount: number;
  netAmount: number;
  feeAmount?: number;
  taxAmount?: number;
  pnlAmount?: number;
  memo?: string;
}): Promise<void> {
  try {
    await supabase.from("virtual_trades").insert({
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
    });
  } catch (e) {
    console.error("appendVirtualTradeLog error:", e);
  }
}

// ─── /관심 (목록 조회) ───────────────────
export async function handleWatchlistCommand(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const { data: scoreDateRows } = await supabaseRead
    .from("scores")
    .select("asof")
    .order("asof", { ascending: false })
    .limit(1);
  const scoreAsOf = scoreDateRows?.[0]?.asof ?? null;

  const { data: items, error } = await supabaseRead
    .from("watchlist")
    .select(
      `
      code, buy_price, buy_date, memo, created_at, quantity, invested_amount,
      stock:stocks!inner ( name, close, rsi14 )
    `
    )
    .eq("chat_id", ctx.chatId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("watchlist query error:", error);
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "관심종목 조회 중 오류가 발생했습니다.",
    });
  }

  if (!items || items.length === 0) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        "관심종목이 비어 있습니다.",
        "",
        "/관심추가 종목명 [매수가]",
        "예) /관심추가 삼성전자 72000",
        "추가한 종목은 /브리핑에서 함께 점검됩니다.",
      ].join("\n"),
    });
  }

  // 실시간 가격 일괄 조회
  const codes = items.map((it: any) => it.code);
  const realtimeMap = await fetchRealtimePriceBatch(codes);
  const scoresByCode = new Map<string, { total_score?: number | null; momentum_score?: number | null }>();

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
      });
    }
  }

  let totalCost = 0;
  let totalValue = 0;
  let actionable = 0;
  let pullback = 0;
  let wait = 0;

  const lines = items.map((item: any, idx: number) => {
    const stock = item.stock as any;
    const name = stock?.name ?? item.code;
    const dbClose = Number(stock?.close ?? 0);
    const rt = realtimeMap[item.code];
    const close = rt?.price ?? dbClose;
    const buyPrice = Number(item.buy_price ?? 0);
    const qty = Math.max(0, Math.floor(Number(item.quantity ?? (buyPrice > 0 ? 1 : 0))));
    const invested = toPositiveNumber(item.invested_amount) ?? (qty > 0 && buyPrice > 0 ? qty * buyPrice : 0);
    const hasBuy = buyPrice > 0;
    const score = scoresByCode.get(item.code);
    const plan = buildInvestmentPlan({
      currentPrice: close,
      factors: { rsi14: stock?.rsi14 ?? undefined },
      technicalScore: score?.total_score ?? score?.momentum_score ?? undefined,
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
      plan.status === "buy-on-pullback"
        ? `\n    액션 ${plan.statusLabel} · 진입 ${fmtInt(plan.entryLow)}~${fmtInt(plan.entryHigh)}`
        : `\n    액션 ${plan.statusLabel} · 손절 ${fmtInt(plan.stopPrice)} · 1차 ${fmtPct(plan.target1Pct * 100)}`;

    return (
      `${idx + 1}. <b>${esc(name)}</b> (${item.code}) · 추가 (${addedDate})\n` +
      `    현재 <code>${fmtInt(close)}원</code>  ${changeStr}` +
      buyStr +
      plStr +
      actionStr
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

  const msg = [
    `<b>관심종목 포트폴리오</b>`,
    LINE,
    `오늘 액션 ${actionable}건 · 눌림 대기 ${pullback}건 · 관망 ${wait}건`,
    "",
    ...lines,
    summaryLine,
    "",
    `/관심추가 종목 [매수가] · /관심삭제 종목`,
    `/관심수정 종목 매수가`,
    `/기록`,
  ].join("\n");

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: msg,
    parse_mode: "HTML",
  });
}

// ─── /관심추가 <종목> [매수가] ───────────
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
      text: "사용법: /관심추가 종목명 [매수가]\n예) /관심추가 삼성전자 72000",
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
      text: `관심종목은 최대 ${MAX_ITEMS}개까지 등록할 수 있습니다.\n/관심삭제 로 정리 후 추가해주세요.`,
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
      text: `${esc(name)} (${code})은 이미 관심종목에 있습니다.\n/관심수정 ${name} 매수가 로 수정해주세요.`,
      parse_mode: "HTML",
    });
  }

  const realtimePrice = await fetchRealtimePrice(code);
  const buyPrice =
    toPositiveNumber(explicitBuyPrice) ??
    toPositiveNumber(realtimePrice);

  const tgId = ctx.from?.id ?? ctx.chatId;
  const prefs = await getUserInvestmentPrefs(tgId);
  const cap = toPositiveNumber(prefs.capital_krw) ?? 0;
  const seedCapital = toPositiveNumber(prefs.virtual_seed_capital) ?? cap;
  const targetPositions =
    Math.max(1, Math.floor(toPositiveNumber(prefs.virtual_target_positions) ?? DEFAULT_TARGET_POSITIONS));
  const currentCash = toPositiveNumber(prefs.virtual_cash) ?? (seedCapital > 0 ? seedCapital : cap);

  let quantity: number | null = null;
  let investedAmount: number | null = null;
  let walletNote = "";

  if (buyPrice && cap > 0 && currentCash > 0) {
    const holdingCount = count ?? 0;
    const slotsLeft = Math.max(targetPositions - holdingCount, 1);
    const budgetPerPosition = Math.floor(currentCash / slotsLeft);

    const qty = Math.floor(budgetPerPosition / buyPrice);
    if (qty >= 1) {
      quantity = qty;
      investedAmount = qty * buyPrice;

      const nextCash = Math.max(0, currentCash - investedAmount);
      await setUserInvestmentPrefs(tgId, {
        virtual_seed_capital: seedCapital || cap,
        virtual_cash: nextCash,
        virtual_target_positions: targetPositions,
      });

      walletNote = `\n가상매수 ${quantity}주 · 사용 ${fmtInt(investedAmount)}원 · 잔액 ${fmtInt(nextCash)}원`;

      await appendVirtualTradeLog({
        chatId: ctx.chatId,
        code,
        side: "BUY",
        price: buyPrice,
        quantity,
        grossAmount: investedAmount,
        netAmount: investedAmount,
        memo: "watchlist-add",
      });
    }
  }

  // 중복 확인 & 업서트
  const { error } = await supabase
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
    );

  if (error) {
    console.error("watchlist upsert error:", error);
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "관심종목 추가 중 오류가 발생했습니다.",
    });
  }

  const priceNote = buyPrice ? `  매수가 ${fmtInt(buyPrice)}원` : "";
  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: `${esc(name)} (${code}) 관심종목 추가 완료${priceNote}${walletNote}\n/관심 으로 목록 확인\n/브리핑 에서 추천 후보와 함께 점검`,
    parse_mode: "HTML",
  });
}

// ─── /관심삭제 <종목> ────────────────────
export async function handleWatchlistRemove(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const query = (input || "").trim();

  if (!query) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "사용법: /관심삭제 종목명 또는 코드\n예) /관심삭제 삼성전자",
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

  const { code, name } = hits[0];

  const { data: row, error: rowError } = await supabaseRead
    .from("watchlist")
    .select("code, buy_price, quantity, invested_amount, stock:stocks!inner(close)")
    .eq("chat_id", ctx.chatId)
    .eq("code", code)
    .maybeSingle();

  if (rowError) {
    console.error("watchlist fetch before delete error:", rowError);
  }

  const tgId = ctx.from?.id ?? ctx.chatId;
  const prefs = await getUserInvestmentPrefs(tgId);
  const qty = Math.max(0, Math.floor(Number((row as any)?.quantity ?? 0)));
  const buyPrice = Number((row as any)?.buy_price ?? 0);
  const invested = toPositiveNumber((row as any)?.invested_amount) ?? (qty > 0 && buyPrice > 0 ? qty * buyPrice : 0);

  const { error, count } = await supabase
    .from("watchlist")
    .delete({ count: "exact" })
    .eq("chat_id", ctx.chatId)
    .eq("code", code);

  if (error) {
    console.error("watchlist delete error:", error);
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "관심종목 삭제 중 오류가 발생했습니다.",
    });
  }

  if (!count) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `${esc(name)} (${code})은 관심종목에 없습니다.`,
      parse_mode: "HTML",
    });
  }

  if (qty > 0 && invested > 0) {
    const rt = await fetchRealtimePrice(code);
    const fallbackClose = Number(((row as any)?.stock as any)?.close ?? 0);
    const exitPrice = toPositiveNumber(rt) ?? toPositiveNumber(fallbackClose) ?? buyPrice;

    const feeRate = toPositiveNumber(prefs.virtual_fee_rate) ?? DEFAULT_FEE_RATE;
    const taxRate = toPositiveNumber(prefs.virtual_tax_rate) ?? DEFAULT_TAX_RATE;
    const gross = qty * exitPrice;
    const feeAmount = Math.round(gross * feeRate);
    const taxAmount = Math.round(gross * taxRate);
    const net = Math.max(0, gross - feeAmount - taxAmount);
    const pnl = net - invested;

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

    await appendVirtualTradeLog({
      chatId: ctx.chatId,
      code,
      side: "SELL",
      price: exitPrice,
      quantity: qty,
      grossAmount: gross,
      netAmount: net,
      feeAmount,
      taxAmount,
      pnlAmount: pnl,
      memo: "watchlist-remove",
    });
  }

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: `${esc(name)} (${code}) 관심종목에서 삭제 완료\n/관심 으로 목록 확인\n/기록 으로 가상 거래 내역 확인`,
    parse_mode: "HTML",
  });
}

// ─── /관심수정 <종목> <매수가> ────────────
export async function handleWatchlistEdit(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const parts = (input || "").trim().split(/\s+/);
  const query = parts[0];
  const rawPrice = parts[1];

  if (!query || !rawPrice) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "사용법: /관심수정 종목명 매수가\n예) /관심수정 삼성전자 72000",
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
      text: "유효한 매수가를 입력해주세요.\n예) /관심수정 삼성전자 72000",
    });
  }

  // 기존 관심종목인지 확인
  const { data: existing } = await supabaseRead
    .from("watchlist")
    .select("id")
    .eq("chat_id", ctx.chatId)
    .eq("code", code)
    .single();

  if (!existing) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `${esc(name)} (${code})은 관심종목에 없습니다.\n/관심추가 로 먼저 추가해주세요.`,
      parse_mode: "HTML",
    });
  }

  const { error } = await supabase
    .from("watchlist")
    .update({ buy_price: newPrice })
    .eq("chat_id", ctx.chatId)
    .eq("code", code);

  if (error) {
    console.error("watchlist edit error:", error);
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "매수가 수정 중 오류가 발생했습니다.",
    });
  }

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: `${esc(name)} (${code}) 매수가 → <code>${fmtInt(newPrice)}원</code> 수정 완료\n/관심 으로 확인`,
    parse_mode: "HTML",
  });
}

// ─── 관심추가 Quick (콜백 버튼에서 사용) ──
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
      text: `${esc(name)} (${code})은 이미 관심종목에 있습니다.`,
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
      text: `관심종목은 최대 ${MAX_ITEMS}개까지 등록할 수 있습니다.\n/관심삭제 로 정리 후 추가해주세요.`,
    });
  }

  const { error } = await supabase
    .from("watchlist")
    .insert({
      chat_id: ctx.chatId,
      code,
      buy_price: price && Number.isFinite(price) ? price : null,
      buy_date: new Date().toISOString().slice(0, 10),
      quantity: null,
      invested_amount: null,
    });

  if (error) {
    console.error("watchlist quick-add error:", error);
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "관심종목 추가 중 오류가 발생했습니다.",
    });
  }

  const priceNote = price ? `  매수가 ${fmtInt(price)}원 (현재가 자동저장)` : "";
  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: `${esc(name)} (${code}) 관심종목 추가 완료${priceNote}\n/관심 으로 목록 확인\n/브리핑 에서 함께 점검\n/관심수정 ${name} 가격 — 매수가 변경`,
    parse_mode: "HTML",
  });
}

// ─── /기록 (가상 매매 내역) ───────────────
export async function handleWatchlistHistoryCommand(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const { data: rows, error } = await supabaseRead
    .from("virtual_trades")
    .select("code, side, price, quantity, gross_amount, net_amount, fee_amount, tax_amount, pnl_amount, traded_at")
    .eq("chat_id", ctx.chatId)
    .order("traded_at", { ascending: false })
    .limit(20);

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

  if (!rows || rows.length === 0) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        "<b>가상 매매 기록</b>",
        LINE,
        "아직 기록이 없습니다.",
        "/관심추가 로 가상 매수를 시작해보세요.",
      ].join("\n"),
      parse_mode: "HTML",
    });
  }

  const lines = rows.map((r: any, idx: number) => {
    const d = formatShortDate(r.traded_at as string | null | undefined);
    const side = (r.side as string) === "SELL" ? "매도" : "매수";
    const qty = Math.max(0, Math.floor(Number(r.quantity ?? 0)));
    const price = Number(r.price ?? 0);
    const base = `${idx + 1}. (${d}) ${side} ${r.code} ${qty}주 @ ${fmtInt(price)}원`;

    if ((r.side as string) === "SELL") {
      const pnl = Number(r.pnl_amount ?? 0);
      const fee = Number(r.fee_amount ?? 0);
      const tax = Number(r.tax_amount ?? 0);
      const pnlSign = pnl >= 0 ? "+" : "";
      return `${base}\n    실현손익 ${pnlSign}${fmtInt(pnl)}원 · 비용 ${fmtInt(fee + tax)}원`;
    }

    const gross = Number(r.gross_amount ?? 0);
    return `${base}\n    매수금액 ${fmtInt(gross)}원`;
  });

  const msg = [
    "<b>가상 매매 기록</b>",
    LINE,
    ...lines,
    "",
    LINE,
    `가상 잔액 <code>${fmtInt(cash)}원</code>`,
    `누적 실현손익 <code>${realized >= 0 ? "+" : ""}${fmtInt(realized)}원</code>`,
  ].join("\n");

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: msg,
    parse_mode: "HTML",
  });
}
