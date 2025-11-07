// src/bot/commands/stocks.ts
import type { ChatContext } from "../router";
import { createMultiRowKeyboard } from "../../telegram/keyboards";
import { getLeadersForSector } from "../../data/sector";
import { getNamesForCodes } from "../../search/normalize";
import { KO_MESSAGES } from "../messages/ko";

export async function handleStocksCommand(
  sectorName: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const codes = await getLeadersForSector(sectorName, 10);
  if (!codes?.length) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.STOCKS_EMPTY,
    });
    return;
  }
  const nameMap = await getNamesForCodes(codes);
  const buttons = codes
    .slice(0, 5)
    .map((c) => ({ text: `${nameMap[c] || c}`, callback_data: `stocks:${c}` }));
  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: `섹터 "${sectorName}" 대장주 후보:`,
    reply_markup: createMultiRowKeyboard(2, buttons),
  });
}
