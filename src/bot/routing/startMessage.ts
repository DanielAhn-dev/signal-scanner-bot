import { getUserInvestmentPrefs } from "../../services/userService";
import { ACTIONS, actionButtons } from "../messages/layout";
import { renderMenu } from "../menu/renderMenu";
import type { ChatContext } from "./types";

function riskProfileLabel(profile?: "safe" | "balanced" | "active"): string {
  if (profile === "balanced") return "균형형";
  if (profile === "active") return "공격형";
  return "안전형";
}

export async function sendStartMessage(ctx: ChatContext, tgSend: any): Promise<void> {
  const prefs = await getUserInvestmentPrefs(ctx.from?.id ?? ctx.chatId);
  const hasSetup = Boolean(prefs.capital_krw);

  // 렌더링은 공통 메뉴 트리 사용: 기본은 `menu:root`
  await renderMenu("root", ctx, tgSend);
}
