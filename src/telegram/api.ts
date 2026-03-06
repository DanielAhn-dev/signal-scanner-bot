// src/telegram/api.ts
const token = process.env.TELEGRAM_BOT_TOKEN || "";
const base = `https://api.telegram.org/bot${token}`;

type TgResponse = { ok?: boolean; result?: any; description?: string };

export async function tg(method: string, body: any): Promise<TgResponse> {
  if (!token) return { ok: false };
  const res = await fetch(`${base}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as TgResponse;
}

export const sendMessage = (
  chat_id: number,
  text: string,
  reply_markup?: any
) => tg("sendMessage", { chat_id, text, reply_markup });

export const answerCallback = (
  callback_query_id: string,
  text = "처리 중입니다…"
) => tg("answerCallbackQuery", { callback_query_id, text, show_alert: false });

// 봇 명령어 목록 (텔레그램 메뉴 버튼에 노출)
const BOT_COMMANDS = [
  { command: "start", description: "시작 · 메뉴" },
  { command: "onboarding", description: "초보자 온보딩 가이드" },
  { command: "sector", description: "주도 섹터 랭킹" },
  { command: "scan", description: "눌림목 스캐너" },
  { command: "score", description: "종목 점수·시그널" },
  { command: "buy", description: "매수 판독" },
  { command: "finance", description: "재무 요약" },
  { command: "capital", description: "투자금 설정" },
  { command: "brief", description: "장전 브리핑" },
  { command: "alert", description: "이상징후 점검" },
  { command: "economy", description: "글로벌 경제지표" },
  { command: "news", description: "시장·종목 뉴스" },
  { command: "market", description: "종합 시장 진단" },
  { command: "watchlist", description: "관심종목 포트폴리오" },
  { command: "flow", description: "외국인·기관 수급" },
  { command: "nextsector", description: "수급 유입 섹터" },
  { command: "pullback", description: "눌림목 매집 후보" },
  { command: "ranking", description: "포트폴리오 랭킹" },
  { command: "profile", description: "내 프로필" },
  { command: "follow", description: "트레이더 팔로우" },
  { command: "feed", description: "팔로잉 피드" },
  { command: "help", description: "도움말" },
];

/** 텔레그램에 봇 명령어 + 메뉴 버튼 + 설명 등록 */
export async function setCommandsKo(): Promise<TgResponse> {
  const [r1, r2, r3, r4] = await Promise.all([
    // 기본(전체 언어) 명령어
    tg("setMyCommands", { commands: BOT_COMMANDS }),
    // 한국어 전용
    tg("setMyCommands", { commands: BOT_COMMANDS, language_code: "ko" }),
    // 채팅 입력창 메뉴 버튼 → 명령어 목록 표시
    tg("setChatMenuButton", {
      menu_button: { type: "commands" },
    }),
    // 봇 짧은 설명 (프로필 옆에 표시)
    tg("setMyShortDescription", {
      short_description:
        "한국 주식 시그널 스캐너 — 섹터·종목·수급·눌림목·포트폴리오",
      language_code: "ko",
    }),
  ]);

  // 추가: 봇 설명 (채팅 시작 전 프로필에서 보이는 텍스트)
  await tg("setMyDescription", {
    description:
      "한국 주식 시그널 스캐너 봇\n\n" +
      "- 주도 섹터 · 눌림목 스캔 · 종목 점수\n" +
      "- 글로벌 경제지표 · 실시간 뉴스\n" +
      "- 관심종목 포트폴리오 · 수익률 랭킹\n" +
      "- 외국인/기관 수급 · 매수 판독\n\n" +
      "/start 를 눌러 시작하세요!",
    language_code: "ko",
  });

  return { ok: !!(r1.ok || r2.ok) };
}
