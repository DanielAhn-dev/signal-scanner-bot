import { createMultiRowKeyboard, type InlineButton } from "../../telegram/keyboards";
import { esc, LINE } from "./format";

export type RecommendationActionTarget = {
  code: string;
  label: string;
};

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

export function buildRecommendationActionButtons(
  targets: RecommendationActionTarget[],
  extras: InlineButton[] = []
): InlineButton[] {
  const seen = new Set<string>();
  const out: InlineButton[] = [];

  for (const target of targets) {
    const code = String(target.code ?? "").trim();
    if (!code) continue;
    const callbackData = `trade:${code}`;
    if (seen.has(callbackData)) continue;
    seen.add(callbackData);
    out.push({ text: target.label, callback_data: callbackData });
  }

  for (const button of extras) {
    const key = String(button.callback_data ?? button.text ?? "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(button);
  }

  return out;
}

export const ACTIONS = {
  autoCycleMenu: [
    { text: "자동 점검", callback_data: "cmd:autocycle:check" },
    { text: "자동 실행", callback_data: "cmd:autocycle:run" },
    { text: "진입 점검", callback_data: "cmd:autocycle:entry-check" },
    { text: "진입 실행", callback_data: "cmd:autocycle:entry-run" },
  ] as InlineButton[],
  autoCycleQuick: [
    { text: "자동 점검", callback_data: "cmd:autocycle:check" },
    { text: "자동 실행", callback_data: "cmd:autocycle:run" },
  ] as InlineButton[],
  tradeHistoryFilters: [
    { text: "이번 달", callback_data: "cmd:tradelog:month" },
    { text: "지난달", callback_data: "cmd:tradelog:last-month" },
    { text: "최근 7일", callback_data: "cmd:tradelog:recent-7" },
    { text: "전체", callback_data: "cmd:tradelog:all" },
  ] as InlineButton[],
  etfHub: [
    { text: "적립형", callback_data: "cmd:etf:core" },
    { text: "테마형", callback_data: "cmd:etf:theme" },
    { text: "NAV/괴리율", callback_data: "prompt:etfinfo" },
    { text: "분배금", callback_data: "prompt:etfdiv" },
    { text: "TOP5", callback_data: "cmd:etf:top" },
  ] as InlineButton[],
  reportMenu: [
    { text: "주간", callback_data: "cmd:report:full" },
    { text: "월간", callback_data: "cmd:report:monthly" },
    { text: "실전운용", callback_data: "cmd:report:playbook" },
    { text: "추천", callback_data: "cmd:report:추천" },
    { text: "가이드", callback_data: "cmd:report:guide" },
    { text: "포트폴리오", callback_data: "cmd:report:portfolio" },
    { text: "거시", callback_data: "cmd:report:economy" },
    { text: "수급", callback_data: "cmd:report:flow" },
    { text: "섹터", callback_data: "cmd:report:sector" },
  ] as InlineButton[],
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
    { text: "관심", callback_data: "cmd:watchonly" },
    { text: "보유", callback_data: "cmd:watchlist" },
    { text: "관심대응", callback_data: "cmd:watchonlyresp" },
    { text: "보유대응", callback_data: "cmd:watchresp" },
    { text: "추천", callback_data: "cmd:report:추천" },
    { text: "눌림목", callback_data: "cmd:pullback" },
    { text: "시장", callback_data: "cmd:market" },
  ] as InlineButton[],
  recommendationFollowup: [
    { text: "눌림목", callback_data: "cmd:pullback" },
    { text: "코스피", callback_data: "cmd:kospi" },
    { text: "코스닥", callback_data: "cmd:kosdaq" },
    { text: "시장", callback_data: "cmd:market" },
  ] as InlineButton[],
  recommendationFollowupCompact: [
    { text: "추천", callback_data: "cmd:report:추천" },
    { text: "눌림목", callback_data: "cmd:pullback" },
    { text: "시장", callback_data: "cmd:market" },
  ] as InlineButton[],
  promptAnalyze: [
    { text: "종목분석", callback_data: "prompt:trade" },
    { text: "재무", callback_data: "prompt:finance" },
    { text: "뉴스", callback_data: "prompt:news" },
  ] as InlineButton[],
  marketFlowWithPromptFlow: [
    { text: "종목 수급", callback_data: "prompt:flow" },
    { text: "시장", callback_data: "cmd:market" },
    { text: "수급", callback_data: "cmd:flow" },
    { text: "경제", callback_data: "cmd:economy" },
    { text: "브리핑", callback_data: "cmd:brief" },
  ] as InlineButton[],
  marketFlowWithPromptNews: [
    { text: "종목 뉴스", callback_data: "prompt:news" },
    { text: "시장", callback_data: "cmd:market" },
    { text: "수급", callback_data: "cmd:flow" },
    { text: "경제", callback_data: "cmd:economy" },
    { text: "브리핑", callback_data: "cmd:brief" },
  ] as InlineButton[],
  analyzeStock: (code: string) =>
    [
      { text: "종목분석", callback_data: `trade:${code}` },
      { text: "재무", callback_data: `finance:${code}` },
      { text: "뉴스", callback_data: `news:${code}` },
      { text: "관심추가", callback_data: `watchadd:${code}` },
    ] as InlineButton[],
  analyzeStockWithRecalc: (code: string) =>
    [
      { text: "재분석", callback_data: `trade:${code}` },
      { text: "종목분석", callback_data: `trade:${code}` },
      { text: "재무", callback_data: `finance:${code}` },
      { text: "뉴스", callback_data: `news:${code}` },
      { text: "관심추가", callback_data: `watchadd:${code}` },
    ] as InlineButton[],
  analyzeEtf: (code: string) =>
    [
      { text: "NAV", callback_data: `etfinfo:${code}` },
      { text: "분배금", callback_data: `etfdiv:${code}` },
      { text: "적립형", callback_data: "cmd:etf:core" },
      { text: "테마형", callback_data: "cmd:etf:theme" },
      { text: "TOP5", callback_data: "cmd:etf:top" },
    ] as InlineButton[],
};
