import { createClient } from "@supabase/supabase-js";
import type { ChatContext } from "../routing/types";
import {
  generateAutoTradeBacktestReportForChat,
} from "../../services/virtualAutoTradeService";
import {
  getUserInvestmentPrefs,
  setUserInvestmentPrefs,
} from "../../services/userService";
import { syncScoresFromEngine } from "../../services/scoreSyncService";
import { actionButtons } from "../messages/layout";

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

type AutoTriggerStep = {
  key: "intraday-1" | "intraday-2" | "ready-1" | "ready-2";
  label: string;
  /** HTTP 크론 경로 (path 또는 inlineRun 중 하나 사용) */
  path?: string;
  /** Supabase 서비스를 직접 인라인 실행 (HTTP 자기호출 대신) */
  inlineRun?: () => Promise<string>;
  nextCallback?: string;
  nextLabel?: string;
};

function resolveBaseUrl(): string {
  const raw = String(process.env.BASE_URL || process.env.VERCEL_URL || "").trim();
  if (!raw) return "";
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

function trimBody(text: string, maxLen = 220): string {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "(empty body)";
  return normalized.length > maxLen ? `${normalized.slice(0, maxLen)}...` : normalized;
}

function resolveAutoTriggerStep(input: string): AutoTriggerStep | "menu" | null {
  const text = String(input || "").trim().toLowerCase();
  if (!text || ["menu", "메뉴", "도움", "help"].includes(text)) return "menu";

  const isNext = ["다음", "next", "2", "2단계", "step2"].some((k) => text.includes(k));
  const isIntraday = ["장중", "intraday", "실행"].some((k) => text.includes(k));
  const isReady = ["장전", "ready", "준비", "프리마켓"].some((k) => text.includes(k));

  if (isIntraday) {
    if (isNext) {
      return {
        key: "intraday-2",
        label: "장중 2/2 자동사이클",
        path: "/api/cron/virtualAutoTrade?mode=auto&dryRun=false&intradayOnly=true&windowMinutes=50",
      };
    }
    return {
      key: "intraday-1",
      label: "장중 1/2 점수 동기화",
      inlineRun: makeScoreSyncRunner(),
      nextCallback: "cmd:autotrigger:intraday:next",
      nextLabel: "다음 2/2 장중 자동사이클",
    };
  }

  if (isReady) {
    if (isNext) {
      return {
        key: "ready-2",
        label: "장전 2/2 브리핑",
        path: "/api/cron/briefing?type=pre_market",
      };
    }
    return {
      key: "ready-1",
      label: "장전 1/2 점수 동기화",
      inlineRun: makeScoreSyncRunner(),
      nextCallback: "cmd:autotrigger:ready:next",
      nextLabel: "다음 2/2 장전 브리핑",
    };
  }

  return null;
}

/**
 * scoreSync를 백그라운드에서 비동기로 실행하는 팩토리
 * - 호출자에게 즉시 반환 ("백그라운드 진행 중")
 * - 실제 동기화는 fire-and-forget으로 뒤에서 실행
 * - Telegram 타임아웃 방지
 */
function makeScoreSyncRunner(): () => Promise<string> {
  return async () => {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      // 즉시 반환: 환경변수 없으면 "스킵"이라고 응답
      return "(동기화 설정 없음)";
    }
    
    // 백그라운드 비동기 실행 (기다리지 않음)
    syncScoresFromEngine(
      createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } }),
      { fastMode: true }
    ).catch((err) => {
      console.error("[autotrigger] background score sync failed:", err);
    });
    
    // 호출자에게 즉시 반환
    return "백그라운드 동기화 진행 중...";
  };
}

async function executeAutoTriggerStep(
  baseUrl: string,
  cronSecret: string,
  step: AutoTriggerStep
): Promise<{ status: number; body: string }> {
  // inlineRun: HTTP 자기호출 대신 서비스 함수 직접 실행
  if (step.inlineRun) {
    const body = await step.inlineRun();
    return { status: 200, body };
  }

  if (!step.path) {
    throw new Error("step.path 또는 step.inlineRun 중 하나는 필수");
  }

  const timeoutMs = 55000; // intradayOnly 모드의 순차 처리 시간 고려 (Vercel maxDuration=60초)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}${step.path}`, {
      method: "GET",
      headers: { authorization: `Bearer ${cronSecret}` },
      signal: controller.signal,
    });
    const body = await res.text().catch(() => "");
    return { status: res.status, body: trimBody(body) };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`ops trigger timeout (${timeoutMs}ms)`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function handleAutoTriggerCommand(
  input: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const step = resolveAutoTriggerStep(input);
  if (step === "menu") {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        "순차 트리거 메뉴",
        "- 1요청 1응답 방식으로 단계별 실행합니다.",
        "- 1단계 완료 후 다음 버튼으로 2단계를 실행하세요.",
        "",
        "명령 예시:",
        "/자동트리거 장중",
        "/자동트리거 장중 다음",
        "/자동트리거 장전",
        "/자동트리거 장전 다음",
      ].join("\n"),
      reply_markup: actionButtons(
        [
          { text: "장중 1/2", callback_data: "cmd:autotrigger:intraday" },
          { text: "장전 1/2", callback_data: "cmd:autotrigger:ready" },
        ],
        2
      ),
    });
    return;
  }

  if (!step) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "사용법: /자동트리거 [장중|장전] [다음]",
    });
    return;
  }

  const baseUrl = resolveBaseUrl();
  const cronSecret = String(process.env.CRON_SECRET || "").trim();
  if (!baseUrl || !cronSecret) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "자동트리거 설정이 누락되었습니다. BASE_URL/CRON_SECRET 환경변수를 확인해주세요.",
    });
    return;
  }

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: `⏳ ${step.label} 실행 중...`,
  });

  try {
    const result = await executeAutoTriggerStep(baseUrl, cronSecret, step);
    const ok = result.status >= 200 && result.status < 300;
    const statusLabel = ok ? "성공" : "실패";
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        statusLabel,
        `${step.label} | HTTP ${result.status}`,
        `↳ ${result.body}`,
      ].join("\n"),
      reply_markup:
        ok && step.nextCallback && step.nextLabel
          ? actionButtons([{ text: step.nextLabel, callback_data: step.nextCallback }], 1)
          : undefined,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: ["실패", `${step.label}`, `↳ ${message}`].join("\n"),
    });
  }
}
