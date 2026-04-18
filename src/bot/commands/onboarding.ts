import type { ChatContext } from "../router";
import {
  header,
  section,
  bullets,
  divider,
  buildMessage,
  actionButtons,
} from "../messages/layout";
import { getUserInvestmentPrefs, setUserInvestmentPrefs } from "../../services/userService";

function riskProfileLabel(profile?: "safe" | "balanced" | "active"): string {
  if (profile === "balanced") return "균형형";
  if (profile === "active") return "공격형";
  return "안전형";
}

export async function handleRiskProfileSelection(
  profile: "safe" | "balanced" | "active",
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const tgId = ctx.from?.id ?? ctx.chatId;
  const saved = await setUserInvestmentPrefs(tgId, { risk_profile: profile });

  if (!saved.ok) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: saved.message || "투자성향 저장 중 오류가 발생했습니다.",
    });
    return;
  }

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: [
      `<b>투자성향 저장 완료</b>`,
      `현재 기준은 <code>${riskProfileLabel(profile)}</code>입니다.`,
      `다음으로 투자금을 입력하면 /브리핑, /섹터, /눌림목 후보와 /종목분석 결과가 이 성향에 맞춰 더 보수적 또는 적극적으로 바뀝니다.`,
      ``,
      `예시: /투자금 300만원 3 8 ${riskProfileLabel(profile)}`,
    ].join("\n"),
    parse_mode: "HTML",
    reply_markup: actionButtons([
      { text: "투자금 입력", callback_data: "prompt:capital" },
      { text: "브리핑", callback_data: "cmd:brief" },
      { text: "보유", callback_data: "cmd:watchlist" },
      { text: "프로필", callback_data: "cmd:profile" },
    ], 2),
  });
}

export async function handleOnboardingCommand(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const prefs = await getUserInvestmentPrefs(ctx.from?.id ?? ctx.chatId);
  const core = buildMessage([
    header("초기 설정 가이드", "추천을 내 성향에 맞추는 최소 설정"),
    section("현재 설정", bullets([
      `투자성향: ${riskProfileLabel(prefs.risk_profile)}`,
      `투자금: ${prefs.capital_krw ? `${prefs.capital_krw.toLocaleString("ko-KR")}원` : "미설정"}`,
      `분할매수: ${prefs.split_count ?? 3}회`,
      `목표수익률: ${(prefs.target_profit_pct ?? 8).toFixed(1)}%`,
    ])),
    section("핵심 원칙", bullets([
      "수익보다 손실 관리가 우선 (1회 손실 한도 고정)",
      "분할 진입/분할 청산, 손절 기준 사전 설정",
      "확신이 없으면 진입하지 않고 관찰",
      "하루 거래 횟수/최대 손실 한도 초과 시 종료",
    ])),
    section("권장 조회 순서 (매일)", bullets([
      "1) /경제, /시장으로 리스크 온도 확인",
      "2) /브리핑 또는 /섹터, /다음섹터로 순환매 후보 압축",
      "3) /스캔, /눌림목으로 진입 후보 선별",
      "4) /종목분석, /재무, /수급으로 기술·재무·자금흐름 교차검증",
      "5) /관심추가 로 먼저 추이를 관찰하고, 진입 판단이 서면 /가상매수 실행",
      "6) /보유, /거래기록, /프로필로 사후 복기 및 습관 점검",
    ])),
    divider(),
    "투자성향 버튼을 먼저 누르고, 투자금만 입력하면 바로 개인화가 시작됩니다.",
  ]);

  const nextSteps = buildMessage([
    header("바로 할 일", "설정 후 브리핑과 보유 포트폴리오를 연결"),
    section("권장 순서", bullets([
      "1) 안전형/균형형/공격형 중 하나 저장",
      "2) /투자금 300만원 3 8 형태로 투자금 입력",
      "3) /관심추가 삼성전자 또는 버튼으로 관심 목록에 먼저 저장",
      "4) /브리핑 에서 추천 후보와 관심/보유 종목을 함께 점검",
    ])),
    divider(),
    "※ 본 봇은 의사결정 보조 도구이며 수익을 보장하지 않습니다. 리스크 관리는 항상 본인 책임입니다.",
  ]);

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: core,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: actionButtons([
      { text: "안전형", callback_data: "risk:safe" },
      { text: "균형형", callback_data: "risk:balanced" },
      { text: "공격형", callback_data: "risk:active" },
      { text: "투자금 입력", callback_data: "prompt:capital" },
    ], 2),
  });

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: nextSteps,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: actionButtons([
      { text: "보유", callback_data: "cmd:watchlist" },
      { text: "브리핑", callback_data: "cmd:brief" },
      { text: "종목분석", callback_data: "prompt:trade" },
      { text: "재무", callback_data: "prompt:finance" },
    ], 2),
  });
}
