import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatContext } from "../router";
import { actionButtons } from "../messages/layout";

export async function handleStrategySelect(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const strategies = [
    { id: "HOLD_SAFE", label: "안전 포지셀", description: "보수 운용, 무보유 시 1종목만 최소 진입" },
    { id: "REDUCE_TIGHT", label: "타이트 손절", description: "손절 2%, 익절 4%" },
    { id: "WAIT_AND_DIP_BUY", label: "매수 기회 대기", description: "현금 보유, 저가 진입 대기" },
  ];

  const messageText = [
    "<b>위험 대응 전략 선택</b>",
    "",
    "현재 시장 위험도에 따라 자동매매 규칙이 조정됩니다.",
    "",
    ...strategies.map((s) => `<b>${s.label}</b>\n${s.description}`).join("\n\n"),
    "",
    "버튼을 선택하세요.",
  ].join("\n");

  const buttons = strategies.map((s) => ({
    text: s.label,
    callback_data: `strategy:${s.id}`,
  }));

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: messageText,
    parse_mode: "HTML",
    reply_markup: actionButtons(buttons, 1),
  });
}

export async function handleStrategyCallback(
  ctx: ChatContext,
  tgSend: any,
  supabase: SupabaseClient,
  strategy: string
): Promise<void> {
  const validStrategies = ["HOLD_SAFE", "REDUCE_TIGHT", "WAIT_AND_DIP_BUY"];

  if (!validStrategies.includes(strategy)) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "지원하지 않는 전략입니다.",
    });
    return;
  }

  try {
    const chatId = ctx.chatId;
    const today = new Date().toISOString().split("T")[0];

    // 1. virtual_autotrade_settings 업데이트
    const { error: updateError } = await supabase
      .from("virtual_autotrade_settings")
      .update({ selected_strategy: strategy })
      .eq("chat_id", chatId);

    if (updateError) {
      console.error("[strategySelect] Settings 업데이트 실패:", updateError);
      await tgSend("sendMessage", {
        chat_id: chatId,
        text: "⚠️ 전략 저장 중 오류가 발생했습니다.",
      });
      return;
    }

    // 2. risk_signal_actions 저장 (로그용)
    await supabase.from("risk_signal_actions").upsert({
      chat_id: chatId,
      signal_date: today,
      strategy_selected: strategy,
      created_at: new Date().toISOString(),
    });

    const strategyLabel: Record<string, string> = {
      HOLD_SAFE: "안전 포지셀",
      REDUCE_TIGHT: "타이트 손절",
      WAIT_AND_DIP_BUY: "매수 기회 대기",
    };

    const strategyDesc: Record<string, string> = {
      HOLD_SAFE: "보수 운용, 무보유 시 상위 후보 1종목만 진입",
      REDUCE_TIGHT: "손절 2%, 익절 4%로 강화됨",
      WAIT_AND_DIP_BUY: "신규 매수 중단, 저가 기회 대기",
    };

    await tgSend("sendMessage", {
      chat_id: chatId,
      text: [
        `✅ 전략이 변경되었습니다.`,
        ``,
        `📊 선택된 전략`,
        `<b>${strategyLabel[strategy]}</b>`,
        `${strategyDesc[strategy]}`,
        ``,
        `이제부터 자동매매가 선택된 전략에 따라 조정됩니다.`,
      ].join("\n"),
      parse_mode: "HTML",
    });
  } catch (error) {
    console.error("[strategySelect] 콜백 처리 실패:", error);
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "⚠️ 전략 선택 중 오류가 발생했습니다.",
    });
  }
}
