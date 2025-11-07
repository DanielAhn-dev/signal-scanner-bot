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
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.statusCode = 405;
    res.end(
      JSON.stringify({
        ok: false,
        error: "메서드가 허용되지 않습니다 (POST만 허용).",
      })
    );
    return;
  }

  const headerSecret = req.headers["x-telegram-bot-api-secret-token"];
  if (!TELEGRAM_BOT_SECRET || headerSecret !== TELEGRAM_BOT_SECRET) {
    res.statusCode = 401;
    res.end(
      JSON.stringify({ ok: false, error: "시크릿 토큰이 유효하지 않습니다." })
    );
    return;
  }

  let update: TGUpdate | null = null;
  try {
    const raw = await readRawBody(req);
    update = JSON.parse(raw.toString("utf8"));
  } catch {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  try {
    if (update?.message?.text) {
      await routeMessage(
        update.message.text.trim(),
        { chatId: update.message.chat.id },
        tgFetch
      );
    } else if (update?.callback_query) {
      await tgFetch("answerCallbackQuery", {
        callback_query_id: update.callback_query.id,
        text: "처리 중입니다…",
        show_alert: false,
      });
      if (
        update.callback_query.data &&
        update.callback_query.message?.chat?.id
      ) {
        await routeCallback(
          update.callback_query.data,
          { chatId: update.callback_query.message.chat.id },
          tgFetch
        );
      }
    }
  } catch (err) {
    console.error("Routing error:", err);
  }

  res.statusCode = 200;
  res.end(JSON.stringify({ ok: true }));
}
