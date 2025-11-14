// api/worker.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { routeMessage, routeCallback } from "../src/bot/router";

export const config = { api: { bodyParser: true } };

const supa = () =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });

const INTERNAL_SECRET = process.env.CRON_SECRET || "";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

type TGApiResponse = { ok?: boolean; result?: any; description?: string };

async function tgFetch(method: string, body: any): Promise<TGApiResponse> {
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
    return (await res.json()) as TGApiResponse;
  } catch (e) {
    return { ok: false, description: String(e) };
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

// queued -> processing 원자 전환으로 집기
async function pickJobs(n = 25) {
  const now = new Date().toISOString();
  const { data, error } = await supa()
    .from("jobs")
    .update({ status: "processing", started_at: now })
    .eq("type", "telegram_update")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(n)
    .select("*");
  if (error) throw error;
  return data || [];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST" && req.method !== "GET")
    return res.status(405).json({ ok: false });

  const token =
    (req.headers["x-internal-secret"] as string) ||
    (req.query?.token as string) ||
    "";
  if (token !== INTERNAL_SECRET) return res.status(401).json({ ok: false });

  let items: any[] = [];
  try {
    items = await pickJobs(25);
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error,
      details: error?.message || error?.hint || String(error),
    });
  }

  for (const job of items) {
    try {
      const u = job.payload || {};
      if (u?.callback_query?.data && u?.callback_query?.message?.chat?.id) {
        const chatId = u.callback_query.message.chat.id;
        await tgFetch("answerCallbackQuery", {
          callback_query_id: u.callback_query.id,
          text: "처리 중…",
        });
        await withTimeout(
          routeCallback(u.callback_query.data, { chatId }, tgFetch)
        );
      } else if (u?.message?.text && u?.message?.chat?.id) {
        const chatId = u.message.chat.id;
        await tgFetch("sendChatAction", { chat_id: chatId, action: "typing" });
        await withTimeout(
          routeMessage(u.message.text.trim(), { chatId }, tgFetch)
        );
      }
      await supa()
        .from("jobs")
        .update({ status: "done", done_at: new Date().toISOString(), ok: true })
        .eq("id", job.id);
    } catch (e: any) {
      await supa()
        .from("jobs")
        .update({ status: "error", error: String(e) })
        .eq("id", job.id);
    }
  }

  return res.status(200).json({ ok: true, processed: items.length });
}
