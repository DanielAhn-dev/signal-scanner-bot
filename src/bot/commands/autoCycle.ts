import type { ChatContext } from "../router";
import {
  runVirtualAutoTradingForChat,
  type AutoTradeRunMode,
} from "../../services/virtualAutoTradeService";

function parseInput(rawInput: string): {
  mode: AutoTradeRunMode;
  dryRun: boolean;
} {
  const text = String(rawInput || "").trim().toLowerCase();
  const tokens = text.split(/\s+/).filter(Boolean);

  let mode: AutoTradeRunMode = "auto";
  let dryRun = true;

  for (const token of tokens) {
    if (["실행", "run", "live", "실매행"].includes(token)) {
      dryRun = false;
    }
    if (["테스트", "dry", "dryrun", "시험"].includes(token)) {
      dryRun = true;
    }
    if (["월", "월요일", "monday"].includes(token)) {
      mode = "monday";
    }
    if (["일", "daily", "주중", "데일리"].includes(token)) {
      mode = "daily";
    }
    if (["auto", "자동", "기본"].includes(token)) {
      mode = "auto";
    }
  }

  return { mode, dryRun };
}

function formatModeLabel(mode: AutoTradeRunMode): string {
  if (mode === "monday") return "월요일 매수";
  if (mode === "daily") return "일일 사이클";
  return "자동(실행 시점 재판단)";
}

export async function handleAutoCycleCommand(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const { mode, dryRun } = parseInput(input);

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: `자동 사이클 ${dryRun ? "테스트" : "실행"} 시작\n모드: ${formatModeLabel(mode)}`,
  });

  try {
    const result = await runVirtualAutoTradingForChat({
      chatId: ctx.chatId,
      mode,
      dryRun,
      ensureEnabled: true,
    });

    const action = result.action;
    const noteLines = (action.notes || []).slice(0, 5);

    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        `<b>자동 사이클 ${dryRun ? "테스트" : "실행"} 완료</b>`,
        `모드: ${formatModeLabel(mode)}`,
        `매수 ${action.buys}건 · 매도 ${action.sells}건 · 스킵 ${action.skipped}건 · 오류 ${action.errors}건`,
        noteLines.length ? `\n메모\n- ${noteLines.join("\n- ")}` : "",
        "\n재실행 예시:",
        "/자동사이클 테스트",
        "/자동사이클 실행",
        "/자동사이클 실행 daily",
      ].join("\n"),
      parse_mode: "HTML",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `자동 사이클 실행 실패: ${message}`,
    });
  }
}
