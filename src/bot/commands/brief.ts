import type { ChatContext } from "../router";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

export async function handleBriefCommand(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  // 1. 가치주 (Core + PER낮음 + 저평가)
  const { data: valueStocks } = await supabase
    .from("stocks")
    .select("name, close, code, scores!inner(value_score)")
    .eq("universe_level", "core")
    .gt("scores.value_score", 60) // 고득점 가치주
    .limit(5);

  // 2. 모멘텀주 (Core + 수급/추세 좋음)
  const { data: momentumStocks } = await supabase
    .from("stocks")
    .select("name, close, code, scores!inner(momentum_score)")
    .eq("universe_level", "core")
    .gt("scores.momentum_score", 60)
    .limit(5);

  let msg = `🌅 **[08:30] 장전 대형주 브리핑**\n_(실패 없는 Core 유니버스)_ \n\n`;

  msg += `💎 **저평가 가치주 (Value)**\n`;
  valueStocks?.forEach(
    (s) => (msg += `- ${s.name}: ${s.close.toLocaleString()}원\n`)
  );

  msg += `\n🚀 **수급 주도주 (Momentum)**\n`;
  momentumStocks?.forEach(
    (s) => (msg += `- ${s.name}: ${s.close.toLocaleString()}원\n`)
  );

  msg += `\n👇 종목명을 클릭하거나 /stocks 명령어로 상세 확인`;

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: msg,
    parse_mode: "Markdown",
  });
}
