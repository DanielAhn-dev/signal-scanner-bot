// api/worker.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { routeMessage } from "../src/bot/router";
import { scoreStocksInSector, StockScore } from "../src/lib/stocks";
import { handleBriefCommand } from "../src/bot/commands/brief";
import { handleScoreCommand } from "../src/bot/commands/score";
import { handleBuyCommand } from "../src/bot/commands/buy";
import { handleFinanceCommand } from "../src/bot/commands/finance";
import { handleNewsCommand } from "../src/bot/commands/news";
import {
  handleSectorCommand,
  handleNextSectorCommand,
  handleSectorDetailCommand,
} from "../src/bot/commands/sector";
import { handlePullbackCommand } from "../src/bot/commands/pullback";
import { handleEconomyCommand } from "../src/bot/commands/economy";
import { handleMarketCommand } from "../src/bot/commands/market";
import { handleWatchlistQuickAdd } from "../src/bot/commands/watchlist";
import { handleRiskProfileSelection } from "../src/bot/commands/onboarding";
import { handleReportMenu } from "../src/bot/commands/report";

// supa 클라이언트는 service_role 키를 사용해야 함
const supa = () =>
  createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

const INTERNAL_SECRET = process.env.CRON_SECRET || "";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const DEFAULT_TG_TIMEOUT_MS = 5000;
const DOCUMENT_TG_TIMEOUT_MS = 30000;
const DEFAULT_JOB_TIMEOUT_MS = 7800;
const REPORT_JOB_TIMEOUT_MS = 45000;

export const config = {
  maxDuration: 60,
};

// ---- Telegram 호출 유틸 ----

type TGApiResponse = { ok?: boolean; result?: any; description?: string };
type TGRequest = {
  method: string;
  signal: AbortSignal;
  headers?: Record<string, string>;
  body?: string | FormData;
};
type TGFetchResponse = { json(): Promise<TGApiResponse> };

