// api/telegram.ts
import { routeMessage, routeCallback } from "../src/bot/router";

export const config = { api: { bodyParser: false } };

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_BOT_SECRET = process.env.TELEGRAM_BOT_SECRET || "";
const INTERNAL_SECRET = process.env.CRON_SECRET || ""; // 내부 워커 호출 보호
const BASE_URL = process.env.BASE_URL || ""; // 예: https://signal-scanner-bot.vercel.app

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
    return res.status(200).json({ ok: true });
  }

  // 1) 즉시 ACK
  res.status(200).json({ ok: true });

  // 2) 워커로 위임(새 인보케이션)
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 800); // 워커 트리거만 빠르게
    res.status(200).json({ ok: true }); // 즉시 ACK

    await fetch(`${BASE_URL}/api/worker`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": INTERNAL_SECRET,
      },
      body: JSON.stringify(update),
    }).catch(() => {});
    clearTimeout(t);
  } catch {}
}
