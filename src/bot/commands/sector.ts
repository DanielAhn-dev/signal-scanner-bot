// src/bot/commands/sector.ts
import { createMultiRowKeyboard } from "../../telegram/keyboards";

export async function handleSectorCommand(
  ctx: { chatId: number },
  tgSend: any
): Promise<void> {
  // 샘플 버튼(다음 단계에서 실데이터 Quiet Spike 비중 Top으로 교체)
  const sectors = ["반도체", "2차전지", "바이오"];
  const buttons = sectors.map((name) => ({
    text: name,
    callback_data: `sector:${name}`,
  }));
  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: "유망 섹터(샘플):",
    reply_markup: createMultiRowKeyboard(2, buttons),
  });
}
