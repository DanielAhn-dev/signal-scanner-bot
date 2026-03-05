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
    const from = u.callback_query.from;

    await tgFetch("answerCallbackQuery", {
      callback_query_id: u.callback_query.id,
      text: "처리 중\u2026",
      show_alert: false,
    });

    await withTimeout(
      routeCallback(u.callback_query.data, { chatId, from }, tgFetch)
    );
    return;
  }

  // 일반 텍스트 메시지
  if (u?.message?.text && u?.message?.chat?.id) {
    const chatId = u.message.chat.id as number;
    const from = u.message.from;
    let text = String(u.message.text || "").trim();
    if (!text) return;

    // force_reply 응답 → reply_to_message에서 명령어 컨텍스트 추출
    const replyText = u.message.reply_to_message?.text || "";
    const placeholderMatch = (
      u.message.reply_to_message?.reply_markup?.force_reply
        ? (u.message.reply_to_message?.reply_markup?.input_field_placeholder || "")
        : ""
    ).match(/^\[(\w+)\]/);

    if (!text.startsWith("/") && (placeholderMatch || replyText)) {
      // placeholder에서 명령어 추출: "[score] 종목명 입력…"
      const cmdFromPlaceholder = placeholderMatch?.[1];
      // 혹은 메시지 텍스트에서 추출: "💯 점수 조회" 등
      const cmdMap: Record<string, string> = {
        score: "/점수",
        buy: "/매수",
        news: "/뉴스",
        flow: "/수급",
      };
      const prefix = cmdFromPlaceholder
        ? cmdMap[cmdFromPlaceholder]
        : null;

      // reply 텍스트 패턴으로도 매칭 시도
      const fallbackCmd = !prefix
        ? replyText.includes("점수") ? "/점수"
        : replyText.includes("매수") ? "/매수"
        : replyText.includes("뉴스") ? "/뉴스"
        : replyText.includes("수급") ? "/수급"
        : null
        : null;

      const resolvedPrefix = prefix || fallbackCmd;
      if (resolvedPrefix) {
        text = `${resolvedPrefix} ${text}`;
      }
    }

    await tgFetch("sendChatAction", { chat_id: chatId, action: "typing" });
    await withTimeout(routeMessage(text, { chatId, from }, tgFetch));
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

  // Vercel 함수 타임아웃을 고려해 최대 처리 시간 제한 (8초)
  const WORKER_DEADLINE = Date.now() + 8000;
  let totalProcessed = 0;

  // 큐가 빌 때까지 반복 처리 (처리 중 도착한 잡도 놓치지 않음)
  while (Date.now() < WORKER_DEADLINE) {
    const { data: jobs, error } = await supa()
      .from("jobs")
      .select("*")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(5);

    if (error || !jobs) {
      console.error("worker: failed to fetch jobs", error);
      break;
    }

    if (jobs.length === 0) break; // 큐 비었으면 종료

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
        totalProcessed++;
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
        totalProcessed++;
      }
    }
  }

  if (totalProcessed === 0) {
    return res.status(200).send("No pending jobs.");
  }
  res.status(200).send(`Processed ${totalProcessed} jobs.`);
}
