// src/bot/commands/scan.ts

import { createClient } from "@supabase/supabase-js";
// import { resolveBase } from "../../lib/base";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;
if (!url || !key) {
  throw new Error(
    `Missing Supabase env. Got SUPABASE_URL=${
      url ? "set" : "missing"
    }, SUPABASE_ANON_KEY=${key ? "set" : "missing"}`
  );
}

const supabase = createClient(url, key);

export async function handleScanCommand(
  query: string,
  ctx: { chatId: number },
  tgSend: any
) {
  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: `🔍 ${query ? `'${query}' 섹터` : "전체 시장"} 스캔 중...`,
  });

  // 1. 섹터 필터링이 있는 경우 섹터 ID 찾기
  let sectorId: string | null = null;
  if (query) {
    const { data: sectors } = await supabase
      .from("sectors")
      .select("id, name")
      .ilike("name", `%${query}%`)
      .limit(1);

    if (sectors && sectors.length > 0) {
      sectorId = sectors[0].id;
    } else {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: `❌ '${query}' 관련 섹터를 찾지 못했습니다.`,
      });
      return;
    }
  }

  // 2. 스캔 쿼리 실행 (오늘자 지표 기준)
  // 조건:
  // - 거래대금 5억 이상
  // - RSI 40~70 (건강한 상승)
  // - 정배열 (50일선 > 200일선)
  // - 200일선 위 (장기 상승 추세)
  // - 눌림목 (20일선 근처 3% 이내 OR AVWAP 지지)

  let dbQuery = supabase
    .from("daily_indicators")
    .select(
      `
      code,
      close,
      value_traded,
      rsi14,
      roc14,
      sma20,
      sma50,
      sma200,
      stocks!inner(name, sector_id)
    `
    )
    .order("trade_date", { ascending: false }) // 최신 날짜 우선
    .limit(500); // 전체 스캔 시 너무 많이 가져오지 않도록 1차 필터

  // 필수 조건 필터링
  dbQuery = dbQuery
    .gte("value_traded", 500000000) // 5억 이상
    .gte("rsi14", 40)
    .lte("rsi14", 70)
    .gt("close", 5000); // 동전주 제외

  // 섹터 필터 적용
  if (sectorId) {
    dbQuery = dbQuery.eq("stocks.sector_id", sectorId);
  }

  const { data, error } = await dbQuery;

  if (error) {
    console.error("Scan error:", error);
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "데이터베이스 조회 오류",
    });
    return;
  }

  // 3. 정밀 필터링 (Javascript 레벨에서 수행)
  // SQL로 표현하기 복잡한 '눌림목' 로직 등은 여기서 처리
  const candidates = (data || []).filter((row: any) => {
    const price = row.close;

    // (1) 정배열 & 추세
    const isTrendUp = row.sma50 > row.sma200 && price > row.sma200;
    if (!isTrendUp) return false;

    // (2) 눌림목 (20일선에서 -3% ~ +3% 사이)
    // 너무 높게 뜬 건 추격매수라 제외, 너무 떨어진 건 추세 이탈이라 제외
    const gap20 = (price - row.sma20) / row.sma20;
    const isPullback = gap20 > -0.03 && gap20 < 0.05; // -3% ~ +5% 허용

    // (3) 모멘텀 살아있음 (ROC 양수)
    const isMomentum = row.roc14 > 0;

    return isPullback && isMomentum;
  });

  // 4. 점수순 정렬 및 상위 10개 추출
  // (간단히 RSI가 50에 가까운 순서 or 거래대금 순 등으로 정렬)
  const topPicks = candidates
    .sort((a: any, b: any) => b.value_traded - a.value_traded) // 거래대금 많은 순
    .slice(0, 10);

  if (topPicks.length === 0) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "조건에 맞는 종목이 없습니다. (눌림목/거래량 조건 미달)",
    });
    return;
  }

  // 5. 결과 메시지 포맷팅
  let msg = `📊 <b>${sectorId ? query + " 섹터" : "전체 시장"} 스캔 결과</b>\n`;
  msg += `(기준: 정배열, RSI 40-70, 20일선 눌림)\n\n`;

  topPicks.forEach((stock: any, i: number) => {
    const name = stock.stocks?.name || stock.code;
    const gap20 = (((stock.close - stock.sma20) / stock.sma20) * 100).toFixed(
      1
    );
    const rsi = stock.rsi14?.toFixed(1);
    const vol = Math.round(stock.value_traded / 100000000); // 억 단위

    msg += `${i + 1}. <b>${name}</b> (${stock.close.toLocaleString()}원)\n`;
    msg += `   └ RSI: ${rsi} | 20일선: ${gap20}% | 거래: ${vol}억\n`;
  });

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: msg,
    parse_mode: "HTML",
  });
}
