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
    // --- 1) 가치주: scores 테이블 기준 조회 ---
    const { data: valueData, error: errVs } = await supabase
      .from("scores")
      .select(
        `
        value_score,
        stock:stocks!inner ( code, name, close, universe_level )
      `
      )
      .eq("stock.universe_level", "core") // [수정] alias를 'stock'으로 줬으므로 stock.universe_level
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
      .eq("stock.universe_level", "core") // [수정] alias 사용
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

    // --- 3) 메시지 생성 ---
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

    msg += `\n👇 종목명을 클릭하거나 \`/score <종목코드>\` 명령어로 상세 확인`;

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
