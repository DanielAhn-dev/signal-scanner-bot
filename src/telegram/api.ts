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
  const commands = [
    { command: "start", description: "사용법 안내" },
    { command: "sector", description: "유망 섹터 보기" },
    { command: "nextsector", description: "자금유입 섹터 보기" },
    { command: "stocks", description: "섹터별 대장주 보기" },
    { command: "score", description: "종목 점수/신호" },
  ];

  const r1 = await tg("setMyCommands", { commands });
  const r2 = await tg("setMyCommands", {
    commands,
    language_code: "ko",
  });

  // 둘 중 하나라도 ok 이면 ok 로 판단
  return { ok: !!(r1.ok || r2.ok) };
}
