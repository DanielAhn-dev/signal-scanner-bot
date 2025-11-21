import type { ChatContext } from "../router";
import { createMultiRowKeyboard } from "../../telegram/keyboards";
import { getLeadersForSector } from "../../data/sector";
import { KO_MESSAGES } from "../messages/ko";

export async function handleStocksCommand(
  sectorName: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const leaders = await getLeadersForSector(sectorName, 10);

  if (!leaders?.length) {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.STOCKS_EMPTY,
    });
  }

  // 상위 5개 종목 버튼 생성
  // 버튼 텍스트: "삼성전자 (005930)" 형태
  const buttons = leaders.slice(0, 6).map((stock) => ({
    text: `${stock.name}`,
    callback_data: `score:${stock.code}`,
  }));

  // 메시지 포맷 개선
  const message = [
    `🏭 *${sectorName}* 섹터 대장주`,
    `💡 _시가총액 및 거래대금 상위 종목입니다._`,
    `👇 *종목을 선택하여 상세 분석(Score)을 확인하세요.*`,
  ].join("\n");

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: message,
    parse_mode: "Markdown",
    reply_markup: createMultiRowKeyboard(2, buttons),
  });
}
