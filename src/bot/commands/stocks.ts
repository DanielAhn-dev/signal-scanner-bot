// src/bot/commands/stocks.ts

import type { ChatContext } from "../router";
import { createMultiRowKeyboard } from "../../telegram/keyboards";
import { getLeadersForSector } from "../../data/sector";
import { KO_MESSAGES } from "../messages/ko";

export async function handleStocksCommand(
  sectorName: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  // ✅ leaders는 이제 { code, name }[] 타입
  const leaders = await getLeadersForSector(sectorName, 10);

  if (!leaders?.length) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.STOCKS_EMPTY,
    });
    return;
  }

  // ✅ leaders 배열을 바로 사용해서 버튼 생성
  const buttons = leaders.slice(0, 5).map((stock) => ({
    text: `${stock.name} (${stock.code})`, // 이름(코드) 형식
    callback_data: `score:${stock.code}`, // /score {코드} 호출
  }));

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: `섹터 "${sectorName}" 대장주 후보:`,
    reply_markup: createMultiRowKeyboard(2, buttons),
  });
}
