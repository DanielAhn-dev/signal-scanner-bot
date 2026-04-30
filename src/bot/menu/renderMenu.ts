import { getMenuNode, type MenuNode } from "./menuTree";
import { actionButtons } from "../messages/layout";
import type { ChatContext } from "../routing/types";

const CALLBACK_DATA_MAX = 64;

function sanitizeButtons(buttons: { text: string; callback_data: string }[]) {
  const seen = new Set<string>();
  const out: { text: string; callback_data: string }[] = [];
  for (const b of buttons) {
    const cb = String(b.callback_data ?? "");
    if (!cb) continue;
    if (cb.length > CALLBACK_DATA_MAX) {
      console.warn("[renderMenu] callback_data too long, skipping:", cb);
      continue;
    }
    if (seen.has(cb)) continue;
    seen.add(cb);
    out.push({ text: b.text, callback_data: cb });
  }
  return out;
}

export async function renderMenu(path: string, ctx: ChatContext, tgSend: any) {
  const node: MenuNode = (getMenuNode(path) ?? getMenuNode("")) as MenuNode;
  const text = node.text ?? node.title ?? "메뉴를 선택하세요.";

  const buttons = sanitizeButtons(node.buttons);
  const reply_markup = actionButtons(buttons, 2);

  try {
    // Prefer editing existing message if messageId is available (better UX)
    if (ctx.messageId) {
      try {
        await tgSend("editMessageText", {
          chat_id: ctx.chatId,
          message_id: ctx.messageId,
          text,
          reply_markup,
        });
        return;
      } catch (e) {
        // some messages may not allow editMessageText (e.g., media messages) — fallback to reply markup edit
        console.warn("[renderMenu] editMessageText failed, falling back to editMessageReplyMarkup:", e);
        try {
          await tgSend("editMessageReplyMarkup", {
            chat_id: ctx.chatId,
            message_id: ctx.messageId,
            reply_markup,
          });
          return;
        } catch (er) {
          console.error("[renderMenu] editMessageReplyMarkup fallback failed:", er);
        }
      }
    }

    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text,
      reply_markup,
    });
  } catch (err) {
    console.error("[renderMenu] send/edit message failed:", err);
    try {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "메뉴를 표시하는 중 오류가 발생했습니다.",
      });
    } catch (e) {
      console.error("[renderMenu] fallback sendMessage failed:", e);
    }
  }
}

export { sanitizeButtons };
export default renderMenu;
