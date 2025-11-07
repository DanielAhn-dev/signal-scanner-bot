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
    return await res.json();
  } catch (e) {
    return { ok: false, error: String(e) };
  } finally {
    clearTimeout(timer);
  }
}

// 보호 타임아웃(최대 8.5s)
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
    return res.status(200).json({ ok: true }); // 바디 파싱 실패도 재시도 방지를 위해 200
  }

  try {
    if (
      update?.callback_query?.data &&
      update.callback_query.message?.chat?.id
    ) {
      const chatId = update.callback_query.message.chat.id;
      // 즉시 진행 안내(저비용)
      await tgFetch("answerCallbackQuery", {
        callback_query_id: update.callback_query.id,
        text: "처리 중…",
      });
      await withTimeout(
        routeCallback(update.callback_query.data, { chatId }, tgFetch),
        8500,
        () =>
          tgFetch("sendMessage", {
            chat_id: chatId,
            text: "서버가 혼잡합니다. 잠시 후 다시 시도해주세요.",
          })
      );
    } else if (update?.message?.text) {
      const chatId = update.message.chat.id;
      // 가벼운 타이핑 표시로 사용자 대기 인지
      await tgFetch("sendChatAction", { chat_id: chatId, action: "typing" });
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
    console.error("Routing error:", e);
  }

  // 처리 완료 후 응답(전체가 10s 이내여야 함)
  return res.status(200).json({ ok: true });
}
