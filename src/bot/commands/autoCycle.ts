import type { ChatContext } from "../router";
import {
  runVirtualAutoTradingForChat,
  type AutoTradeRunMode,
  type AutoTradeRecentMetrics,
} from "../../services/virtualAutoTradeService";

function parseInput(rawInput: string): {
  mode: AutoTradeRunMode;
  dryRun: boolean;
  verbose: boolean;
} {
  const text = String(rawInput || "").trim().toLowerCase();
  const tokens = text.split(/\s+/).filter(Boolean);

  let mode: AutoTradeRunMode = "auto";
  let dryRun = true;
  let verbose = false;

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
    if (["상세", "detail", "verbose", "전체"].includes(token)) {
      verbose = true;
    }
  }

  return { mode, dryRun, verbose };
}

function buildMetricsComparisonLines(
  action: { buys: number; sells: number; skipped: number; errors: number },
  metrics: AutoTradeRecentMetrics | null
): string[] {
  if (!metrics || metrics.runCount <= 0) return [];

  const avgBuy = metrics.buyActions / metrics.runCount;
  const avgSell = metrics.sellActions / metrics.runCount;
  const avgSkip = metrics.skipActions / metrics.runCount;
  const avgErr = metrics.errorActions / metrics.runCount;

  const toDiff = (current: number, avg: number): string => {
    const diff = current - avg;
    if (Math.abs(diff) < 0.01) return "= 평균";
    return diff > 0 ? `+${diff.toFixed(2)} (평균 대비)` : `${diff.toFixed(2)} (평균 대비)`;
  };

  return [
    "데이터 비교(이번 회차 vs 최근 실행당 평균)",
    `- 매수 ${action.buys}건 vs ${avgBuy.toFixed(2)}건 (${toDiff(action.buys, avgBuy)})`,
    `- 매도 ${action.sells}건 vs ${avgSell.toFixed(2)}건 (${toDiff(action.sells, avgSell)})`,
    `- 미체결 ${action.skipped}건 vs ${avgSkip.toFixed(2)}건 (${toDiff(action.skipped, avgSkip)})`,
    `- 오류 ${action.errors}건 vs ${avgErr.toFixed(2)}건 (${toDiff(action.errors, avgErr)})`,
  ];
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

function buildRunModeDifferenceGuide(mode: AutoTradeRunMode, dryRun: boolean): string[] {
  const runLabel = dryRun ? "점검" : "실행";
  const modeLabel = mode === "monday"
    ? "진입(신규 진입 판단 강제)"
    : mode === "daily"
      ? "일일 대응(보유 중심)"
      : "자동(요일 기준 재판단)";

  return [
    "실행 해석",
    `- 이번 요청: ${runLabel} + ${modeLabel}`,
    "- /자동사이클 실행: 오늘 기준으로 실제 반영",
    "- /자동사이클 실행 진입: 요일과 무관하게 신규 진입 판단을 강제 실행",
    "- /자동사이클 점검: 실제 반영 없이 동일 로직 시뮬레이션",
  ];
}

function buildActionResponseCards(notes: string[]): string[] {
  const cards: string[] = [];
  const parseRiskAmount = (note: string): number => {
    const matched = note.match(/예상손실\s+([0-9,]+)원/);
    if (!matched) return 0;
    const value = Number(matched[1].replace(/,/g, ""));
    return Number.isFinite(value) ? value : 0;
  };

  const buyNotes = notes.filter((note) => /\[(실행|테스트) 매수안?\]|\[(실행|테스트) 추가매수안?\]/.test(note));
  const sellNotes = notes.filter((note) => /\[(실행|테스트) 매도안?\]|\[(실행|테스트) 부분익절안?\]/.test(note));
  const holdNotes = notes.filter((note) => /보유 현황|보유 종목 .* 유지|일일판단 요약/.test(note));
  const sizingNotes = notes.filter((note) => /사이징 기준|매수가 기준/.test(note));
  const responseGuides = notes
    .filter((note) => note.startsWith("[대응가이드]"))
    .map((note) => {
      const isNewBuy = note.startsWith("[대응가이드][신규매수]");
      const isAddOnBuy = note.startsWith("[대응가이드][추가매수]");
      const priority = isNewBuy ? 300 : isAddOnBuy ? 200 : 100;
      const riskAmount = parseRiskAmount(note);
      return {
        note,
        priority,
        riskAmount,
      };
    })
    .sort((a, b) => b.priority - a.priority || b.riskAmount - a.riskAmount)
    .slice(0, 3)
    .map((item) => item.note);

  if (buyNotes.length > 0) {
    cards.push("매수 카드");
    cards.push(`- 체결/후보: ${buyNotes.length}건`);
    cards.push(`- ${buyNotes[0]}`);
    cards.push("- 대응: /보유대응 으로 익절/손절/추가매수 기준 점검");
  }

  if (sellNotes.length > 0) {
    cards.push("매도 카드");
    cards.push(`- 체결/후보: ${sellNotes.length}건`);
    cards.push(`- ${sellNotes[0]}`);
    cards.push("- 대응: 남은 포지션은 /자동사이클 점검 으로 재평가");
  }

  if (holdNotes.length > 0) {
    cards.push("보유 카드");
    cards.push(`- ${holdNotes[0]}`);
    cards.push("- 대응: 급변장에서는 /자동매도점검 우선 실행");
  }

  if (sizingNotes.length > 0) {
    cards.push("사이징/가격 카드");
    cards.push(`- ${sizingNotes[0]}`);
    cards.push("- 해석: 회당 예산과 가격 기준을 보고 수량 과대진입 여부 확인");
  }

  if (responseGuides.length > 0) {
    cards.push("종목 대응 카드");
    cards.push("- 정렬 기준: 신규매수 우선, 동률이면 예상손실 큰 종목 우선");
    for (const guide of responseGuides) {
      cards.push(`- ${guide}`);
    }
    cards.push("- 대응 원칙: 기준가 이탈 시 분할 대응, 익절/손절 라인 미리 지정");
  }

  return cards;
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

function buildThreeLineSummary(input: {
  action: { buys: number; sells: number; skipped: number; errors: number };
  metrics: AutoTradeRecentMetrics | null;
  notes: string[];
}): string[] {
  const { action, metrics, notes } = input;
  const line1 = `결과: 매수 ${action.buys}건 · 매도 ${action.sells}건 · 미체결 ${action.skipped}건 · 오류 ${action.errors}건`;

  const SKIP_REASON_KO: Record<string, string> = {
    "insufficient-cash": "현금부족",
    "no-available-cash": "가용현금없음",
    "cash-reserve-floor": "현금하한도달",
    "strategy-blocked-buy": "전략차단",
    "hold-safe-probe": "안전탐색보류",
    "no-candidates": "후보없음",
    "market-policy-filtered": "시장정책필터",
    "daily-loss-limit-reached": "일손실한도",
  };

  const topReasons = (metrics?.topSkipReasons ?? []).slice(0, 2);
  const line2 = topReasons.length
    ? `상위사유: ${topReasons
        .map((item) => `${SKIP_REASON_KO[item.reason] ?? item.reason} ${item.count}건`)
        .join(" · ")}`
    : "상위사유: 없음";

  const hasExecuted = action.buys + action.sells > 0;
  const hasDailyLimitNote = notes.some((note) => /일손실 한도 도달/.test(note));
  const hasCandidateDrop = notes.some((note) => /후보 필터링|후보 탈락 상위/.test(note));
  const line3 = hasExecuted
    ? "다음액션: /보유대응 으로 익절·손절 기준 점검"
    : hasDailyLimitNote
      ? "다음액션: 일손실 한도 회복까지 신규 진입 중단"
      : hasCandidateDrop
        ? "다음액션: /자동사이클 점검 상세로 필터 단계 확인"
        : "다음액션: /자동사이클 점검 상세로 원인 확인";

  return [line1, line2, line3];
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
      /선택 전략으로 신규 매수 중지|기존 포지션만 관리|안전 전략 유지|최소 진입|제한 진입|보수 분산/.test(note)
    );
    const hasNoCandidate = notes.some((note) => /후보 없음|미체결|현금 0원|현금 부족으로 매수 스킵|최소주문/.test(note));

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

function buildRecentMetricsLines(metrics: AutoTradeRecentMetrics | null): string[] {
  if (!metrics) return [];

  const lines = [
    `최근 ${metrics.windowDays}일 지표`,
    `- 실행 ${metrics.runCount}회 · 액션발생일 ${metrics.activeDays}일`,
    `- 매수 ${metrics.buyActions}건 · 매도 ${metrics.sellActions}건 · 미체결 ${metrics.skipActions}건 · 오류 ${metrics.errorActions}건`,
  ];

  if (metrics.topSkipReasons.length > 0) {
    const SKIP_REASON_KO: Record<string, string> = {
      "insufficient-cash": "현금부족",
      "no-available-cash": "가용현금없음",
      "cash-reserve-floor": "현금하한도달",
      "strategy-blocked-buy": "전략차단",
      "hold-safe-probe": "안전탐색보류",
      "no-candidates": "후보없음",
      "market-policy-filtered": "시장정책필터",
      "daily-loss-limit-reached": "일손실한도",
      "invalid-holding-or-price": "보유/가격오류",
      "within-range": "목표범위내",
      "stop-loss": "손절",
      "take-profit-partial": "부분익절",
      "take-profit-final": "최종익절",
    };
    lines.push(
      `- 미체결 상위 사유: ${metrics.topSkipReasons
        .map((item) => `${SKIP_REASON_KO[item.reason] ?? item.reason} ${item.count}건`)
        .join(", ")}`
    );
  }

  return lines;
}

export async function handleAutoCycleCommand(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const { mode, dryRun, verbose } = parseInput(input);

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
    const modeDifferenceGuide = buildRunModeDifferenceGuide(mode, dryRun);
    const actionCards = buildActionResponseCards(action.notes || []);
    const commandExamples = buildCommandExamples(mode);
    const recentMetricsLines = buildRecentMetricsLines(result.recentMetrics);
    const metricsComparisonLines = buildMetricsComparisonLines(action, result.recentMetrics);

    const compactLines = [
      `<b>자동 사이클 ${dryRun ? "테스트" : "실행"} 완료</b>`,
      `모드: ${formatModeLabel(mode)}`,
      ...buildThreeLineSummary({
        action,
        metrics: result.recentMetrics,
        notes: action.notes || [],
      }),
      noteLines.length ? `\n핵심 메모\n- ${noteLines.slice(0, 3).join("\n- ")}` : "",
      "\n팁: 상세 설명은 /자동사이클 점검 상세",
    ].filter(Boolean);

    const detailedLines = [
      ...compactLines,
      modeDifferenceGuide.length ? `\n${modeDifferenceGuide.join("\n")}` : "",
      actionCards.length ? `\n${actionCards.join("\n")}` : "",
      modeGuideLines.length ? `\n${modeGuideLines.join("\n")}` : "",
      guideLines.length ? `\n${guideLines.join("\n")}` : "",
      "\n재실행 예시:",
      ...commandExamples,
    ].filter(Boolean);

    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: (verbose ? detailedLines : compactLines).join("\n"),
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
