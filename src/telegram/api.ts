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

export async function setCommandsKo(): Promise<TgResponse> {
  // 텔레그램 Bot API는 command에 한글을 지원하지 않으므로
  // 한글 별칭은 router에서 처리하고, 메뉴에는 로마자 축약 + 한글 설명을 사용
  const commands = [
    { command: "start", description: "사용법 안내" },
    { command: "sector", description: "주도 섹터 랭킹 (/섹터)" },
    { command: "nextsector", description: "수급 유입 섹터 (/다음섹터)" },
    { command: "stocks", description: "섹터별 대장주 (/종목)" },
    { command: "scan", description: "눌림목 스캐너 (/스캔)" },
    { command: "score", description: "종목 점수·시그널 (/점수)" },
    { command: "buy", description: "매수 판독 (/매수)" },
    { command: "brief", description: "장전 브리핑 (/브리핑)" },
    { command: "pullback", description: "눌림목 매집 후보 (/눌림목)" },
    { command: "watchlist", description: "관심종목 포트폴리오 (/관심)" },
    { command: "flow", description: "외국인·기관 매매동향 (/수급)" },
    { command: "economy", description: "글로벌 경제지표 (/경제)" },
    { command: "news", description: "시장·종목 뉴스 (/뉴스)" },
    { command: "market", description: "종합 시장 진단 (/시장)" },
    { command: "profile", description: "내 프로필 (/프로필)" },
    { command: "ranking", description: "포트폴리오 랭킹 (/랭킹)" },
    { command: "follow", description: "트레이더 팔로우 (/팔로우)" },
    { command: "feed", description: "팔로잉 피드 (/피드)" },
  ];

  const r1 = await tg("setMyCommands", { commands });
  const r2 = await tg("setMyCommands", {
    commands,
    language_code: "ko",
  });

  // 둘 중 하나라도 ok 이면 ok 로 판단
  return { ok: !!(r1.ok || r2.ok) };
}
