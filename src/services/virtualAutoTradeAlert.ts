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
