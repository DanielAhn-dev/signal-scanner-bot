import type { ChatContext } from "../router";
import { createClient } from "@supabase/supabase-js";
import { fmtKRW } from "../../lib/normalize";
import { pickSaferCandidates, type RiskProfile } from "../../lib/investableUniverse";
import { getUserInvestmentPrefs } from "../../services/userService";
import { esc, fmtInt } from "../messages/format";
import { fetchRealtimePriceBatch } from "../../utils/fetchRealtimePrice";
import { header, section, divider, buildMessage, actionButtons } from "../messages/layout";

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
  const prefs = await getUserInvestmentPrefs(ctx.from?.id ?? ctx.chatId);
  const riskProfile = (prefs.risk_profile ?? "safe") as RiskProfile;
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
      code, name, close, market, liquidity, is_sector_leader, market_cap, universe_level, sector_id,
      scores ( value_score, momentum_score, total_score )
    `
    )
    .in("sector_id", sectorIds)
    .in("market", ["KOSPI", "KOSDAQ"])
    .in("universe_level", ["core", "extended"])
    .order("market_cap", { ascending: false })
    .limit(10);

  let fallbackStocks: any[] = [];
  if (error || !stocks || stocks.length === 0) {
    // 1차 폴백: universe_level 제약만 완화하되 sector_id 조건은 유지
    const { data: fallbackBySector } = await supabase
      .from("stocks")
      .select(`code, name, close, market, liquidity, is_sector_leader, market_cap, universe_level, scores ( value_score, momentum_score, total_score )`)
      .in("sector_id", sectorIds)
      .in("market", ["KOSPI", "KOSDAQ"])
      .order("market_cap", { ascending: false })
      .limit(20);

    fallbackStocks = (fallbackBySector || []).slice(0, 10);

    // 2차 폴백: 섹터 키워드가 종목명/코드에 직접 포함된 경우만 허용
    if (!fallbackStocks.length) {
      const { data: fallbackByKeyword } = await supabase
        .from("stocks")
        .select(`code, name, close, market, liquidity, is_sector_leader, market_cap, universe_level, scores ( value_score, momentum_score, total_score )`)
        .in("market", ["KOSPI", "KOSDAQ"])
        .ilike("name", `%${sectorKeyword}%`)
        .order("market_cap", { ascending: false })
        .limit(10);

      fallbackStocks = fallbackByKeyword || [];
    }

    if (!fallbackStocks.length) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: `'${sectorKeyword}' 섹터의 종목을 찾을 수 없습니다.`,
      });
      return;
    }
  }

  const sourceStocks = stocks && stocks.length > 0 ? stocks : fallbackStocks;

  const finalStocks = pickSaferCandidates(
    sourceStocks.map((s: any) => {
      const scoreData = Array.isArray(s.scores) ? s.scores[0] : s.scores;
      return {
        ...s,
        total_score: scoreData?.total_score,
        momentum_score: scoreData?.momentum_score,
        value_score: scoreData?.value_score,
      };
    }),
    10,
    riskProfile
  );

  // 3. 실시간 가격 + daily_indicators 보강
  const topCodes = finalStocks.slice(0, 5).map((s: any) => s.code);
  const realtimeMap = topCodes.length ? await fetchRealtimePriceBatch(topCodes) : {};
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

      const rt = realtimeMap[s.code];
      const price = rt?.price || ind.close || s.close || 0;
      const changeStr = rt
        ? ` ${rt.change >= 0 ? "▲" : "▼"}${Math.abs(rt.changeRate).toFixed(1)}%`
        : "";
      const valTraded = ind.value_traded || 0;
      const rsi = ind.rsi14 ? `RSI ${Number(ind.rsi14).toFixed(0)}` : "";

      return [
        `${rank}. <b>${esc(s.name)}</b>${tagStr}`,
        `   <code>${fmtPrice(price)}원</code>${changeStr} ${rsi ? `· ${rsi}` : ""}`,
        valTraded ? `   거래대금 ${fmtKRW(valTraded)}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const message = buildMessage([
    header(`${sectorName} 주도주 현황`, "대형주(Core) 및 유동성 상위 종목"),
    section("상위 종목", [listText]),
    divider(),
  ]);

  // 5. 버튼 생성
  const buttons = finalStocks.slice(0, 10).map((s: any) => ({
    text: `${s.name}`,
    callback_data: `trade:${s.code}`,
  }));

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: message,
    parse_mode: "HTML",
    reply_markup: actionButtons(buttons, 2),
  });
}
