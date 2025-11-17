// api/worker.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { routeMessage, routeCallback } from "../src/bot/router";
import { scoreStocksInSector, StockScore } from "../src/lib/stocks";

// supa 클라이언트는 service_role 키를 사용해야 함
const supa = () =>
  createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

const INTERNAL_SECRET = process.env.CRON_SECRET || "";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

// ---- Telegram 호출 유틸 ----

type TGApiResponse = { ok?: boolean; result?: any; description?: string };

async function tgFetch(method: string, body: any): Promise<TGApiResponse> {
  if (!TELEGRAM_BOT_TOKEN) {
    return { ok: false, description: "TELEGRAM_BOT_TOKEN missing" };
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

// ---- 잡 핸들러들 ----

async function handleWatchSectorJob(job: any) {
  const { sectorId, sectorName, score } = job.payload || {};
  if (!sectorId) {
    throw new Error("sectorId is missing in WATCH_SECTOR job");
  }

  const stocks: StockScore[] = await scoreStocksInSector(sectorId);
  const promisingStocks = stocks.filter((s) => s.score >= 80).slice(0, 3);

  if (promisingStocks.length > 0) {
    const chatId = Number(process.env.TELEGRAM_ADMIN_CHAT_ID);
    if (!chatId) return;

    const text = [
      `📈 섹터 [${sectorName}] (점수: ${score}) 에서 유망 종목 발견!`,
      ...promisingStocks.map(
        (s: StockScore) => `- ${s.name} (${s.code}): ${s.score}점`
      ),
    ].join("\n");

    await tgFetch("sendMessage", { chat_id: chatId, text });
  }
}

async function handleTelegramUpdateJob(job: any) {
  const u = job.payload || {};

  // 콜백 버튼
  if (u?.callback_query?.data && u?.callback_query?.message?.chat?.id) {
    const chatId = u.callback_query.message.chat.id as number;

    await tgFetch("answerCallbackQuery", {
      callback_query_id: u.callback_query.id,
      text: "처리 중…",
      show_alert: false,
    });

    await withTimeout(
      routeCallback(u.callback_query.data, { chatId }, tgFetch)
    );
    return;
  }

  // 일반 텍스트 메시지
  if (u?.message?.text && u?.message?.chat?.id) {
    const chatId = u.message.chat.id as number;
    const text = String(u.message.text || "").trim();
    if (!text) return;

    await tgFetch("sendChatAction", { chat_id: chatId, action: "typing" });
    await withTimeout(routeMessage(text, { chatId }, tgFetch));
  }
}

// ---- 메인 워커 핸들러 ----

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ ok: false });
  }

  const token =
    (req.headers["x-internal-secret"] as string) ||
    (req.query?.token as string) ||
    "";

  if (INTERNAL_SECRET && token !== INTERNAL_SECRET) {
    return res.status(401).json({ ok: false });
  }

  // status = 'queued' 인 잡들만 처리
  const { data: jobs, error } = await supa()
    .from("jobs")
    .select("*")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(10);

  if (error || !jobs) {
    console.error("worker: failed to fetch jobs", error);
    return res.status(500).send("Failed to fetch jobs");
  }

  if (jobs.length === 0) {
    return res.status(200).send("No pending jobs.");
  }

  for (const job of jobs) {
    await supa()
      .from("jobs")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", job.id);

    try {
      if (job.type === "WATCH_SECTOR") {
        await handleWatchSectorJob(job);
      } else if (job.type === "telegram_update") {
        await handleTelegramUpdateJob(job);
      }

      await supa()
        .from("jobs")
        .update({
          status: "done",
          finished_at: new Date().toISOString(),
          ok: true,
        })
        .eq("id", job.id);
    } catch (e: any) {
      console.error("worker: job failed", job.type, e);
      await supa()
        .from("jobs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          ok: false,
          error: e?.message || String(e),
        })
        .eq("id", job.id);
    }
  }

  res.status(200).send(`Processed ${jobs.length} jobs.`);
}
