// api/worker.ts
import { routeMessage, routeCallback } from "../src/bot/router";

export const config = { api: { bodyParser: false } };

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const INTERNAL_SECRET = process.env.CRON_SECRET || "";

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
  if (!TELEGRAM_BOT_TOKEN) {
    console.error("Telegram token missing");
    return { ok: false, error: "TOKEN_MISSING" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
    );
    const json = await res.json();
    if (!json?.ok) console.error("Telegram API error:", json); // 실패 로깅
    return json;
  } catch (e) {
    console.error("Telegram fetch failed:", e);
    return { ok: false, error: String(e) };
  } finally {
    clearTimeout(timer);
  }
}

function withTimeout<T>(p: Promise<T>, ms = 7800): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("TIMEOUT")), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch((e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  if ((req.headers["x-internal-secret"] || "") !== INTERNAL_SECRET)
    return res.status(401).json({ ok: false });

  let update: TGUpdate | null = null;
  try {
    const raw = await readRawBody(req);
    update = JSON.parse(raw.toString("utf8"));
  } catch {
    return res.status(200).json({ ok: true });
  }

  try {
    if (
      update?.callback_query?.data &&
      update.callback_query.message?.chat?.id
    ) {
      const chatId = update.callback_query.message.chat.id;
      await tgFetch("answerCallbackQuery", {
        callback_query_id: update.callback_query.id,
        text: "처리 중…🥲",
      });
      await withTimeout(
        routeCallback(update.callback_query.data, { chatId }, tgFetch)
      );
    } else if (update?.message?.text) {
      const chatId = update.message.chat.id;
      await tgFetch("sendChatAction", { chat_id: chatId, action: "typing" });
      await withTimeout(
        routeMessage(update.message.text.trim(), { chatId }, tgFetch)
      );
    }
  } catch (e) {
    // 최후 안내
    if (update?.message?.chat?.id) {
      await tgFetch("sendMessage", {
        chat_id: update.message.chat.id,
        text: "서버가 혼잡합니다. 잠시 후 다시 시도해주세요.",
      });
    }
  }
  return res.status(200).json({ ok: true });
}
