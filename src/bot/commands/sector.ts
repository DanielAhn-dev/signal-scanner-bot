// src/bot/commands/sector.ts
import type { ChatContext } from "../router";
import { createMultiRowKeyboard } from "../../telegram/keyboards";
import {
  getTopSectorsRealtime,
  getTopSectors,
  computeSectorTrends,
} from "../../data/sector";

export async function handleSectorCommand(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  let tops = await getTopSectorsRealtime(8);
  if (!tops?.length) tops = await getTopSectors(8);
  if (!tops?.length) tops = await computeSectorTrends(10);
  if (!tops?.length) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "섹터 데이터 부족으로 거래대금 상위 종목을 표시합니다.",
    });
    return;
  }
  const buttons = tops.map((s) => ({
    text: `${s.sector} (${s.score}점)`,
    callback_data: `sector:${s.sector}`,
  }));
  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: "유망 섹터:",
    reply_markup: createMultiRowKeyboard(2, buttons),
  });
}
