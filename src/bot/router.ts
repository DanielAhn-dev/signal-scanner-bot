// src/bot/router.ts
import { KO_MESSAGES } from "./messages/ko";
import { handleSectorCommand } from "./commands/sector";
import { handleStocksCommand } from "./commands/stocks";
import { handleScoreCommand } from "./commands/score";
import { setCommandsKo } from "../telegram/api";

export type ChatContext = { chatId: number; messageId?: number };

export async function routeMessage(
  text: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const t = text.trim();

  // 기본

  if (t === "/start") {
    await setCommandsKo();
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.START,
    });
  }
  if (t === "/help")
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.HELP,
    });

  // 섹터(한글 별칭 포함)
  if (t === "/sector" || t === "/섹터") return handleSectorCommand(ctx, tgSend);

  // 종목 리스트(섹터 인자) - 영어/한글
  if (t.startsWith("/stocks ") || t.startsWith("/종목 ")) {
    const sectorName = t.replace(/^\/(stocks|종목)\s+/, "").trim();
    if (!sectorName)
      return tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "사용법: /stocks <섹터명>",
      });
    return handleStocksCommand(sectorName, ctx, tgSend);
  }

  // 점수(영어/한글, 인자 없는 케이스 처리)
  if (t === "/score" || t === "/점수") {
    return tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "사용법: /score <이름|코드>",
    });
  }
  if (t.startsWith("/score ") || t.startsWith("/점수 ")) {
    const q = t.replace(/^\/(score|점수)\s+/, "").trim();
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
  if (data.startsWith("stocks:") || data.startsWith("score:")) {
    const code = data.split(":").slice(1).join(":");
    return handleScoreCommand(code, ctx, tgSend);
  }
  return tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: "알 수 없는 버튼입니다.",
  });
}
