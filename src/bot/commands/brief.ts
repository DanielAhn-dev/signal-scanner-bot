import type { ChatContext } from "../router";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

function safeNumberFormat(n: any) {
  if (n == null) return "-";
  const num = Number(n);
  if (Number.isNaN(num)) return String(n);
  return num.toLocaleString();
}

export async function handleBriefCommand(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  try {
    // 최신 asof 날짜 조회 (scores 테이블에 여러 날짜 데이터 존재 가능)
    const { data: latestScoreDate } = await supabase
      .from("scores")
      .select("asof")
      .order("asof", { ascending: false })
      .limit(1);
    const latestAsof = latestScoreDate?.[0]?.asof;
    if (!latestAsof) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "\u26a0\ufe0f 스코어 데이터가 아직 없습니다. 데이터 수집 후 다시 시도해주세요.",
      });
      return;
    }

    // --- 1) 가치주: scores 테이블 기준 조회 ---
    const { data: valueData, error: errVs } = await supabase
      .from("scores")
      .select(
        `
        value_score,
        stock:stocks!inner ( code, name, close, universe_level )
      `
      )
      .eq("asof", latestAsof)
      .eq("stock.universe_level", "core")
      .gt("value_score", 60)
      .order("value_score", { ascending: false })
      .limit(5);

    if (errVs) console.error("가치주 조회 에러:", errVs);

    // 데이터 매핑
    const valueStocks = valueData?.map((item: any) => ({
      name: item.stock.name,
      code: item.stock.code,
      close: item.stock.close,
      value_score: item.value_score,
    }));

    // --- 2) 모멘텀주: scores 테이블 기준 조회 ---
    const { data: momentumData, error: errMs } = await supabase
      .from("scores")
      .select(
        `
        momentum_score,
        stock:stocks!inner ( code, name, close, universe_level )
      `
      )
      .eq("asof", latestAsof)
      .eq("stock.universe_level", "core")
      .gt("momentum_score", 60)
      .order("momentum_score", { ascending: false })
      .limit(5);

    if (errMs) console.error("모멘텀주 조회 에러:", errMs);

    const momentumStocks = momentumData?.map((item: any) => ({
      name: item.stock.name,
      code: item.stock.code,
      close: item.stock.close,
      momentum_score: item.momentum_score,
    }));

    // --- 3) 눌림목 매집 후보: factors.entry_grade A/B ---
    const { data: pullbackData, error: errPb } = await supabase
      .from("scores")
      .select(
        `
        code, factors,
        stock:stocks!inner ( name, close, universe_level )
      `
      )
      .eq("asof", latestAsof)
      .not("factors", "is", null);

    if (errPb) console.error("눌림목 조회 에러:", errPb);

    const pullbackStocks = (pullbackData || [])
      .filter((item: any) => {
        const f = item.factors;
        if (!f || !f.entry_grade) return false;
        if (f.entry_grade !== "A" && f.entry_grade !== "B") return false;
        if (f.warn_grade === "SELL") return false;
        return true;
      })
      .sort((a: any, b: any) => {
        const ga = a.factors.entry_grade === "A" ? 0 : 1;
        const gb = b.factors.entry_grade === "A" ? 0 : 1;
        if (ga !== gb) return ga - gb;
        return (b.factors.entry_score ?? 0) - (a.factors.entry_score ?? 0);
      })
      .slice(0, 5)
      .map((item: any) => ({
        name: item.stock.name,
        code: item.code,
        close: item.stock.close,
        entry_grade: item.factors.entry_grade,
        entry_score: item.factors.entry_score,
        warn_grade: item.factors.warn_grade,
      }));

    // --- 4) 메시지 생성 ---
    let msg = `🌅 *[08:30] 장전 대형주 브리핑*\n_(실패 없는 Core 유니버스)_\n\n`;

    msg += `💎 *저평가 가치주 (Value)*\n`;
    if (!valueStocks || valueStocks.length === 0) {
      msg += `_추천 종목이 없습니다._\n`;
    } else {
      valueStocks.forEach((s: any) => {
        msg += `- ${s.name} (${s.code}): ${safeNumberFormat(s.close)}원\n`;
      });
    }

    msg += `\n🚀 *수급 주도주 (Momentum)*\n`;
    if (!momentumStocks || momentumStocks.length === 0) {
      msg += `_추천 종목이 없습니다._\n`;
    } else {
      momentumStocks.forEach((s: any) => {
        msg += `- ${s.name} (${s.code}): ${safeNumberFormat(s.close)}원\n`;
      });
    }

    msg += `\n🎯 *눌림목 매집 후보 (Pullback)*\n`;
    if (!pullbackStocks || pullbackStocks.length === 0) {
      msg += `_매집 조건 충족 종목 없음_\n`;
    } else {
      const ge: Record<string, string> = { A: "🟢", B: "🟡" };
      const we: Record<string, string> = { SAFE: "✅", WATCH: "👀", WARN: "⚠️" };
      pullbackStocks.forEach((s: any) => {
        const eg = ge[s.entry_grade] ?? "";
        const wg = we[s.warn_grade] ?? "";
        msg += `${eg} ${s.name} (${s.code}) ${s.entry_grade}(${s.entry_score}/4) ${wg}\n`;
      });
    }

    msg += `\n👇 종목명을 클릭하거나 \`/score <종목코드>\` 명령어로 상세 확인\n`;
    msg += `📊 눌림목 전체 목록: /pullback`;

    // --- 4) Telegram 전송 ---
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: msg,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });
  } catch (e) {
    console.error("handleBriefCommand 실패:", e);
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "⚠️ 브리핑 중 오류가 발생했습니다.",
    });
  }
}
