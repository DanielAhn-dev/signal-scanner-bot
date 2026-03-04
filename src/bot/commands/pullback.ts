// src/bot/commands/pullback.ts
// 눌림목 매집 시그널 조회 커맨드

import type { ChatContext } from "../router";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

/**
 * /pullback — 눌림목 매집 후보 종목 조회
 *
 * scores.factors JSONB에 저장된 pullback 시그널을 기반으로
 * entry_grade A/B 종목 중 warn_grade가 SELL이 아닌 종목을 표시.
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

    // 최신 asof 조회
    const { data: latestRow } = await supabase
      .from("scores")
      .select("asof")
      .order("asof", { ascending: false })
      .limit(1);

    const latestAsof = latestRow?.[0]?.asof;
    if (!latestAsof) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "⚠️ 스코어 데이터가 없습니다. 데이터 수집 후 다시 시도해주세요.",
      });
      return;
    }

    // factors에 entry_grade가 있는 전체 스코어 로드
    const { data: allScores, error } = await supabase
      .from("scores")
      .select(
        `
        code, score, factors, momentum_score,
        stock:stocks!inner ( name, close, sector_id, universe_level )
      `
      )
      .eq("asof", latestAsof)
      .not("factors", "is", null);

    if (error) {
      console.error("pullback query error:", error);
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "⚠️ 데이터 조회 중 오류가 발생했습니다.",
      });
      return;
    }

    if (!allScores || allScores.length === 0) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "⚠️ 스코어 데이터가 없습니다.",
      });
      return;
    }

    // 필터: entry_grade A 또는 B + warn_grade가 SELL이 아닌 것
    const candidates = allScores
      .filter((s: any) => {
        const f = s.factors;
        if (!f || !f.entry_grade) return false;
        if (f.entry_grade !== "A" && f.entry_grade !== "B") return false;
        if (f.warn_grade === "SELL") return false;
        return true;
      })
      .sort((a: any, b: any) => {
        // A등급 우선, 같은 등급이면 entry_score 내림차순
        const gradeOrder: Record<string, number> = { A: 0, B: 1 };
        const ga = gradeOrder[a.factors.entry_grade] ?? 2;
        const gb = gradeOrder[b.factors.entry_grade] ?? 2;
        if (ga !== gb) return ga - gb;
        return (b.factors.entry_score ?? 0) - (a.factors.entry_score ?? 0);
      })
      .slice(0, 15);

    if (candidates.length === 0) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text:
          "📊 현재 눌림목 매집 조건(A/B 등급)에 해당하는 종목이 없습니다.\n" +
          "시장 전반적으로 과열 또는 하락 추세일 수 있습니다.",
      });
      return;
    }

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

    let msg = `🎯 *눌림목 매집 후보* (${latestAsof})\n`;
    msg += `_매집 조건 A/B등급, 매도경고 제외_\n\n`;

    for (const s of candidates) {
      const stock = s.stock as any;
      const f = s.factors as any;

      const eg = gradeEmoji[f.entry_grade] ?? "";
      const wg = warnEmoji[f.warn_grade] ?? "";

      const close = stock.close
        ? Number(stock.close).toLocaleString()
        : "-";

      msg += `${eg} *${stock.name}* (${s.code})\n`;
      msg += `   현재가: ${close}원 | 종합: ${s.score}점\n`;
      msg += `   진입 ${f.entry_grade}(${f.entry_score}/4)`;
      msg += ` | 경고 ${wg}${f.warn_grade}(${f.warn_score}/6)\n`;

      // 세부 등급
      const details: string[] = [];
      if (f.trend_grade) details.push(`추세:${f.trend_grade}`);
      if (f.dist_grade) details.push(`이격:${f.dist_grade}(${f.dist_pct ?? "-"}%)`);
      if (f.pivot_grade) details.push(`피봇:${f.pivot_grade}`);
      if (f.vol_atr_grade) details.push(`변동:${f.vol_atr_grade}`);
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
