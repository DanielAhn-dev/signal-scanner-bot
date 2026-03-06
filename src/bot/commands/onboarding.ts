import type { ChatContext } from "../router";
import {
  header,
  section,
  bullets,
  divider,
  buildMessage,
  actionButtons,
  ACTIONS,
} from "../messages/layout";

export async function handleOnboardingCommand(
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const core = buildMessage([
    header("온보딩 가이드", "초보자용 조회 순서 · 손실 최소화 중심"),
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
      "4) /점수, /재무, /수급으로 기술·재무·자금흐름 교차검증",
      "5) /매수로 진입/손절/목표가 확인 후 실행",
      "6) /관심, /프로필로 사후 복기 및 습관 점검",
    ])),
    divider(),
    section("실전 규율", bullets([
      "단일 종목 과집중 금지, 동일 테마 동시 과다진입 금지",
      "손절 지연 금지: 사전 손절가 이탈 시 기계적으로 종료",
      "승률보다 기대값 관리: 손익비 1:1.5 이상 우선",
      "고변동 구간(VIX 급등/환율 급등)에서는 포지션 축소",
    ])),
  ]);

  const roadmap = buildMessage([
    header("단계별 기능 개선 로드맵", "운영 안정화 → 자동화 → 시스템 매매"),
    section("1단계 (즉시 적용)", bullets([
      "온보딩 체크리스트 고정: 진입 전 6단계 점검",
      "매매 로그 템플릿 도입: 진입근거/손절근거 필수 입력",
      "초보자 기본값: /투자금 3분할, 보수적 목표수익률",
    ])),
    section("2단계 (다음 개선)", bullets([
      "이상징후 알림: 변동성 급등/거래대금 급변/섹터 급회전 감지",
      "시나리오 템플릿: 강세장/중립/약세장별 액션 가이드 자동 제시",
      "후보 자동 스코어링: 기술+재무+수급 가중치 기반 우선순위",
    ])),
    section("3단계 (고도화)", bullets([
      "규칙기반 오토플랜: 진입/청산 시점 체크리스트 자동 판정",
      "리스크 대시보드: 일손실·연속손실·노출도 실시간 관리",
      "백테스트 리포트: 전략별 MDD/승률/기대값 비교",
    ])),
    divider(),
    "※ 본 봇은 의사결정 보조 도구이며 수익을 보장하지 않습니다. 언제나 본인 책임 하에 리스크를 관리하세요.",
  ]);

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: core,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: actionButtons(ACTIONS.marketHub, 2),
  });

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: roadmap,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: actionButtons([
      { text: "투자금 설정", callback_data: "cmd:capital" },
      { text: "브리핑", callback_data: "cmd:brief" },
      ...ACTIONS.promptAnalyze,
    ], 2),
  });
}
