import type { ChatContext } from "../routing/types";
import {
  generateAutoTradeBacktestReportForChat,
} from "../../services/virtualAutoTradeService";
import {
  getUserInvestmentPrefs,
  setUserInvestmentPrefs,
} from "../../services/userService";

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function fmtKrw(value: number): string {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function resolvePreset(variant: "A" | "B") {
  if (variant === "B") {
    return { newBuy: 66, addOn: 62, rebalance: 64 };
  }
  return { newBuy: 62, addOn: 58, rebalance: 60 };
}

export async function handleAutoTrustCommand(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const tgId = ctx.from?.id ?? ctx.chatId;
  const raw = String(input || "").trim();
  const tokens = raw.split(/\s+/).filter(Boolean);

  if (!tokens.length) {
    const prefs = await getUserInvestmentPrefs(tgId);
    const variant = prefs.signal_trust_variant ?? "A";
    const preset = resolvePreset(variant === "B" ? "B" : "A");
    const newBuy = clamp(toNumber(prefs.signal_trust_new_buy, preset.newBuy), 0, 100);
    const addOn = clamp(toNumber(prefs.signal_trust_add_on, preset.addOn), 0, 100);
    const rebalance = clamp(toNumber(prefs.signal_trust_rebalance, preset.rebalance), 0, 100);

    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text:
        [
          "자동 신뢰도 설정",
          `- variant: ${variant}`,
          `- 신규진입: ${newBuy}`,
          `- 추가매수: ${addOn}`,
          `- 리밸런싱: ${rebalance}`,
          "",
          "사용법",
          "/신뢰도 A",
          "/신뢰도 B",
          "/신뢰도 62 58 60",
        ].join("\n"),
    });
    return;
  }

  const first = tokens[0].toUpperCase();
  if (first === "A" || first === "B") {
    const preset = resolvePreset(first as "A" | "B");
    await setUserInvestmentPrefs(tgId, {
      signal_trust_variant: first as "A" | "B",
      signal_trust_new_buy: preset.newBuy,
      signal_trust_add_on: preset.addOn,
      signal_trust_rebalance: preset.rebalance,
    });

    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `신뢰도 preset ${first} 적용 완료: 신규 ${preset.newBuy} · 추가 ${preset.addOn} · 리밸런싱 ${preset.rebalance}`,
    });
    return;
  }

  if (tokens.length >= 3) {
    const newBuy = clamp(toNumber(tokens[0], 62), 0, 100);
    const addOn = clamp(toNumber(tokens[1], 58), 0, 100);
    const rebalance = clamp(toNumber(tokens[2], 60), 0, 100);

    await setUserInvestmentPrefs(tgId, {
      signal_trust_variant: "CUSTOM",
      signal_trust_new_buy: newBuy,
      signal_trust_add_on: addOn,
      signal_trust_rebalance: rebalance,
    });

    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `신뢰도 CUSTOM 저장 완료: 신규 ${newBuy} · 추가 ${addOn} · 리밸런싱 ${rebalance}`,
    });
    return;
  }

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: "입력 형식이 올바르지 않습니다. 예: /신뢰도 A 또는 /신뢰도 62 58 60",
  });
}

export async function handleAutoShadowCommand(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const tgId = ctx.from?.id ?? ctx.chatId;
  const cmd = String(input || "status").trim().toLowerCase();

  if (["on", "켜", "켜기", "enable"].includes(cmd)) {
    await setUserInvestmentPrefs(tgId, { virtual_shadow_mode: true });
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "SHADOW 모드 ON: 자동사이클 실행 시에도 실반영 없이 신호만 기록합니다.\n(명령 별칭: /shadow on | /섀도우 on)",
    });
    return;
  }

  if (["off", "꺼", "끄기", "disable"].includes(cmd)) {
    await setUserInvestmentPrefs(tgId, { virtual_shadow_mode: false });
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "SHADOW 모드 OFF: 자동사이클 실행 시 실제 반영됩니다.\n(명령 별칭: /shadow off | /섀도우 off)",
    });
    return;
  }

  const prefs = await getUserInvestmentPrefs(tgId);
  const status = prefs.virtual_shadow_mode ? "ON" : "OFF";
  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: ["SHADOW 모드 상태", `- 현재: ${status}`, "- 설정: /shadow on | /shadow off", "- 한글 별칭: /섀도우 on | /섀도우 off"].join("\n"),
  });
}

export async function handleAutoBacktestCommand(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const tgId = ctx.from?.id ?? ctx.chatId;
  const months = String(input || "3").trim() === "6" ? 6 : 3;

  const report = await generateAutoTradeBacktestReportForChat({
    chatId: tgId,
    months,
  });

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: [
      `자동백테스트 ${report.months}개월`,
      `- 거래수: 총 ${report.totalTrades} (매수 ${report.buyTrades} / 매도 ${report.sellTrades})`,
      `- 실현손익: ${fmtKrw(report.realizedPnl)}`,
      `- 승률: ${report.winRatePct.toFixed(1)}%`,
      `- 평균 이익/손실: ${fmtKrw(report.avgWin)} / ${fmtKrw(report.avgLoss)}`,
      `- Profit Factor: ${report.profitFactor.toFixed(2)}`,
      `- 최대 연속손실: ${report.maxLossStreak}회`,
      "",
      "다음 명령",
      "- /신뢰도 A 또는 /신뢰도 B",
      "- /신뢰도 62 58 60",
      "- /shadow on",
    ].join("\n"),
  });
}
