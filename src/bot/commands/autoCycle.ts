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

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }

  if (!error || typeof error !== "object") {
    return String(error);
  }

  const rec = error as Record<string, unknown>;
  const messages = [
    rec.message,
    rec.description,
    rec.error,
    rec.details,
    rec.hint,
  ]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());

  if (messages.length > 0) {
    return messages.join(" | ");
  }

  try {
    const serialized = JSON.stringify(error);
    return serialized.length > 300 ? `${serialized.slice(0, 300)}...` : serialized;
  } catch {
    return "알 수 없는 객체 오류";
  }
}

function formatExecutionStatus(action: {
  buys: number;
  sells: number;
  skipped: number;
  errors: number;
}): string {
  if (action.errors > 0) return "판정: 실행 중 오류 발생";
  if (action.buys + action.sells > 0) return "판정: 정상 실행 완료";
  if (action.skipped > 0) return "판정: 조건 미충족으로 미체결";
  return "판정: 점검 완료";
}

function formatActionBreakdown(action: {
  buys: number;
  sells: number;
  skipped: number;
  errors: number;
}): string {
  return [
    `매수 ${action.buys}건`,
    `매도 ${action.sells}건`,
    `미체결 ${action.skipped}건`,
    `오류 ${action.errors}건`,
  ].join(" · ");
}

function buildFriendlyGuide(action: {
  buys: number;
  sells: number;
  skipped: number;
  errors: number;
  notes?: string[];
}, dryRun: boolean): string[] {
  const notes = action.notes || [];

  if (action.errors > 0) {
    return [
      "안내",
      "- 이번 회차는 실행 중 오류가 있었습니다.",
      "- 메모에 나온 실패 이유를 먼저 확인해 주세요.",
      "- 개발 중 점검은 /자동사이클 테스트 로 다시 확인하는 것이 안전합니다.",
    ];
  }

  if (action.buys + action.sells > 0) {
    return [
      "안내",
      dryRun
        ? "- 테스트 기준으로는 주문 조건이 충족됐습니다."
        : "- 정상 실행되었고 이번 회차에 실제 가상매매가 반영됐습니다.",
      "- 메모의 실행 매수/실행 매도 항목에서 종목과 가격을 확인할 수 있습니다.",
    ];
  }

  if (action.skipped > 0) {
    const hasStrategyBlock = notes.some((note) =>
      /전략|기존 포지션만 관리|신규 매수 중지|최소 진입/.test(note)
    );
    const hasNoCandidate = notes.some((note) => /후보 없음|미체결|현금 0원/.test(note));

    const lines = [
      "안내",
      "- 이번 회차는 오류 없이 정상 실행됐지만 조건이 맞지 않아 주문이 없었습니다.",
    ];

    if (hasStrategyBlock) {
      lines.push("- 현재는 선택된 전략 때문에 신규 매수가 제한된 상태입니다.");
    }
    if (hasNoCandidate) {
      lines.push("- 오늘 점수/현금/후보 조건상 체결 가능한 종목이 없었습니다.");
    }

    lines.push("- 개발 중 확인이라면 /자동사이클 테스트 와 /자동사이클 실행 daily 를 함께 보면 흐름을 파악하기 쉽습니다.");
    return lines;
  }

  return [
    "안내",
    "- 이번 회차는 점검만 완료됐습니다.",
    "- 추가 확인이 필요하면 /자동사이클 테스트 로 다시 실행해 보세요.",
  ];
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
    const noteLines = (action.notes || []).slice(0, 8);
    const guideLines = buildFriendlyGuide(action, dryRun);

    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        `<b>자동 사이클 ${dryRun ? "테스트" : "실행"} 완료</b>`,
        `모드: ${formatModeLabel(mode)}`,
        formatExecutionStatus(action),
        formatActionBreakdown(action),
        noteLines.length ? `\n메모\n- ${noteLines.join("\n- ")}` : "",
        guideLines.length ? `\n${guideLines.join("\n")}` : "",
        "\n재실행 예시:",
        "/자동사이클 테스트",
        "/자동사이클 실행",
        "/자동사이클 실행 daily",
      ].join("\n"),
      parse_mode: "HTML",
    });
  } catch (error: unknown) {
    const message = formatUnknownError(error);
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `자동 사이클 실행 실패: ${message}`,
    });
  }
}
