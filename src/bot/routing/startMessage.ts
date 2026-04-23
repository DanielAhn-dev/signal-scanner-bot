import { getUserInvestmentPrefs } from "../../services/userService";
import { actionButtons } from "../messages/layout";
import type { ChatContext } from "./types";

function riskProfileLabel(profile?: "safe" | "balanced" | "active"): string {
  if (profile === "balanced") return "균형형";
  if (profile === "active") return "공격형";
  return "안전형";
}

export async function sendStartMessage(ctx: ChatContext, tgSend: any): Promise<void> {
  const prefs = await getUserInvestmentPrefs(ctx.from?.id ?? ctx.chatId);
  const hasSetup = Boolean(prefs.capital_krw);

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: hasSetup
      ? [
          `<b>Signal Scanner Bot</b>`,
          `보수적으로 후보를 압축하고, 종목별 진입 구간만 짧게 보여주는 투자 봇입니다.`,
          ``,
          `현재 설정`,
          `투자성향: ${riskProfileLabel(prefs.risk_profile)}`,
          `투자금: ${(prefs.capital_krw || 0).toLocaleString("ko-KR")}원`,
          ``,
          `/주간코파일럿 — 이번 주 실행 흐름 한번에 진행`,
          `/brief — 장전 브리핑 + 내 보유 종목 점검`,
          `/sector — 주도 섹터와 대표 후보`,
          `/pullback — 눌림목 대기 후보`,
          `/관심 — 추이 관찰 종목 목록`,
          `/보유 — 가상 보유 포트폴리오`,
          `/장전플랜 — 9시 전 예약 주문용 후보/수량/매도가`,
          ``,
          `도움말: /help`,
        ].join("\n")
      : [
          `<b>Signal Scanner Bot</b>`,
          `잃지 않는 투자에 맞춰 KOSPI 중심 후보를 압축해드립니다.`,
          ``,
          `먼저 2가지만 정하면 추천이 바로 개인화됩니다.`,
          `1. 투자성향 저장`,
          `2. 투자금 입력`,
          ``,
          `설정 후 /brief 에서 보유 종목과 추천 후보를 함께 점검할 수 있습니다.`,
        ].join("\n"),
    parse_mode: "HTML",
    reply_markup: hasSetup
      ? actionButtons(
          [
            { text: "주간 코파일럿", callback_data: "cmd:weeklycopilot" },
            { text: "장전플랜", callback_data: "cmd:premarket" },
            { text: "보유대응", callback_data: "cmd:watchresp" },
            { text: "자동 점검", callback_data: "cmd:autocycle:check" },
            { text: "자동 실행", callback_data: "cmd:autocycle:run" },
            { text: "설정 가이드", callback_data: "cmd:onboarding" },
          ],
          2
        )
      : actionButtons(
          [
            { text: "안전형", callback_data: "risk:safe" },
            { text: "균형형", callback_data: "risk:balanced" },
            { text: "공격형", callback_data: "risk:active" },
            { text: "투자금 입력", callback_data: "prompt:capital" },
            { text: "가이드", callback_data: "cmd:onboarding" },
            { text: "브리핑", callback_data: "cmd:brief" },
          ],
          2
        ),
  });
}
