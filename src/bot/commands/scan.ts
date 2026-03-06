// src/bot/commands/scan.ts
// 눌림목 스캐너 — 장중 실시간 · 장외 DB 하이브리드

import { createClient } from "@supabase/supabase-js";
import { fetchRealtimePriceBatch } from "../../utils/fetchRealtimePrice";
import { getFundamentalSnapshot } from "../../services/fundamentalService";
import { header, section, divider, buildMessage, actionButtons, ACTIONS } from "../messages/layout";

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

function fmtKorMoney(n: number): string {
  const safe = Number(n || 0);
  if (!Number.isFinite(safe) || safe <= 0) return "-";

  const eok = Math.floor(safe / 100_000_000);
  const jo = Math.floor(eok / 10_000);
  const restEok = eok % 10_000;

  if (jo > 0) {
    if (restEok > 0) return `${jo}조 ${restEok.toLocaleString("ko-KR")}억`;
    return `${jo}조`;
  }
  return `${eok.toLocaleString("ko-KR")}억`;
}

/** KST 기준 장중 여부 (09:00~15:30, 평일) */
function isMarketOpen(): boolean {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay(); // 0=일 6=토
  if (day === 0 || day === 6) return false;
  const hhmm = kst.getUTCHours() * 100 + kst.getUTCMinutes();
  return hhmm >= 900 && hhmm <= 1530;
}

