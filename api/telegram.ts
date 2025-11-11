// api/telegram.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

export const config = { api: { bodyParser: false } };

const supa = () =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });

async function readRawBody(req: VercelRequest): Promise<string> {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  // Telegram secret token 검증
  const secret = req.headers["x-telegram-bot-api-secret-token"] || "";
  if (
    !process.env.TELEGRAM_BOT_SECRET ||
    secret !== process.env.TELEGRAM_BOT_SECRET
  ) {
    return res.status(401).end();
  }

  try {
    const raw = await readRawBody(req);
    const payload = raw ? JSON.parse(raw) : null;

    // 업데이트를 큐에 적재
    await supa().from("jobs").insert({
      type: "telegram_update",
      payload,
      status: "queued",
      created_at: new Date().toISOString(),
    });
  } catch {
    // 재시도 루프를 막기 위해 에러여도 200 반환
  }

  // 즉시 종료(절대 블로킹 금지)
  return res.status(200).end();
}
