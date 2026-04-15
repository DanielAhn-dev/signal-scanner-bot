// src/bot/commands/pullback.ts
// 눌림목 매집 시그널 조회 커맨드 — pullback_signals 테이블 직접 쿼리

import type { ChatContext } from "../router";
import { createClient } from "@supabase/supabase-js";
import { esc, gradeLabel } from "../messages/format";
import { fetchRealtimePriceBatch } from "../../utils/fetchRealtimePrice";
import { pickSaferCandidates, type RiskProfile } from "../../lib/investableUniverse";
import { getUserInvestmentPrefs } from "../../services/userService";
import { header, section, divider, buildMessage, actionButtons, ACTIONS } from "../messages/layout";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

/**
 * /pullback — 눌림목 매집 후보 종목 조회
 */
export async function handlePullbackCommand(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  try {
    const prefs = await getUserInvestmentPrefs(ctx.from?.id ?? ctx.chatId);
    const riskProfile = (prefs.risk_profile ?? "safe") as RiskProfile;
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "눌림목 매집 후보 분석 중...",
    });

    // 최신 trade_date 조회
    const { data: latestRow } = await supabase
      .from("pullback_signals")
      .select("trade_date")
      .order("trade_date", { ascending: false })
      .limit(1);

    const latestDate = latestRow?.[0]?.trade_date;
    if (!latestDate) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "눌림목 시그널 데이터가 아직 없습니다.\n데이터 수집 후 다시 시도해주세요.",
      });
      return;
    }

    // 전체 종목 중 A/B 등급 후보 조회 (상위 추출은 앱에서 수행)
    const { data: candidates, error } = await supabase
      .from("pullback_signals")
      .select(
        `
        code, entry_grade, entry_score,
        trend_grade, dist_grade, dist_pct, pivot_grade, vol_atr_grade,
        warn_grade, warn_score, ma21, ma50,
        stock:stocks!inner ( name, close, market, liquidity, universe_level )
      `
      )
      .eq("trade_date", latestDate)
      .in("entry_grade", ["A", "B"])
      .neq("warn_grade", "SELL")
      .order("entry_score", { ascending: false });

    if (error) {
      console.error("pullback query error:", error);
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "데이터 조회 중 오류가 발생했습니다.",
      });
      return;
    }

    if (!candidates || candidates.length === 0) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text:
          "현재 눌림목 매집 조건(A/B 등급)에 해당하는 종목이 없습니다.\n" +
          "시장이 과열 또는 하락 추세일 수 있습니다.",
      });
      return;
    }

    // A등급 우선 + 경고점수 낮은 순으로 정렬 후 상위 노출
    candidates.sort((a: any, b: any) => {
      if (a.entry_grade !== b.entry_grade)
        return a.entry_grade === "A" ? -1 : 1;
      if ((a.warn_score ?? 0) !== (b.warn_score ?? 0))
        return (a.warn_score ?? 0) - (b.warn_score ?? 0);
      return (b.entry_score ?? 0) - (a.entry_score ?? 0);
    });

    const topCandidates = pickSaferCandidates(
      candidates.map((item: any) => ({
        ...item,
        name: item.stock?.name,
        market: item.stock?.market,
        liquidity: item.stock?.liquidity,
        universe_level: item.stock?.universe_level,
      })),
      12,
      riskProfile
    );

    // 실시간 가격 일괄 조회
    const codes = topCandidates.map((c: any) => c.code);
    const realtimeMap = await fetchRealtimePriceBatch(codes);

    // 경고 라벨
    const warnLabel: Record<string, string> = {
      SAFE: "안전",
      WATCH: "관찰",
      WARN: "주의",
      SELL: "매도",
    };

    // 조회일(KST 오늘) vs 기준일(DB 최신 데이터) 구분
    const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const todayStr = nowKST.toISOString().slice(0, 10);
    const dateNote =
      todayStr === latestDate
        ? `기준일 ${latestDate}`
        : `조회일 ${todayStr}  ·  기준일 ${latestDate} (전거래일 데이터)`;

    const candidateLines: string[] = [];

    for (const s of topCandidates) {
      const stock = s.stock as any;
      const gl = gradeLabel[s.entry_grade] ?? "";
      const wl = warnLabel[s.warn_grade] ?? "";

      const rt = realtimeMap[s.code];
      const price = rt?.price ?? (stock.close ? Number(stock.close) : 0);
      const close = price ? price.toLocaleString() : "-";
      const changeStr = rt
        ? ` ${rt.change >= 0 ? "▲" : "▼"}${Math.abs(rt.changeRate).toFixed(1)}%`
        : "";

      let line = `${gl} <b>${esc(stock.name)}</b> (${s.code})  <code>${close}원</code>${changeStr}\n`;
      line += `진입 ${s.entry_grade}(${s.entry_score}/4) · 경고 ${wl}(${s.warn_score}/6)`;

      // 세부 등급
      const details: string[] = [];
      if (s.trend_grade) details.push(`추세:${s.trend_grade}`);
      if (s.dist_grade)
        details.push(`이격:${s.dist_grade}(${s.dist_pct ?? "-"}%)`);
      if (s.pivot_grade) details.push(`피봇:${s.pivot_grade}`);
      if (s.vol_atr_grade) details.push(`변동:${s.vol_atr_grade}`);
      if (details.length) line += `\n${details.join(" · ")}`;
      candidateLines.push(line);
    }

    const msg = buildMessage([
      header("눌림목 매집 후보", dateNote),
      section("스캔 기준", ["코스피 중심 · core/extended · A/B 등급 · 매도경고 제외"]),
      section("상위 후보", candidateLines),
      divider(),
      `전체 후보 ${candidates.length}개 중 상위 ${topCandidates.length}개`,
    ]);

    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: msg,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: actionButtons([...ACTIONS.promptAnalyze, ...ACTIONS.marketFlow], 3),
    });
  } catch (e) {
    console.error("handlePullbackCommand error:", e);
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "눌림목 분석 중 오류가 발생했습니다.",
    });
  }
}
