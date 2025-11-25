import type { ChatContext } from "../router";
import { createMultiRowKeyboard } from "../../telegram/keyboards";
import { createClient } from "@supabase/supabase-js";
import { fmtKRW } from "../../lib/normalize";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

const fmtPrice = (n: number) => n.toLocaleString("ko-KR");
const fmtChange = (n: number) => {
  if (n > 0) return `🔴 +${n.toFixed(1)}%`;
  if (n < 0) return `🔵 ${n.toFixed(1)}%`;
  return `⚪ 0.0%`;
};

export async function handleStocksCommand(
  sectorKeyword: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  // 1. 데이터 조회
  const { data: stocks, error } = await supabase
    .from("stocks")
    .select(
      `
      code, name, close, change_rate, value_traded, universe_level,
      scores ( value_score, momentum_score, total_score )
    `
    )
    .ilike("sector", `%${sectorKeyword}%`)
    .in("universe_level", ["core", "extended"])
    .order("value_traded", { ascending: false })
    .limit(10);

  if (error || !stocks || stocks.length === 0) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `🔍 '${sectorKeyword}' 섹터의 **대형/우량주**를 찾을 수 없습니다.\n(검색어가 정확한지 확인해주세요)`,
      parse_mode: "Markdown",
    });
    return;
  }

  // 2. 리스트 생성
  const top5 = stocks.slice(0, 5);

  const listText = top5
    .map((s: any, idx) => {
      // 'any'로 타입 유연성 확보 (또는 정확한 interface 정의 필요)
      const rank = idx + 1;
      const icon = s.universe_level === "core" ? "💎" : "🏢";

      // [수정] scores가 배열일 수도, 객체일 수도 있는 상황 대응
      // Supabase 응답이 [{ value_score: ... }] 형태일 수 있음
      const scoreData = Array.isArray(s.scores) ? s.scores[0] : s.scores;

      const tags: string[] = [];
      // scoreData가 존재할 때만 점수 체크
      if (scoreData) {
        if ((scoreData.value_score || 0) >= 30) tags.push("🟢V");
        if ((scoreData.momentum_score || 0) >= 30) tags.push("🚀M");
      }
      const tagStr = tags.length ? ` [${tags.join("+")}]` : "";

      return [
        `${rank}. ${icon} *${s.name}*${tagStr}`,
        `   └ \`${fmtPrice(s.close)}원\` (${fmtChange(s.change_rate)})`,
        `   └ 💰 거래대금: ${fmtKRW(s.value_traded)}`,
      ].join("\n");
    })
    .join("\n\n");

  const header = `🏭 *${sectorKeyword}* 주도주 현황\n💡 _대형주(Core) 및 유동성 상위 종목_`;
  const footer = `👇 *버튼을 눌러 상세 진단(매수 타점)을 확인하세요.*`;

  const message = [header, "", listText, "", footer].join("\n");

  // 3. 버튼 생성
  const buttons = stocks.map((s) => {
    const sign = s.change_rate > 0 ? "+" : "";
    return {
      text: `${s.name} ${sign}${s.change_rate.toFixed(1)}%`,
      callback_data: `score:${s.code}`,
    };
  });

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: message,
    parse_mode: "Markdown",
    reply_markup: createMultiRowKeyboard(2, buttons),
  });
}
