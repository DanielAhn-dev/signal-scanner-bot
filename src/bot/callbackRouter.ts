import {
  getPromptPreset,
  resolveCallbackCommandText,
  resolveCallbackPrefixedCommandText,
} from "./commandCatalog";
import { buildAccessDeniedMessage, isAllowedTelegramUser } from "./accessControl";
import { handleRiskProfileSelection } from "./commands/onboarding";
import { handleReportMenu } from "./commands/report";
import { handleSectorDetailCommand } from "./commands/sector";
import type { ChatContext } from "./routing/types";
import { renderMenu } from "./menu/renderMenu";
import { routeMessage } from "./router";

export async function sendPromptForCommand(
  kind: string,
  chatId: number,
  tgSend: any
): Promise<void> {
  const preset = getPromptPreset(kind);
  if (!preset) {
    await tgSend("sendMessage", {
      chat_id: chatId,
      text: "지원하지 않는 입력 요청입니다.",
    });
    return;
  }

  await tgSend("sendMessage", {
    chat_id: chatId,
    text: `${preset.title}할 종목을 입력하세요.`,
    reply_markup: {
      force_reply: true,
      input_field_placeholder: preset.placeholder,
    },
  });
}

export async function routeCallbackData(
  data: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  if (!isAllowedTelegramUser(ctx)) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: buildAccessDeniedMessage(),
    });
    return;
  }

  if (data.startsWith("cmd:")) {
    const cmd = data.slice(4);
    // 일부 cmd 버튼은 하위 메뉴로 유도
    const menuRedirectMap: Record<string, string> = {
      report: "report",
      etf: "etf",
      autocycle: "autocycle",
      market: "market",
      brief: "briefing",
      weekly: "weekly",
      weeklycopilot: "weekly",
      watchlist: "watch",
      opsrun: "ops",
      opstrigger: "ops",
      tradelog: "tradehistory",
    };

    if (menuRedirectMap[cmd]) {
      await renderMenu(menuRedirectMap[cmd], ctx, tgSend);
      return;
    }

    if (cmd === "report") {
      await handleReportMenu(ctx, tgSend);
      return;
    }

    const resolved = resolveCallbackCommandText(cmd);
    if (resolved) {
      await routeMessage(resolved, ctx, tgSend);
      return;
    }
  }

  if (data.startsWith("prompt:")) {
    await sendPromptForCommand(data.slice(7), ctx.chatId, tgSend);
    return;
  }

  if (data.startsWith("menu:")) {
    const path = data.slice(5);
    await renderMenu(path, ctx, tgSend);
    return;
  }

  if (data.startsWith("risk:")) {
    const profile = data.slice(5);
    if (profile === "safe" || profile === "balanced" || profile === "active") {
      await handleRiskProfileSelection(profile, ctx, tgSend);
      return;
    }
  }

  const delimiter = data.indexOf(":");
  if (delimiter > 0) {
    const prefix = data.slice(0, delimiter);
    const payload = data.slice(delimiter + 1);

    if (prefix === "sector") {
      await handleSectorDetailCommand(payload, ctx, tgSend);
      return;
    }

    if (prefix === "strategy") {
      try {
        const { handleStrategyCallback } = await import("./commands/strategySelect.js");
        const supabaseModule = await import("@supabase/supabase-js");
        const {
          SUPABASE_URL,
          SUPABASE_SERVICE_ROLE_KEY,
          SUPABASE_ANON_KEY,
          SUPABASE_KEY,
        } = process.env;
        const supabaseKey =
          SUPABASE_SERVICE_ROLE_KEY || SUPABASE_KEY || SUPABASE_ANON_KEY;

        if (!SUPABASE_URL || !supabaseKey) {
          await tgSend("sendMessage", {
            chat_id: ctx.chatId,
            text: "⚠️ 전략 저장 설정이 누락되었습니다. 관리자에게 문의해주세요.",
          });
          return;
        }

        const supabase = supabaseModule.createClient(SUPABASE_URL, supabaseKey);
        await handleStrategyCallback(ctx, tgSend, supabase as any, payload);
        return;
      } catch (error) {
        console.error("[callbackRouter] strategy callback 처리 실패:", error);
        await tgSend("sendMessage", {
          chat_id: ctx.chatId,
          text: "⚠️ 전략 선택 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
        });
        return;
      }
    }

    const resolved = resolveCallbackPrefixedCommandText(prefix, payload);
    if (resolved) {
      await routeMessage(resolved, ctx, tgSend);
      return;
    }
  }

  if (data.startsWith("KRX:")) {
    await handleSectorDetailCommand(data, ctx, tgSend);
    return;
  }

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: "버튼 동작을 처리하지 못했습니다. 다시 시도해주세요.",
  });
}