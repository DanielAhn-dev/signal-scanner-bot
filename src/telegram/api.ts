import { TELEGRAM_BOT_COMMANDS } from "../bot/commandCatalog";

// src/telegram/api.ts
const token = process.env.TELEGRAM_BOT_TOKEN || "";
const base = `https://api.telegram.org/bot${token}`;

type TgResponse = { ok?: boolean; result?: any; description?: string };

export async function tg(method: string, body: any): Promise<TgResponse> {
  if (!token) return { ok: false };

  const isMultipart = typeof FormData !== "undefined" && body instanceof FormData;
  const req: RequestInit = {
    method: "POST",
  };

  if (isMultipart) {
    req.body = body;
  } else {
    req.headers = { "content-type": "application/json" };
    req.body = JSON.stringify(body);
  }

  const res = await fetch(`${base}/${method}`, {
    ...req,
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

export async function sendDocument(payload: {
  chat_id: number;
  bytes: Uint8Array;
  filename: string;
  caption?: string;
}): Promise<TgResponse> {
  const form = new FormData();
  form.set("chat_id", String(payload.chat_id));
  if (payload.caption) form.set("caption", payload.caption);
  form.set("disable_content_type_detection", "true");
  form.set("document", new Blob([payload.bytes.buffer as ArrayBuffer], { type: "application/pdf" }), payload.filename);
  return tg("sendDocument", form);
}

/** 텔레그램에 봇 명령어 + 메뉴 버튼 + 설명 등록 */
export async function setCommandsKo(): Promise<TgResponse> {
  const [r1, r2, r3, r4] = await Promise.all([
    // 기본(전체 언어) 명령어
    tg("setMyCommands", { commands: TELEGRAM_BOT_COMMANDS }),
    // 한국어 전용
    tg("setMyCommands", { commands: TELEGRAM_BOT_COMMANDS, language_code: "ko" }),
    // 채팅 입력창 메뉴 버튼 → 명령어 목록 표시
    tg("setChatMenuButton", {
      menu_button: { type: "commands" },
    }),
    // 봇 짧은 설명 (프로필 옆에 표시)
    tg("setMyShortDescription", {
      short_description:
        "한국 주식 시그널 스캐너 — 종목분석·수급·눌림목·가상 포트폴리오",
      language_code: "ko",
    }),
  ]);

  // 추가: 봇 설명 (채팅 시작 전 프로필에서 보이는 텍스트)
  await tg("setMyDescription", {
    description:
      "한국 주식 시그널 스캐너 봇\n\n" +
      "- 주도 섹터 · 눌림목 스캔 · 종목분석\n" +
      "- 글로벌 경제지표 · 실시간 뉴스\n" +
      "- 가상 보유 포트폴리오 · 수익률 랭킹\n" +
      "- 외국인/기관 수급 · 가상 매수/매도 기록\n\n" +
      "/start 를 눌러 시작하세요!",
    language_code: "ko",
  });

  return { ok: !!(r1.ok || r2.ok) };
}
