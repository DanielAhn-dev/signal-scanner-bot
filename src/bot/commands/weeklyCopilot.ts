import type { ChatContext } from "../router";
import { getUserInvestmentPrefs, setUserInvestmentPrefs } from "../../services/userService";
import { handleBriefCommand } from "./brief";
import { handlePreMarketPlanCommand } from "./preMarketPlan";
import { handleWatchlistResponseCommand } from "./watchlist";
import { ACTIONS, actionButtons } from "../messages/layout";

type WeeklyCopilotDeps = {
  getPrefs: typeof getUserInvestmentPrefs;
  setPrefs: typeof setUserInvestmentPrefs;
  runBrief: typeof handleBriefCommand;
  runPreMarket: typeof handlePreMarketPlanCommand;
  runWatchResponse: typeof handleWatchlistResponseCommand;
};

const DEFAULT_DEPS: WeeklyCopilotDeps = {
  getPrefs: getUserInvestmentPrefs,
  setPrefs: setUserInvestmentPrefs,
  runBrief: handleBriefCommand,
  runPreMarket: handlePreMarketPlanCommand,
  runWatchResponse: handleWatchlistResponseCommand,
};

function buildSetupGuideText(): string {
  return [
    "<b>주간 코파일럿 시작 전 설정이 필요합니다.</b>",
    "",
    "1) 투자성향을 먼저 저장하세요.",
    "2) 투자금을 입력하면 수량 계산이 개인화됩니다.",
    "",
    "예시: /투자금 300만원 3 8 안전형 5",
  ].join("\n");
}

function toKstDateKey(date = new Date()): string {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isSameKstDate(aIso?: string, b = new Date()): boolean {
  if (!aIso) return false;
  const a = new Date(aIso);
  if (Number.isNaN(a.getTime())) return false;
  return toKstDateKey(a) === toKstDateKey(b);
}

function formatKstDateTime(iso?: string): string {
  if (!iso) return "기록 없음";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "기록 없음";
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(kst.getUTCDate()).padStart(2, "0");
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const mm = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm} KST`;
}

function modeLabel(mode?: "normal" | "forced"): string {
  if (mode === "forced") return "강제";
  if (mode === "normal") return "일반";
  return "미기록";
}

function statusLabel(status?: "success" | "partial"): string {
  if (status === "success") return "완료";
  if (status === "partial") return "부분완료";
  return "미기록";
}

export async function handleWeeklyCopilotCommand(
  ctx: ChatContext,
  tgSend: any,
  rawArg = "",
  deps: WeeklyCopilotDeps = DEFAULT_DEPS
): Promise<void> {
  const isForced = /^(강제|force|override)$/i.test(rawArg.trim());
  const prefs = await deps.getPrefs(ctx.from?.id ?? ctx.chatId);
  const hasRiskProfile =
    prefs.risk_profile === "safe" ||
    prefs.risk_profile === "balanced" ||
    prefs.risk_profile === "active";
  const hasCapital = Number(prefs.capital_krw ?? 0) > 0;

  if (!isForced && isSameKstDate(prefs.weekly_copilot_last_run_at)) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: [
        "<b>오늘은 이미 주간 코파일럿을 실행했습니다.</b>",
        "",
        `마지막 실행: ${formatKstDateTime(prefs.weekly_copilot_last_run_at)}`,
        `실행 모드: ${modeLabel(prefs.weekly_copilot_last_mode)} / 상태: ${statusLabel(prefs.weekly_copilot_last_status)}`,
        "",
        "동일일 재실행이 필요하면 /주간코파일럿 강제 를 사용하세요.",
      ].join("\n"),
      parse_mode: "HTML",
      reply_markup: actionButtons(ACTIONS.weeklyCopilot, 2),
    });
    return;
  }

  if (!hasRiskProfile || !hasCapital) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: buildSetupGuideText(),
      parse_mode: "HTML",
      reply_markup: actionButtons(
        [
          { text: "투자성향", callback_data: "cmd:riskprofile" },
          { text: "투자금 입력", callback_data: "prompt:capital" },
          { text: "온보딩", callback_data: "cmd:onboarding" },
        ],
        2
      ),
    });
    return;
  }

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: [
      "<b>주간 코파일럿 실행</b>",
      "",
      "1) 장전 브리핑",
      "2) 장전 주문 플랜",
      "3) 보유 대응 플랜",
      "",
      isForced ? "강제 재실행 모드로 진행합니다." : "일반 실행 모드로 진행합니다.",
      "",
      "완료 후 이번 주 해야 할 일 3개를 요약해드립니다.",
    ].join("\n"),
    parse_mode: "HTML",
  });

  const failedSteps: string[] = [];

  try {
    await deps.runBrief(ctx, tgSend);
  } catch {
    failedSteps.push("장전 브리핑");
  }

  try {
    await deps.runPreMarket("", ctx, tgSend);
  } catch {
    failedSteps.push("장전 주문 플랜");
  }

  try {
    await deps.runWatchResponse(ctx, tgSend);
  } catch {
    failedSteps.push("보유 대응 플랜");
  }

  const isFullSuccess = failedSteps.length === 0;
  const nowIso = new Date().toISOString();
  await deps.setPrefs(ctx.from?.id ?? ctx.chatId, {
    weekly_copilot_last_run_at: nowIso,
    weekly_copilot_last_mode: isForced ? "forced" : "normal",
    weekly_copilot_last_status: isFullSuccess ? "success" : "partial",
  });

  const summaryLines = isFullSuccess
    ? [
        "<b>주간 코파일럿 완료</b>",
        "",
        "이번 주 해야 할 일 3개",
        "- 장전플랜 상위 후보부터 분할 진입",
        "- 보유대응의 손절/익절 기준가 예약 점검",
        "- 자동사이클은 먼저 점검 후 실행",
        "",
        `실행 시각: ${formatKstDateTime(nowIso)}`,
        `실행 모드: ${isForced ? "강제" : "일반"} / 상태: 완료`,
      ]
    : [
        "<b>주간 코파일럿 부분 완료</b>",
        "",
        `실패 단계: ${failedSteps.join(", ")}`,
        "",
        `실행 시각: ${formatKstDateTime(nowIso)}`,
        `실행 모드: ${isForced ? "강제" : "일반"} / 상태: 부분완료`,
        "다시 실행하거나 아래 빠른 버튼으로 필요한 단계만 재실행하세요.",
      ];

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: summaryLines.join("\n"),
    parse_mode: "HTML",
    reply_markup: actionButtons(ACTIONS.weeklyCopilot, 2),
  });
}
