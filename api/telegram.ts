// api/telegram.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const supa = () =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });

function resolveBase(): string {
  const base = (
    process.env.BASE_URL || `https://${process.env.VERCEL_URL || ""}`
  ).replace(/\/+$/, "");
  return base;
}

async function triggerWorker(base: string, secret: string): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(
        `${base}/api/worker?token=${encodeURIComponent(secret)}`,
        {
          method: "POST",
          headers: { "x-internal-secret": secret },
          signal: controller.signal,
        }
      );

      if (response.ok) {
        return;
      }

      console.error("[telegram] worker trigger non-2xx:", response.status);
    } catch (e) {
      console.error(`[telegram] worker trigger failed (attempt ${attempt}):`, e);
    } finally {
      clearTimeout(timer);
    }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 어떤 오류가 발생해도 반드시 200 ACK를 반환해 Telegram 재시도를 방지
  try {
    // 메서드 가드
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).end();
    }

    // Telegram secret header 검증
    const headerSecret =
      (req.headers["x-telegram-bot-api-secret-token"] as string) ||
      (req.headers["x-telegram-bot-secret-token"] as string) ||
      "";
    const envSecret = (process.env.TELEGRAM_BOT_SECRET || "").trim();
    if (envSecret && headerSecret.trim() !== envSecret) {
      // 불일치 시 200 반환 (401은 Telegram이 무한 재시도)
      return res.status(200).end();
    }

    // Vercel이 자동 파싱한 body 사용
    const payload: any = req.body ?? null;

    // 중복 방지용 dedup key 구성
    const dedup = payload?.update_id
      ? String(payload.update_id)
      : payload?.callback_query?.id
      ? `cb:${payload.callback_query.id}`
      : payload?.message?.message_id
      ? `${payload.message.chat.id}:${payload.message.message_id}`
      : null;

    // 잡 큐에 적재(Upsert로 중복 방지)
    await supa()
      .from("jobs")
      .upsert(
        {
          type: "telegram_update",
          payload,
          status: "queued",
          created_at: new Date().toISOString(),
          dedup_key: dedup,
        },
        { onConflict: "type,dedup_key" }
      );

    // 비동기 워커 트리거(내부 호출, fire-and-forget)
    const base = resolveBase();
    if (base && process.env.CRON_SECRET) {
      await triggerWorker(base, process.env.CRON_SECRET);
    }
  } catch (e) {
    // 내부 오류는 로그만 남기고 200 ACK
    console.error("[telegram] handler error:", e);
  }

  return res.status(200).end();
}
