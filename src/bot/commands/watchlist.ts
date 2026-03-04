// src/bot/commands/watchlist.ts
// 관심종목 포트폴리오 — 가상 매매 추적

import type { ChatContext } from "../router";
import { createClient } from "@supabase/supabase-js";
import { searchByNameOrCode } from "../../search/normalize";
import { esc, fmtInt, fmtPct, LINE } from "../messages/format";

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
  const { data: items, error } = await supabaseRead
    .from("watchlist")
    .select(
      `
      code, buy_price, buy_date, memo,
      stock:stocks!inner ( name, close )
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
      ].join("\n"),
    });
  }

  let totalCost = 0;
  let totalValue = 0;

  const lines = items.map((item: any, idx: number) => {
    const stock = item.stock as any;
    const name = stock?.name ?? item.code;
    const close = Number(stock?.close ?? 0);
    const buyPrice = Number(item.buy_price ?? 0);
    const hasBuy = buyPrice > 0;

    let plStr = "";
    if (hasBuy && close > 0) {
      const plPct = ((close - buyPrice) / buyPrice) * 100;
      const plSign = plPct >= 0 ? "▲" : "▼";
      plStr = `  ${plSign} ${fmtPct(plPct)}`;
      totalCost += buyPrice;
      totalValue += close;
    }

    const buyStr = hasBuy ? `  매수 <code>${fmtInt(buyPrice)}</code>` : "";

    return `${idx + 1}. <b>${esc(name)}</b> (${item.code})  <code>${fmtInt(close)}원</code>${buyStr}${plStr}`;
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
    `<b>관심종목</b>`,
    LINE,
    ...lines,
    summaryLine,
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
    text: `${esc(name)} (${code}) 관심종목 추가 완료${priceNote}\n/관심 으로 목록 확인`,
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
