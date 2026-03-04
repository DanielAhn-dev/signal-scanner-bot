import type { ChatContext } from "../router";
import { createMultiRowKeyboard } from "../../telegram/keyboards";
import { createClient } from "@supabase/supabase-js";
import { fmtKRW } from "../../lib/normalize";
import { esc, fmtInt, LINE } from "../messages/format";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

const fmtPrice = (n: number) => n.toLocaleString("ko-KR");

export async function handleStocksCommand(
  sectorKeyword: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  // 1. 섹터 ID 찾기 (sector_id는 "KRX:반도체" 형식)
  const { data: sectorRows } = await supabase
    .from("sectors")
    .select("id, name")
    .ilike("name", `%${sectorKeyword}%`)
    .limit(5);

  if (!sectorRows || sectorRows.length === 0) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `'${sectorKeyword}' 섹터를 찾을 수 없습니다.\n검색어가 정확한지 확인해주세요.`,
    });
    return;
  }

  const sectorIds = sectorRows.map((s: any) => s.id);
  const sectorName = sectorRows[0].name;

  // 2. 해당 섹터의 종목 조회
  const { data: stocks, error } = await supabase
    .from("stocks")
    .select(
      `
      code, name, close, market_cap, universe_level, sector_id,
      scores ( value_score, momentum_score, total_score )
    `
    )
    .in("sector_id", sectorIds)
    .in("universe_level", ["core", "extended"])
    .order("market_cap", { ascending: false })
    .limit(10);

  if (error || !stocks || stocks.length === 0) {
    // sector_id 필터 실패 시 이름 포함 폴백
    const { data: fallback } = await supabase
      .from("stocks")
      .select(`code, name, close, market_cap, universe_level, scores ( value_score, momentum_score, total_score )`)
      .in("universe_level", ["core", "extended"])
      .order("market_cap", { ascending: false })
      .limit(10);

    if (!fallback || fallback.length === 0) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: `'${sectorKeyword}' 섹터의 종목을 찾을 수 없습니다.`,
      });
      return;
    }
  }

  const finalStocks = stocks && stocks.length > 0 ? stocks : [];

  // 3. daily_indicators에서 최신 지표 보강
  const topCodes = finalStocks.slice(0, 5).map((s: any) => s.code);
  let indicatorsMap: Record<string, any> = {};

  if (topCodes.length > 0) {
    const { data: indData } = await supabase
      .from("daily_indicators")
      .select("code, close, value_traded, rsi14, roc14")
      .in("code", topCodes)
      .order("trade_date", { ascending: false })
      .limit(topCodes.length);

    for (const row of indData || []) {
      if (!indicatorsMap[row.code]) {
        indicatorsMap[row.code] = row;
      }
    }
  }

  // 4. 리스트 생성 (HTML)
  const top5 = finalStocks.slice(0, 5);

  const listText = top5
    .map((s: any, idx: number) => {
      const rank = idx + 1;

      const scoreData = Array.isArray(s.scores) ? s.scores[0] : s.scores;
      const ind = indicatorsMap[s.code] || {};

      const tags: string[] = [];
      if (scoreData) {
        if ((scoreData.value_score || 0) >= 30) tags.push("V");
        if ((scoreData.momentum_score || 0) >= 30) tags.push("M");
      }
      const tagStr = tags.length ? ` [${tags.join("+")}]` : "";

      const price = ind.close || s.close || 0;
      const valTraded = ind.value_traded || 0;
      const rsi = ind.rsi14 ? `RSI ${Number(ind.rsi14).toFixed(0)}` : "";

      return [
        `${rank}. <b>${esc(s.name)}</b>${tagStr}`,
        `   <code>${fmtPrice(price)}원</code> ${rsi ? `· ${rsi}` : ""}`,
        valTraded ? `   거래대금 ${fmtKRW(valTraded)}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const header = `<b>${esc(sectorName)}</b> 주도주 현황\n<i>대형주(Core) 및 유동성 상위 종목</i>`;
  const footer = `\n${LINE}\n버튼을 눌러 상세 진단을 확인하세요`;

  const message = [header, LINE, listText, footer].join("\n");

  // 5. 버튼 생성
  const buttons = finalStocks.slice(0, 10).map((s: any) => ({
    text: `${s.name}`,
    callback_data: `score:${s.code}`,
  }));

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: message,
    parse_mode: "HTML",
    reply_markup: createMultiRowKeyboard(2, buttons),
  });
}