export async function handleScanCommand(
  query: string,
  ctx: { chatId: number },
  tgSend: any
) {
  const live = isMarketOpen();
  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: `${query ? `'${query}' 섹터` : "전체 시장"} 스캔 중…${live ? " 📡 실시간" : ""}`,
  });

  // 0. 최신 trade_date 확인 (가장 최근 데이터 기준)
  const { data: latestDateRow } = await supabase
    .from("daily_indicators")
    .select("trade_date")
    .order("trade_date", { ascending: false })
    .limit(1);

  const latestDate = latestDateRow?.[0]?.trade_date;
  if (!latestDate) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "지표 데이터가 아직 없습니다. 데이터 수집 후 다시 시도해주세요.",
    });
    return;
  }

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
        text: `'${query}' 관련 섹터를 찾지 못했습니다.`,
      });
      return;
    }
  }

  // 2. DB에서 후보 기본 데이터 로딩
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
      trade_date,
      stocks!inner(name, sector_id)
    `
    )
    .eq("trade_date", latestDate)
    .limit(500);

  // 기본 필터 (너무 소규모 제외)
  dbQuery = dbQuery
    .gte("value_traded", 500000000) // 5억 이상
    .gt("close", 5000); // 동전주 제외

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

  if (!data?.length) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `조건에 맞는 종목이 없습니다.\n(기준일: ${latestDate})`,
    });
    return;
  }

  // ─── 장중: 실시간 가격으로 보정 ───
  let enriched = data as any[];

  if (live) {
    const codes = enriched.map((r: any) => r.code as string);
    const realtime = await fetchRealtimePriceBatch(codes);

    enriched = enriched.map((row: any) => {
      const rt = realtime[row.code];
      if (!rt) return row;
      return {
        ...row,
        close: rt.price, // 현재가로 교체
        _rtChange: rt.changeRate,
        _rtVolume: rt.tradingValue, // 당일 거래대금
      };
    });
  }

  // 3. 정밀 필터링 (현재가 기준)
  const candidates = enriched.filter((row: any) => {
    const price = row.close;
    const rsi = row.rsi14 ?? 50;

    // RSI 40~70
    if (rsi < 40 || rsi > 70) return false;

    // 정배열 + 추세
    const isTrendUp = row.sma50 > row.sma200 && price > row.sma200;
    if (!isTrendUp) return false;

    // 눌림목 (20일선 -3% ~ +5%)
    const gap20 = (price - row.sma20) / row.sma20;
    if (gap20 <= -0.03 || gap20 >= 0.05) return false;

    // 모멘텀 (ROC 양수)
    if ((row.roc14 ?? 0) <= 0) return false;

    return true;
  });

  // 3-1. 최신 재무/종합 점수 맵 조회 (전체 스캔 우선순위 반영)
  const codes = candidates.map((c: any) => c.code as string);
  const scoreMap = new Map<string, { total?: number; value?: number }>();
  if (codes.length) {
    const { data: latestScoreDate } = await supabase
      .from("scores")
      .select("asof")
      .order("asof", { ascending: false })
      .limit(1);

    const asof = latestScoreDate?.[0]?.asof;
    if (asof) {
      const { data: scoreRows } = await supabase
        .from("scores")
        .select("code, total_score, value_score")
        .eq("asof", asof)
        .in("code", codes);

      for (const row of scoreRows || []) {
        scoreMap.set(row.code, {
          total: Number(row.total_score ?? 0) || undefined,
          value: Number(row.value_score ?? 0) || undefined,
        });
      }
    }
  }

  // 4. 정렬: 장중은 거래대금 + 등락률 가중, 장외는 거래대금 순
  const topPicks = candidates
    .sort((a: any, b: any) => {
      const sa = scoreMap.get(a.code);
      const sb = scoreMap.get(b.code);
      const fundA = (sa?.total ?? 0) * 0.6 + (sa?.value ?? 0) * 0.8;
      const fundB = (sb?.total ?? 0) * 0.6 + (sb?.value ?? 0) * 0.8;

      if (live) {
        // 실시간: 등락률 높은 순 → 거래대금 순
        const scoreA =
          (a._rtChange ?? 0) * 2 + (a._rtVolume ?? a.value_traded) / 1e9 + fundA;
        const scoreB =
          (b._rtChange ?? 0) * 2 + (b._rtVolume ?? b.value_traded) / 1e9 + fundB;
        return scoreB - scoreA;
      }
      return b.value_traded + fundB * 1e8 - (a.value_traded + fundA * 1e8);
    })
    .slice(0, 10);

  if (topPicks.length === 0) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `조건에 맞는 종목이 없습니다.\n(기준일: ${latestDate})\n(눌림목/거래량 조건 미달)`,
    });
    return;
  }

  // 5. 결과 메시지
  const modeTag = live ? "📡 실시간" : `📊 ${latestDate}`;
  const resultLines: string[] = [];

  // 6. 2차 재무 리랭크 (상위 후보만, 지연 최소화)
  const rerankPool = topPicks.slice(0, 12);
  const fundamentals = await Promise.all(
    rerankPool.map(async (s: any) => ({
      code: s.code,
      fundamental: await getFundamentalSnapshot(s.code).catch(() => null),
    }))
  );
  const fundMap = new Map(
    fundamentals
      .filter((x) => x.fundamental)
      .map((x) => [x.code, x.fundamental!])
  );

  const finalPicks = [...topPicks]
    .sort((a: any, b: any) => {
      const fa = fundMap.get(a.code)?.qualityScore ?? 50;
      const fb = fundMap.get(b.code)?.qualityScore ?? 50;
      const sa = scoreMap.get(a.code);
      const sb = scoreMap.get(b.code);
      const baseA = Number(sa?.total ?? 0);
      const baseB = Number(sb?.total ?? 0);
      return fb * 0.45 + baseB * 0.55 - (fa * 0.45 + baseA * 0.55);
    })
    .slice(0, 10);

  finalPicks.forEach((stock: any, i: number) => {
    const name = stock.stocks?.name || stock.code;
    const gap20 = (((stock.close - stock.sma20) / stock.sma20) * 100).toFixed(1);
    const rsi = stock.rsi14?.toFixed(1);
    const s = scoreMap.get(stock.code);
    const valueLabel = s?.value != null ? `가치 ${Number(s.value).toFixed(0)}` : "가치 -";
    const fq = fundMap.get(stock.code)?.qualityScore;
    const fLabel = fq != null ? `재무 ${fq}` : "재무 -";

    if (live && stock._rtChange != null) {
      const chg = stock._rtChange >= 0 ? `▲${stock._rtChange.toFixed(1)}%` : `▼${Math.abs(stock._rtChange).toFixed(1)}%`;
      const vol = fmtKorMoney(stock._rtVolume ?? stock.value_traded);
      resultLines.push(
        `${i + 1}. <b>${name}</b>  <code>${stock.close.toLocaleString()}원</code>  ${chg}\n` +
          `RSI ${rsi} · ${valueLabel} · ${fLabel}\n` +
          `20일선 ${gap20}% · 거래대금 ${vol}`
      );
    } else {
      const vol = fmtKorMoney(stock.value_traded);
      resultLines.push(
        `${i + 1}. <b>${name}</b>  <code>${stock.close.toLocaleString()}원</code>\n` +
          `RSI ${rsi} · ${valueLabel} · ${fLabel}\n` +
          `20일선 ${gap20}% · 거래대금 ${vol}`
      );
    }
  });

  const msg = buildMessage([
    header(`${sectorId ? query + " 섹터" : "전체 시장"} 스캔 결과`, `${modeTag} · 정배열, RSI 40-70, 20일선 눌림`),
    section("상위 후보", resultLines),
    divider(),
  ]);

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: msg,
    parse_mode: "HTML",
    reply_markup: actionButtons([...ACTIONS.promptAnalyze, ...ACTIONS.marketHub], 3),
  });
}
