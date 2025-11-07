// src/bot/router.ts
import { KO_MESSAGES } from "./messages/ko";
import { handleSectorCommand } from "./commands/sector";

export type ChatContext = { chatId: number; messageId?: number };

export async function routeMessage(
  text: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const t = text.trim();
  if (t === "/start") {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.START,
    });
    return;
  }
  if (t === "/help") {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.HELP,
    });
    return;
  }
  if (t === "/sector") {
    try {
      await handleSectorCommand(ctx, tgSend);
    } catch {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: KO_MESSAGES.SECTOR_ERROR,
      });
    }
    return;
  }
  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: KO_MESSAGES.UNKNOWN_COMMAND,
  });
}

export async function routeCallback(
  data: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  if (data.startsWith("sector:")) {
    const name = data.split(":").slice(1).join(":");
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `섹터 "${name}" 선택됨 (다음 단계에서 종목 리스트 표시)`,
    });
    return;
  }
  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: "알 수 없는 버튼입니다.",
  });
}
