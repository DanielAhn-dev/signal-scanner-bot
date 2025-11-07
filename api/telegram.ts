// api/telegram.ts
import { routeMessage, routeCallback } from "../src/bot/router";

export const config = { api: { bodyParser: false } };

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_BOT_SECRET = process.env.TELEGRAM_BOT_SECRET || "";

type TGUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat: { id: number }; message_id: number };
  };
};

async function readRawBody(req: any): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: any) =>
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c))
    );
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function tgFetch(method: string, body: any) {
  if (!TELEGRAM_BOT_TOKEN) return { ok: false };
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000); // 하드 5s
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: String(e) };
  } finally {
    clearTimeout(timer);
  }
}

// 보호 타임아웃 래퍼(최대 8.5s)
function withTimeout<T>(
  p: Promise<T>,
  ms = 8500,
  onTimeout?: () => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      onTimeout?.();
      reject(new Error("TIMEOUT"));
    }, ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch((e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

async function processUpdate(update: TGUpdate) {
  try {
    if (
      update?.callback_query?.data &&
      update.callback_query.message?.chat?.id
    ) {
      // 콜백은 즉시 응답
      await tgFetch("answerCallbackQuery", {
        callback_query_id: update.callback_query.id,
        text: "처리 중입니다…",
      });
      await withTimeout(
        routeCallback(
          update.callback_query.data,
          { chatId: update.callback_query.message.chat.id },
          tgFetch
        ),
        8500,
        () =>
          tgFetch("sendMessage", {
            chat_id: update.callback_query!.message!.chat.id,
            text: "서버가 혼잡합니다. 잠시 후 다시 시도해주세요.",
          })
      );
      return;
    }
    if (update?.message?.text) {
      const chatId = update.message.chat.id;
      await withTimeout(
        routeMessage(update.message.text.trim(), { chatId }, tgFetch),
        8500,
        () =>
          tgFetch("sendMessage", {
            chat_id: chatId,
            text: "요청 처리 시간이 길어 다음에 다시 시도해주세요.",
          })
      );
    }
  } catch (e) {
    // 조용히 로깅 후 종료
    console.error("Routing error:", e);
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "POST only" });
  }
  const headerSecret = req.headers["x-telegram-bot-api-secret-token"];
  if (!TELEGRAM_BOT_SECRET || headerSecret !== TELEGRAM_BOT_SECRET) {
    return res.status(401).json({ ok: false, error: "invalid secret" });
  }

  let update: TGUpdate | null = null;
  try {
    const raw = await readRawBody(req);
    update = JSON.parse(raw.toString("utf8"));
  } catch {
    // 잘못된 바디도 OK로 끝내 Telegram 재시도 루프 방지
    return res.status(200).json({ ok: true });
  }

  // 1) 즉시 ACK로 10초 제한 회피
  res.status(200).json({ ok: true });

  // 2) 비동기 처리(응답 후 실행)
  setImmediate(() => {
    processUpdate(update!).catch(() => {});
  });
}
