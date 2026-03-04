// src/bot/commands/pullback.ts
// 눌림목 매집 시그널 조회 커맨드 — pullback_signals 테이블 직접 쿼리

import type { ChatContext } from "../router";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

/**
 * /pullback — 눌림목 매집 후보 종목 조회
 *
 * pullback_signals 테이블에서 최신 trade_date 기준
 * entry_grade A/B + warn_grade != SELL 종목을 표시.
 */
export async function handlePullbackCommand(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  try {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "🔎 눌림목 매집 후보 분석 중...",
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
        text: "⚠️ 눌림목 시그널 데이터가 아직 없습니다.\n데이터 수집 후 다시 시도해주세요.",
      });
      return;
    }

    // A/B 등급 후보 조회 (서버 필터링)
    const { data: candidates, error } = await supabase
      .from("pullback_signals")
      .select(
        `
        code, entry_grade, entry_score,
        trend_grade, dist_grade, dist_pct, pivot_grade, vol_atr_grade,
        warn_grade, warn_score, ma21, ma50,
        stock:stocks!inner ( name, close )
      `
      )
      .eq("trade_date", latestDate)
      .in("entry_grade", ["A", "B"])
      .neq("warn_grade", "SELL")
      .order("entry_score", { ascending: false })
      .limit(15);

    if (error) {
      console.error("pullback query error:", error);
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "⚠️ 데이터 조회 중 오류가 발생했습니다.",
      });
      return;
    }

    if (!candidates || candidates.length === 0) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text:
          "📊 현재 눌림목 매집 조건(A/B 등급)에 해당하는 종목이 없습니다.\n" +
          "시장 전반적으로 과열 또는 하락 추세일 수 있습니다.",
      });
      return;
    }

    // A등급 먼저, 같은 등급이면 entry_score 내림차순
    candidates.sort((a: any, b: any) => {
      if (a.entry_grade !== b.entry_grade)
        return a.entry_grade === "A" ? -1 : 1;
      return (b.entry_score ?? 0) - (a.entry_score ?? 0);
    });

    // 메시지 생성
    const gradeEmoji: Record<string, string> = {
      A: "🟢",
      B: "🟡",
      C: "🔴",
    };
    const warnEmoji: Record<string, string> = {
      SAFE: "✅",
      WATCH: "👀",
      WARN: "⚠️",
      SELL: "🚨",
    };

    let msg = `🎯 *눌림목 매집 후보* (${latestDate})\n`;
    msg += `_매집 조건 A/B등급, 매도경고 제외_\n\n`;

    for (const s of candidates) {
      const stock = s.stock as any;
      const eg = gradeEmoji[s.entry_grade] ?? "";
      const wg = warnEmoji[s.warn_grade] ?? "";

      const close = stock.close
        ? Number(stock.close).toLocaleString()
        : "-";

      msg += `${eg} *${stock.name}* (${s.code})\n`;
      msg += `   현재가: ${close}원\n`;
      msg += `   진입 ${s.entry_grade}(${s.entry_score}/4)`;
      msg += ` | 경고 ${wg}${s.warn_grade}(${s.warn_score}/6)\n`;

      // 세부 등급
      const details: string[] = [];
      if (s.trend_grade) details.push(`추세:${s.trend_grade}`);
      if (s.dist_grade)
        details.push(`이격:${s.dist_grade}(${s.dist_pct ?? "-"}%)`);
      if (s.pivot_grade) details.push(`피봇:${s.pivot_grade}`);
      if (s.vol_atr_grade) details.push(`변동:${s.vol_atr_grade}`);
      if (details.length) msg += `   ${details.join(" · ")}\n`;

      msg += "\n";
    }

    msg += `_총 ${candidates.length}개 종목 | /score <코드>로 상세 확인_`;

    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: msg,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });
  } catch (e) {
    console.error("handlePullbackCommand error:", e);
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "⚠️ 눌림목 분석 중 오류가 발생했습니다.",
    });
  }
}
