import { getMenuNode, type MenuNode } from "./menuTree";
import { actionButtons } from "../messages/layout";
import type { ChatContext } from "../routing/types";

export async function renderMenu(path: string, ctx: ChatContext, tgSend: any) {
  const node: MenuNode = (getMenuNode(path) ?? getMenuNode("") ) as MenuNode;
  const text = node.text ?? node.title ?? "메뉴를 선택하세요.";

  try {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text,
      reply_markup: actionButtons(node.buttons, 2),
    });
  } catch (err) {
    console.error("[renderMenu] sendMessage failed:", err);
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "메뉴를 표시하는 중 오류가 발생했습니다.",
    });
  }
}

export default renderMenu;
