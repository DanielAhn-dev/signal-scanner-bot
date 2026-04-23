import { KO_MESSAGES } from "./messages/ko";
import { CMD, normalizeIncomingMessageText } from "./routing/commandPatterns";
import { dispatchCommandRoutes } from "./routing/dispatcher";
import { sendStartMessage } from "./routing/startMessage";
import type { ChatContext } from "./routing/types";

export type { ChatContext };

// router.ts는 수동 텍스트 명령만 처리합니다.
// 아침 자동 브리핑(장전 오전 8시)은 api/cron/briefing.ts 에서 처리합니다.
export async function routeMessage(
  text: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const normalized = normalizeIncomingMessageText(text);

  if (CMD.START.test(normalized)) {
    await sendStartMessage(ctx, tgSend);
    return;
  }

  const handled = await dispatchCommandRoutes(normalized, ctx, tgSend);
  if (handled) return;

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: KO_MESSAGES.UNKNOWN_COMMAND,
  });
}
