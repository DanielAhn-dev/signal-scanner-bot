// api/telegram.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { handleScanCommand } from "../src/bot/commands/scan";

// Telegram Webhook는 원문 보존을 위해 raw body 필요
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

function resolveBase(): string {
  const base = (
    process.env.BASE_URL || `https://${process.env.VERCEL_URL || ""}`
  ).replace(/\/+$/, "");
  return base;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 메서드 가드
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }

  // Telegram secret header 검증(표준 키: x-telegram-bot-api-secret-token)
  const headerSecret =
    (req.headers["x-telegram-bot-api-secret-token"] as string) ||
    (req.headers["x-telegram-bot-secret-token"] as string) || // 호환
    "";
  if (
    !process.env.TELEGRAM_BOT_SECRET ||
    headerSecret !== process.env.TELEGRAM_BOT_SECRET
  ) {
    // 비밀 불일치 시 바로 401
    return res.status(401).end();
  }

  // 원문 읽기 및 파싱
  let payload: any = null;
  try {
    const raw = await readRawBody(req);
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    // 파싱 실패해도 ACK로 재시도 방지
  }

  // 중복 방지용 dedup key 구성
  const dedup = payload?.update_id
    ? String(payload.update_id)
    : payload?.callback_query?.id
    ? `cb:${payload.callback_query.id}`
    : payload?.message?.message_id
    ? `${payload.message.chat.id}:${payload.message.message_id}`
    : undefined;

  // 잡 큐에 적재(Upsert로 중복 방지)
  try {
    await supa()
      .from("jobs")
      .upsert(
        {
          type: "telegram_update",
          payload,
          status: "queued",
          created_at: new Date().toISOString(),
          dedup_key: dedup || null,
        },
        { onConflict: "type,dedup_key" }
      );
  } catch {
    // 저장 실패여도 ACK
  }

  // 비동기 워커 트리거(내부 호출)
  try {
    const base = resolveBase();
    if (base && process.env.CRON_SECRET) {
      await fetch(
        `${base}/api/worker?token=${encodeURIComponent(
          process.env.CRON_SECRET!
        )}`,
        {
          method: "POST",
          headers: { "x-internal-secret": process.env.CRON_SECRET! },
          keepalive: true,
        }
      ).catch(() => void 0);
    }
  } catch {
    // 워커 트리거 실패 무시
  }

  // 즉시 ACK
  return res.status(200).end();
}
