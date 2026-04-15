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

const MAX_ITEMS = 20; // 사용자당 최대 관심종목 수

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 읽기 전용 (anon key)
const supabaseRead = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

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
      code, buy_price, buy_date, memo,
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
    if (hasBuy && close > 0) {
      const plPct = ((close - buyPrice) / buyPrice) * 100;
      const plAmt = close - buyPrice;
      const plSign = plPct >= 0 ? "▲" : "▼";
      plStr = `\n    수익 ${plSign} ${fmtPct(plPct)} (${plAmt >= 0 ? "+" : ""}${fmtInt(plAmt)}원)`;
      totalCost += buyPrice;
      totalValue += close;
    }

    const buyStr = hasBuy
      ? `\n    매수 <code>${fmtInt(buyPrice)}원</code>`
      : "";
    const actionStr =
      plan.status === "buy-on-pullback"
        ? `\n    액션 ${plan.statusLabel} · 진입 ${fmtInt(plan.entryLow)}~${fmtInt(plan.entryHigh)}`
        : `\n    액션 ${plan.statusLabel} · 손절 ${fmtInt(plan.stopPrice)} · 1차 ${fmtPct(plan.target1Pct * 100)}`;

    return (
      `${idx + 1}. <b>${esc(name)}</b> (${item.code})\n` +
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
  const buyPrice = rawPrice ? Number(rawPrice.replace(/,/g, "")) : null;

  // 중복 확인 & 업서트
  const { error } = await supabase
    .from("watchlist")
    .upsert(
      {
        chat_id: ctx.chatId,
        code,
        buy_price: buyPrice && Number.isFinite(buyPrice) ? buyPrice : null,
        buy_date: new Date().toISOString().slice(0, 10),
      },
      { onConflict: "chat_id,code" }
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
    text: `${esc(name)} (${code}) 관심종목 추가 완료${priceNote}\n/관심 으로 목록 확인\n/브리핑 에서 추천 후보와 함께 점검`,
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

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: `${esc(name)} (${code}) 관심종목에서 삭제 완료\n/관심 으로 목록 확인`,
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
    .upsert(
      {
        chat_id: ctx.chatId,
        code,
        buy_price: price && Number.isFinite(price) ? price : null,
        buy_date: new Date().toISOString().slice(0, 10),
      },
      { onConflict: "chat_id,code" }
    );

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
