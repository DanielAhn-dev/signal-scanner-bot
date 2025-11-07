// src/telegram/api.ts
const token = process.env.TELEGRAM_BOT_TOKEN || "";
const base = `https://api.telegram.org/bot${token}`;

export async function tg(method: string, body: any) {
  if (!token) return { ok: false };
  const res = await fetch(`${base}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
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

export async function setCommandsKo() {
  const commands = [
    { command: "start", description: "사용법 안내" },
    { command: "sector", description: "유망 섹터 보기" },
    { command: "stocks", description: "섹터별 대장주 보기" },
    { command: "score", description: "종목 점수/신호" },
  ];
  // 기본(모든 채팅) + 한국어
  await tg("setMyCommands", { commands, language_code: "ko" });
}
