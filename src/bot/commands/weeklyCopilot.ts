import type { ChatContext } from "../router";
import { getUserInvestmentPrefs } from "../../services/userService";
import { handleBriefCommand } from "./brief";
import { handlePreMarketPlanCommand } from "./preMarketPlan";
import { handleWatchlistResponseCommand } from "./watchlist";
import { ACTIONS, actionButtons } from "../messages/layout";

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

export async function handleWeeklyCopilotCommand(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const prefs = await getUserInvestmentPrefs(ctx.from?.id ?? ctx.chatId);
  const hasRiskProfile =
    prefs.risk_profile === "safe" ||
    prefs.risk_profile === "balanced" ||
    prefs.risk_profile === "active";
  const hasCapital = Number(prefs.capital_krw ?? 0) > 0;

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
      "완료 후 이번 주 해야 할 일 3개를 요약해드립니다.",
    ].join("\n"),
    parse_mode: "HTML",
  });

  const failedSteps: string[] = [];

  try {
    await handleBriefCommand(ctx, tgSend);
  } catch {
    failedSteps.push("장전 브리핑");
  }

  try {
    await handlePreMarketPlanCommand("", ctx, tgSend);
  } catch {
    failedSteps.push("장전 주문 플랜");
  }

  try {
    await handleWatchlistResponseCommand(ctx, tgSend);
  } catch {
    failedSteps.push("보유 대응 플랜");
  }

  const isFullSuccess = failedSteps.length === 0;
  const summaryLines = isFullSuccess
    ? [
        "<b>주간 코파일럿 완료</b>",
        "",
        "이번 주 해야 할 일 3개",
        "- 장전플랜 상위 후보부터 분할 진입",
        "- 보유대응의 손절/익절 기준가 예약 점검",
        "- 자동사이클은 먼저 점검 후 실행",
      ]
    : [
        "<b>주간 코파일럿 부분 완료</b>",
        "",
        `실패 단계: ${failedSteps.join(", ")}`,
        "다시 실행하거나 아래 빠른 버튼으로 필요한 단계만 재실행하세요.",
      ];

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: summaryLines.join("\n"),
    parse_mode: "HTML",
    reply_markup: actionButtons(ACTIONS.weeklyCopilot, 2),
  });
}
