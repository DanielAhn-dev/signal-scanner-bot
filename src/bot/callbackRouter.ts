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
import { parsePromotionCallback, recordStrategyDecision } from "../services/strategyPromotion";
import { createClient } from "@supabase/supabase-js";

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
  if (!(await isAllowedTelegramUser(ctx))) {
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
    if (profile === "safe" || profile === "balanced" || profile === "active" || profile === "value-swing") {
      await handleRiskProfileSelection(profile, ctx, tgSend);
      return;
    }
  }

  if (data.startsWith("my:")) {
    // MY 버튼 클릭: my:CODE:CONTEXT
    // 예: my:005930:buy, my:005930:brief
    const parts = data.slice(3).split(":");
    const code = parts[0];
    const context = parts[1] || "buy";
    
    if (!code) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "⚠️ 종목 정보를 찾을 수 없습니다.",
      });
      return;
    }

    try {
      const { buildPersonalizedGuidance } = await import("../services/personalizedGuidanceService.js");
      const { LINE } = await import("./messages/format.js");
      
      const contextType = context as "brief" | "scan" | "flow" | "buy" | "market" | "holding-plan" | "news" | "economy";
      const personalLines = await buildPersonalizedGuidance({
        chatId: ctx.chatId,
        focusCode: code,
        context: contextType,
      }).catch(() => []);

      if (personalLines.length === 0) {
        await tgSend("sendMessage", {
          chat_id: ctx.chatId,
          text: "개인화 정보가 없습니다.\n먼저 투자금과 위험도 설정을 완료해주세요.",
        });
        return;
      }

      let myMessage = `<b>${code} · 내 상황 제안</b>\n`;
      myMessage += personalLines.map((line) => `- ${line}`).join("\n");

      // context가 buy인 경우 추가로 투자금 기준 정보도 포함 가능
      if (contextType === "buy") {
        try {
          const { getUserInvestmentPrefs } = await import("../services/userService.js");
          const investPrefs = await getUserInvestmentPrefs(ctx.chatId);
          
          if (investPrefs && investPrefs.capital_krw && investPrefs.capital_krw > 0 && investPrefs.split_count && investPrefs.split_count > 0) {
            myMessage += `\n\n<b>내 투자금 기준</b>`;
            myMessage += `\n  투자금: ${investPrefs.capital_krw.toLocaleString()}원`;
            myMessage += `\n  분할 횟수: ${investPrefs.split_count}회`;
          }
        } catch {
          // 투자금 정보 조회 실패 시 무시
        }
      }

      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: myMessage,
        parse_mode: "HTML",
      });
    } catch (error) {
      console.error("[callbackRouter] MY 버튼 처리 실패:", error);
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "⚠️ 개인화 정보 조회 중 오류가 발생했습니다.",
      });
    }
    return;
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

    if (prefix === "discoverysrc") {
      try {
        const { handleDiscoveryProfileCallback } = await import("./commands/discoveryProfile.js");
        await handleDiscoveryProfileCallback(ctx, tgSend, payload);
        return;
      } catch (error) {
        console.error("[callbackRouter] discovery source callback 처리 실패:", error);
        await tgSend("sendMessage", {
          chat_id: ctx.chatId,
          text: "⚠️ 발굴 소스 설정 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
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

  // 전략 승격 승인·보류·해제 버튼 (관리자만)
  const promotion = parsePromotionCallback(data);
  if (promotion) {
    const adminId = Number(process.env.TELEGRAM_ADMIN_CHAT_ID);
    if (!Number.isFinite(adminId) || adminId !== ctx.chatId) {
      await tgSend("sendMessage", { chat_id: ctx.chatId, text: "전략 승격 결정은 관리자만 할 수 있습니다." });
      return;
    }
    // 결정 기록은 Storage 쓰기가 필요해 서비스 키를 쓴다 (src/db/client는 anon 키)
    const serviceSupabase = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
      auth: { persistSession: false },
    });
    const result = await recordStrategyDecision(serviceSupabase, {
      strategy: promotion.strategy,
      action: promotion.action,
      by: String(ctx.chatId),
      source: "telegram",
    }).catch((e: unknown) => ({ ok: false, message: `처리 실패: ${e instanceof Error ? e.message : String(e)}` }));
    await tgSend("sendMessage", { chat_id: ctx.chatId, text: result.message });
    return;
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