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
    // --- 1) 가치주: Join으로 한 번에 조회 (핵심 수정) ---
    // stocks 테이블과 scores 테이블을 Join하여,
    // universe_level이 'core'이면서 value_score가 60 이상인 종목을 직접 찾음
    const { data: valueStocks, error: errVs } = await supabase
      .from("stocks")
      .select(
        `
        code, 
        name, 
        close,
        scores!inner ( value_score )
      `
      )
      .eq("universe_level", "core")
      .gt("scores.value_score", 60)
      .limit(5);

    if (errVs) console.error("가치주 조회 에러:", errVs);

    // --- 2) 모멘텀주: 동일하게 Join으로 조회 ---
    const { data: momentumStocks, error: errMs } = await supabase
      .from("stocks")
      .select(
        `
        code, 
        name, 
        close,
        scores!inner ( momentum_score )
      `
      )
      .eq("universe_level", "core")
      .gt("scores.momentum_score", 60)
      .limit(5);

    if (errMs) console.error("모멘텀주 조회 에러:", errMs);

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