async function tgFetch(method: string, body: any): Promise<TGApiResponse> {
  if (!TELEGRAM_BOT_TOKEN) {
    return { ok: false, description: "TELEGRAM_BOT_TOKEN missing" };
  }

  const controller = new AbortController();
  const timeoutMs = method === "sendDocument" ? DOCUMENT_TG_TIMEOUT_MS : DEFAULT_TG_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const isMultipart = typeof FormData !== "undefined" && body instanceof FormData;
    const req: TGRequest = {
      method: "POST",
      signal: controller.signal,
    };

    if (isMultipart) {
      req.body = body;
    } else {
      req.headers = { "content-type": "application/json" };
      req.body = JSON.stringify(body);
    }

    const res = (await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`,
      req as RequestInit
    )) as TGFetchResponse;
    return await res.json();
  } catch (e) {
    return { ok: false, description: String(e) };
  } finally {
    clearTimeout(timer);
  }
}

function withTimeout<T>(
  p: Promise<T>,
  ms = DEFAULT_JOB_TIMEOUT_MS,
  label = "job"
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      const error = new Error(`TIMEOUT: ${label} (${ms}ms)`);
      error.name = "TimeoutError";
      reject(error);
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

async function sendPromptForCommand(
  kind: string,
  chatId: number,
  tgSend: any
): Promise<void> {
  const presets: Record<string, { title: string; placeholder: string }> = {
    score: { title: "점수 조회", placeholder: "[score] 종목명 또는 코드 입력" },
    buy: { title: "매수 전략 조회", placeholder: "[buy] 종목명 또는 코드 입력" },
    finance: { title: "재무 조회", placeholder: "[finance] 종목명 또는 코드 입력" },
    news: { title: "뉴스 조회", placeholder: "[news] 종목명 또는 코드 입력" },
    flow: { title: "수급 조회", placeholder: "[flow] 종목명 또는 코드 입력" },
    capital: { title: "투자금 설정", placeholder: "[capital] 300만원 3 8 안전형" },
  };

  const preset = presets[kind];
  if (!preset) {
    await tgSend("sendMessage", {
      chat_id: chatId,
      text: "지원하지 않는 입력 요청입니다.",
    });
    return;
  }

  await tgSend("sendMessage", {
    chat_id: chatId,
    text: `${preset.title}할 종목을 입력하세요.`,
    reply_markup: {
      force_reply: true,
      input_field_placeholder: preset.placeholder,
    },
  });
}

async function routeCallback(
  data: string,
  ctx: { chatId: number; from?: any },
  tgSend: any
): Promise<void> {
  if (data.startsWith("cmd:")) {
    const cmd = data.slice(4);

    if (cmd === "brief") return handleBriefCommand(ctx, tgSend);
    if (cmd === "report") return handleReportMenu(ctx, tgSend);
    if (cmd.startsWith("report:")) return routeMessage(`/report ${cmd.slice(7)}`, ctx, tgSend);
    if (cmd === "market") return handleMarketCommand(ctx, tgSend);
    if (cmd === "economy") return handleEconomyCommand(ctx, tgSend);
    if (cmd === "sector") return handleSectorCommand(ctx, tgSend);
    if (cmd === "nextsector") return handleNextSectorCommand(ctx, tgSend);
    if (cmd === "pullback") return handlePullbackCommand(ctx, tgSend);

    return routeMessage(`/${cmd}`, ctx, tgSend);
  }

  if (data.startsWith("prompt:")) {
    return sendPromptForCommand(data.slice(7), ctx.chatId, tgSend);
  }

  if (data.startsWith("risk:")) {
    const profile = data.slice(5);
    if (profile === "safe" || profile === "balanced" || profile === "active") {
      return handleRiskProfileSelection(profile, ctx, tgSend);
    }
  }

  if (data.startsWith("score:")) return handleScoreCommand(data.slice(6), ctx, tgSend);
  if (data.startsWith("buy:")) return handleBuyCommand(data.slice(4), ctx, tgSend);
  if (data.startsWith("finance:")) return handleFinanceCommand(data.slice(8), ctx, tgSend);
  if (data.startsWith("news:")) return handleNewsCommand(data.slice(5), ctx, tgSend);

  if (data.startsWith("watchadd:")) {
    return handleWatchlistQuickAdd(data.slice(9), ctx, tgSend);
  }

  if (data.startsWith("sector:")) return handleSectorDetailCommand(data.slice(7), ctx, tgSend);
  if (data.startsWith("KRX:")) return handleSectorDetailCommand(data, ctx, tgSend);

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: "버튼 동작을 처리하지 못했습니다. 다시 시도해주세요.",
  });
}

function resolveJobTimeout(text: string): number {
  return /^\/(report|리포트)\b/i.test(text.trim())
    ? REPORT_JOB_TIMEOUT_MS
    : DEFAULT_JOB_TIMEOUT_MS;
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

    const callbackTimeout = u.callback_query.data === "cmd:report" || u.callback_query.data.startsWith("cmd:report:")
      ? REPORT_JOB_TIMEOUT_MS
      : DEFAULT_JOB_TIMEOUT_MS;
    await withTimeout(
      routeCallback(u.callback_query.data, { chatId, from }, tgFetch),
      callbackTimeout,
      `callback ${u.callback_query.data}`
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
        finance: "/재무",
        news: "/뉴스",
        flow: "/수급",
        capital: "/투자금",
      };
      const prefix = cmdFromPlaceholder
        ? cmdMap[cmdFromPlaceholder]
        : null;

      // reply 텍스트 패턴으로도 매칭 시도
      const fallbackCmd = !prefix
        ? replyText.includes("점수") ? "/점수"
        : replyText.includes("매수") ? "/매수"
        : replyText.includes("재무") ? "/재무"
        : replyText.includes("뉴스") ? "/뉴스"
        : replyText.includes("수급") ? "/수급"
        : replyText.includes("투자금") ? "/투자금"
        : null
        : null;

      const resolvedPrefix = prefix || fallbackCmd;
      if (resolvedPrefix) {
        text = `${resolvedPrefix} ${text}`;
      }
    }

    await tgFetch("sendChatAction", { chat_id: chatId, action: "typing" });
    console.log("[worker] routeMessage 호출", { text, chatId, from });
    await withTimeout(
      routeMessage(text, { chatId, from }, async (method: string, body: any) => {
        const resp = await tgFetch(method, body);
        console.log("[worker] tgSend 호출", { method, body, resp });
        return resp;
      }),
      resolveJobTimeout(text),
      `routeMessage ${text}`
    );
    console.log("[worker] routeMessage 완료");
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
  const WORKER_DEADLINE = Date.now() + 55000;
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
