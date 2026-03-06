import { createMultiRowKeyboard, type InlineButton } from "../../telegram/keyboards";
import { esc, LINE } from "./format";

export function header(title: string, subtitle?: string): string {
  const lines = [`<b>${esc(title)}</b>`, LINE];
  if (subtitle) lines.push(`<i>${esc(subtitle)}</i>`);
  return lines.join("\n");
}

export function section(title: string, lines: string[]): string {
  const body = lines.filter(Boolean).join("\n");
  return [`<b>${esc(title)}</b>`, body].filter(Boolean).join("\n");
}

export function bullets(lines: string[]): string[] {
  return lines.filter(Boolean).map((x) => `• ${x}`);
}

export function divider(): string {
  return LINE;
}

export function buildMessage(blocks: Array<string | undefined | null>): string {
  return blocks
    .filter((b): b is string => Boolean(b && b.trim()))
    .join("\n\n");
}

export function actionButtons(buttons: InlineButton[], cols = 2) {
  return createMultiRowKeyboard(cols, buttons);
}

export const ACTIONS = {
  marketFlow: [
    { text: "시장", callback_data: "cmd:market" },
    { text: "수급", callback_data: "cmd:flow" },
    { text: "경제", callback_data: "cmd:economy" },
    { text: "브리핑", callback_data: "cmd:brief" },
  ] as InlineButton[],
  marketHub: [
    { text: "경제", callback_data: "cmd:economy" },
    { text: "수급", callback_data: "cmd:flow" },
    { text: "섹터", callback_data: "cmd:sector" },
    { text: "스캔", callback_data: "cmd:scan" },
  ] as InlineButton[],
  briefing: [
    { text: "점수", callback_data: "prompt:score" },
    { text: "매수", callback_data: "prompt:buy" },
    { text: "뉴스", callback_data: "prompt:news" },
    { text: "수급", callback_data: "prompt:flow" },
    { text: "눌림목", callback_data: "cmd:pullback" },
    { text: "시장", callback_data: "cmd:market" },
  ] as InlineButton[],
  analyzeStock: (code: string) =>
    [
      { text: "점수", callback_data: `score:${code}` },
      { text: "매수", callback_data: `buy:${code}` },
      { text: "재무", callback_data: `finance:${code}` },
      { text: "뉴스", callback_data: `news:${code}` },
      { text: "관심추가", callback_data: `watchadd:${code}` },
    ] as InlineButton[],
};
