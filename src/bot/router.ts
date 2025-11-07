// src/bot/router.ts
import { KO_MESSAGES } from "./messages/ko";
import { handleSectorCommand } from "./commands/sector";
import { handleStocksCommand } from "./commands/stocks";
import { handleScoreCommand } from "./commands/score";

export type ChatContext = { chatId: number; messageId?: number };

export async function routeMessage(
  text: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const t = text.trim();
  if (t === "/start")
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.START,
    });
  if (t === "/help")
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.HELP,
    });
  if (t === "/sector") return handleSectorCommand(ctx, tgSend);
  if (t.startsWith("/stocks ")) {
    const sectorName = t.replace("/stocks ", "").trim();
    if (!sectorName)
      return tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "사용법: /stocks <섹터명>",
      });
    return handleStocksCommand(sectorName, ctx, tgSend);
  }
  if (t.startsWith("/score ")) {
    const q = t.replace("/score ", "").trim();
    if (!q)
      return tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "사용법: /score <이름|코드>",
      });
    return handleScoreCommand(q, ctx, tgSend);
  }
  return tgSend("sendMessage", {
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
    return handleStocksCommand(name, ctx, tgSend);
  }
  if (data.startsWith("stocks:")) {
    const code = data.split(":").slice(1).join(":");
    return handleScoreCommand(code, ctx, tgSend);
  }
  if (data.startsWith("score:")) {
    const code = data.split(":").slice(1).join(":");
    return handleScoreCommand(code, ctx, tgSend);
  }
  return tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: "알 수 없는 버튼입니다.",
  });
}
