import { getUserInvestmentPrefs } from "../../services/userService";
import { ACTIONS, actionButtons } from "../messages/layout";
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
          `장전 브리핑부터 주간 리포트까지 5단계로 따라가며 운용하는 투자 봇입니다.`,
          ``,
          `현재 설정`,
          `투자성향: ${riskProfileLabel(prefs.risk_profile)}`,
          `투자금: ${(prefs.capital_krw || 0).toLocaleString("ko-KR")}원`,
          ``,
          `1) 오늘 브리핑: /brief`,
          `2) 후보 스캔: /scan · /pullback`,
          `3) 종목 검증: /종목분석 · /재무 · /수급`,
          `4) 매매/포트폴리오: /장전플랜 · /보유 · /자동사이클 실행`,
          `5) 주간 리포트: /리포트 추천 · /주간코파일럿`,
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
            { text: "1. 오늘 브리핑", callback_data: "cmd:brief" },
            { text: "2. 후보 스캔", callback_data: "cmd:scan" },
            { text: "3. 종목 검증", callback_data: "prompt:trade" },
            { text: "4. 매매/포트폴리오", callback_data: "cmd:watchlist" },
            { text: "5. 주간 리포트", callback_data: "cmd:report:추천" },
            { text: "자동 점검", callback_data: "cmd:autocycle:check" },
            { text: "자동 실행", callback_data: "cmd:autocycle:run" },
            ...ACTIONS.opsTriggerQuick,
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
