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
    if (["테스트", "dry", "dryrun", "시험", "점검", "리뷰", "check"].includes(token)) {
      dryRun = true;
    }
    if (["월", "월요일", "monday", "진입", "entry", "매수"].includes(token)) {
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

function buildModeGuide(mode: AutoTradeRunMode): string[] {
  if (mode === "daily") {
    return [
      "모드 설명",
      "- daily 는 구버전 별칭입니다.",
      "- 지금은 /자동사이클 점검 또는 /자동사이클 실행 으로 쓰는 편이 더 명확합니다.",
    ];
  }
  if (mode === "monday") {
    return [
      "모드 설명",
      "- 진입 모드는 신규 진입 판단을 강제로 한 번 실행합니다.",
      "- 주간 첫 진입이나 재진입 점검이 필요할 때만 쓰면 됩니다.",
    ];
  }
  return [
    "모드 설명",
    "- 기본 모드는 오늘 기준 통합판단입니다.",
    "- /자동사이클 점검은 시뮬레이션, /자동사이클 실행은 실제 반영으로 이해하면 됩니다.",
  ];
}

function buildCommandExamples(mode: AutoTradeRunMode): string[] {
  if (mode === "monday") {
    return [
      "/자동사이클 점검 진입",
      "/자동사이클 실행 진입",
      "/자동사이클 실행",
    ];
  }

  return [
    "/자동사이클 점검",
    "/자동사이클 실행",
    "/자동사이클 실행 진입",
  ];
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

function prioritizeNotes(notes: string[]): string[] {
  const uniqueNotes = Array.from(new Set(notes.filter(Boolean)));
  const priorityRules: Array<{ pattern: RegExp; score: number }> = [
    { pattern: /실행 매수|실행 매도|테스트 매수안|테스트 매도/i, score: 120 },
    { pattern: /일일판단 요약|보유 현황|보유 종목 .* 유지/i, score: 110 },
    { pattern: /전략:|전략 유지|신규 매수 중지|기존 포지션만 관리|최소 진입|제한 진입|보수 분산/i, score: 100 },
    { pattern: /후보 없음|후보 0건|상위점수|대체선별|기준 완화/i, score: 90 },
    { pattern: /투자 가능 현금 0원|현금 부족|가상현금 보정/i, score: 80 },
    { pattern: /사이징 기준|분할 1\//i, score: 70 },
  ];

  const scored = uniqueNotes.map((note, index) => {
    const matched = priorityRules.find((rule) => rule.pattern.test(note));
    return {
      note,
      score: matched?.score ?? 10,
      index,
    };
  });

  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 8)
    .map((item) => item.note);
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
      "- 다시 확인할 때는 /자동사이클 점검 으로 보는 편이 가장 안전합니다.",
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
      /전략|기존 포지션만 관리|신규 매수 중지|최소 진입|제한 진입|보수 분산/.test(note)
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

    lines.push("- 보통은 /자동사이클 점검 으로 먼저 보고, 괜찮으면 /자동사이클 실행 으로 반영하면 됩니다.");
    return lines;
  }

  const hasHoldSummary = notes.some((note) => /보유 종목 .* 유지|일일판단 요약: 보유유지/i.test(note));
  const hasPositionStatus = notes.some((note) => /보유 현황:/i.test(note));

  if (hasHoldSummary || hasPositionStatus) {
    return [
      "안내",
      "- 이번 회차는 보유 종목이 익절/손절 조건에 닿지 않아 유지 중심으로 끝났습니다.",
      "- 신규 매수는 후보, 현금, 전략 조건이 함께 맞아야만 실행됩니다.",
      "- 메모의 보유 현황, 후보 수, 전략 제한 문구를 먼저 확인해 주세요.",
    ];
  }

  return [
    "안내",
    "- 이번 회차는 점검만 완료됐습니다.",
    "- 추가 확인이 필요하면 /자동사이클 점검 으로 다시 보면 됩니다.",
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
    const noteLines = prioritizeNotes(action.notes || []);
    const guideLines = buildFriendlyGuide(action, dryRun);
    const modeGuideLines = buildModeGuide(mode);
    const commandExamples = buildCommandExamples(mode);

    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        `<b>자동 사이클 ${dryRun ? "테스트" : "실행"} 완료</b>`,
        `모드: ${formatModeLabel(mode)}`,
        formatExecutionStatus(action),
        formatActionBreakdown(action),
        noteLines.length ? `\n메모\n- ${noteLines.join("\n- ")}` : "",
        modeGuideLines.length ? `\n${modeGuideLines.join("\n")}` : "",
        guideLines.length ? `\n${guideLines.join("\n")}` : "",
        "\n재실행 예시:",
        ...commandExamples,
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
