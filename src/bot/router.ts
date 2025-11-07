// src/bot/router.ts
import { KO_MESSAGES } from "./messages/ko";
import { handleSectorCommand } from "./commands/sector";
import { handleScoreCommand } from "./commands/score"; // 추가

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

  // /score, /점수 매핑 (띄어쓰기/인자 없는 경우 안내)
  const m = t.match(/^\/(score|점수)\s+(.+)$/);
  if (m) {
    await handleScoreCommand(m[2], ctx, tgSend);
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
  // score 재계산 콜백
  if (data.startsWith("score:")) {
    const code = data.split(":")[1] || "";
    if (code) await handleScoreCommand(code, ctx, tgSend);
    return;
  }

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: "알 수 없는 버튼입니다.",
  });
}
