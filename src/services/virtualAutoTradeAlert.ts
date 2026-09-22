import {
  ACTIONS,
  buildRecommendationActionButtons,
  type RecommendationActionTarget,
} from "../bot/messages/layout";
import type { InlineButton } from "../telegram/keyboards";

const EXECUTION_NOTE_PATTERN = /\[(?:실행 매수|실행 추가매수)\]\s+[^()]+\(([0-9A-Z]+)\)|\[(?:실행 매도|실행 부분익절)\]\s+([0-9A-Z]+)/;

export function pickExecutionLines(notes: string[]): string[] {
  return notes
    .filter((note) => /^\[(실행 매수|실행 추가매수|실행 매도|실행 부분익절)\]/.test(note))
    .slice(0, 5);
}

export function extractExecutionTargets(notes: string[]): RecommendationActionTarget[] {
  const seen = new Set<string>();
  const targets: RecommendationActionTarget[] = [];

  for (const note of pickExecutionLines(notes)) {
    const matched = note.match(EXECUTION_NOTE_PATTERN);
    const code = String(matched?.[1] ?? matched?.[2] ?? "").trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    targets.push({
      code,
      label: `${code} 분석`,
    });
  }

  return targets;
}

export function buildAutoTradeExecutionButtons(notes: string[]): InlineButton[] {
  return buildRecommendationActionButtons(
    extractExecutionTargets(notes),
    ACTIONS.autoCycleExecutionFollowup
  );
}

function pickCycleHoldReason(notes: string[]): string {
  const priorityPatterns = [
    /^\[복구모드\]/,
    /^\[레짐게이트\]/,
    /일손실 한도 도달/,
    /신규 매수 보류: 현금 하한 유지 구간/,
    /신규 매수 불가:/,
    /매수 후보 없음/,
  ];

  for (const pattern of priorityPatterns) {
    const note = notes.find((item) => pattern.test(item));
    if (note) return note;
  }

  return notes.find((note) => /^시장모드:/.test(note)) ?? "매수·매도 조건 미충족";
}

/** 체결이 없는 정규 자동사이클의 수동 추종 상태를 알린다. */
export function buildAutoTradeCycleHoldAlert(input: {
  runKey: string;
  action: { buys: number; sells: number; skipped: number; errors: number; notes: string[] };
}): string | null {
  const { action } = input;
  if (action.buys + action.sells > 0 || action.errors > 0) return null;

  const lines = [
    "[장중 자동판단]",
    `실행창 ${input.runKey}`,
    "결론: 이번 회차에 MTS로 따라 할 매수·매도 주문은 없습니다.",
    `판단: 매수 ${action.buys} · 매도 ${action.sells} · 보류 ${action.skipped}`,
    `사유: ${pickCycleHoldReason(action.notes ?? [])}`,
  ];

  if (action.notes.some((note) => note.startsWith("[유휴현금 스윕]"))) {
    lines.push("참고: CD금리/KOFR 스윕은 가상 유휴현금 파킹이며 MTS 추종 주문 대상이 아닙니다.");
  }

  lines.push("다음 정규 자동판단에서 조건을 다시 확인합니다.");
  return lines.join("\n");
}
