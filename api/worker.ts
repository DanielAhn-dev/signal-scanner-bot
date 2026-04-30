// api/worker.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { routeCallbackData } from "../src/bot/callbackRouter";
const { routeMessage } = require("../src/bot/router") as {
  routeMessage: (
    text: string,
    ctx: { chatId: number; from: unknown },
    tgSend: (method: string, body: any) => Promise<any>
  ) => Promise<void>;
};
import { scoreStocksInSector, StockScore } from "../src/lib/stocks";
import {
  getReplyPrefixForPromptKind,
  resolveReplyPrefixFromText,
} from "../src/bot/commandCatalog";
import {
  WORKER_TIMEOUTS,
  resolveJobTimeoutByCategory,
  isReportCommandText,
  resolveCommandCategoryFromMessageText,
  resolveCommandCategoryFromCallbackData,
  buildFailureMessage,
  buildWorkerMetricKey,
  evaluateTimeoutFailureAlert,
  type FailureAlertConfig,
  type FailureAlertState,
  type CommandCategory,
} from "../src/server/workerPolicy";

// supa 클라이언트는 service_role 키를 사용해야 함
const supa = () =>
  createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

const INTERNAL_SECRET = process.env.CRON_SECRET || "";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_ADMIN_CHAT_ID = Number(process.env.TELEGRAM_ADMIN_CHAT_ID || "0");
const STALE_TELEGRAM_JOB_MS = 3 * 60 * 1000;
const DEV_LOG = process.env.NODE_ENV !== "production";

type FailureAlertBucketKey = `${"message" | "callback"}.${CommandCategory}.timeout`;

const failureAlertStates = new Map<FailureAlertBucketKey, FailureAlertState>();

function toPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const integer = Math.floor(parsed);
  return integer > 0 ? integer : fallback;
}

const FAILURE_ALERT_CONFIG: FailureAlertConfig = {
  threshold: toPositiveInt(process.env.WORKER_TIMEOUT_ALERT_THRESHOLD, 5),
  windowMs: toPositiveInt(process.env.WORKER_TIMEOUT_ALERT_WINDOW_MS, 10 * 60 * 1000),
  cooldownMs: toPositiveInt(process.env.WORKER_TIMEOUT_ALERT_COOLDOWN_MS, 10 * 60 * 1000),
};

function cleanupFailureAlertStates(nowMs: number): void {
  const ttl = Math.max(60_000, FAILURE_ALERT_CONFIG.windowMs * 2);
  for (const [key, state] of failureAlertStates.entries()) {
    if (nowMs - state.windowStartedAtMs > ttl) {
      failureAlertStates.delete(key);
    }
  }
}

async function notifyAdminTimeoutAlert(input: {
  category: CommandCategory;
  context: "message" | "callback";
  bucketState: FailureAlertState;
  metricKey: string;
}): Promise<void> {
  if (!TELEGRAM_ADMIN_CHAT_ID) return;
  const { category, context, bucketState, metricKey } = input;
  const windowMinutes = Math.max(1, Math.round(FAILURE_ALERT_CONFIG.windowMs / 60000));
  const text = [
    "[Worker Timeout Alert]",
    `category=${category}, context=${context}`,
    `count=${bucketState.count}, window=${windowMinutes}m`,
    `metric_key=${metricKey}`,
  ].join("\n");

  await tgFetch("sendMessage", {
    chat_id: TELEGRAM_ADMIN_CHAT_ID,
    text,
  });
}

export const config = {
  maxDuration: 60,
};

function detectErrorType(error: unknown): string {
  if (error instanceof Error) {
    if (error.name) return error.name;
    if (/timeout/i.test(error.message)) return "TimeoutError";
  }
  return "UnknownError";
}

function logWorker(
  level: "info" | "error",
  event: string,
  payload: Record<string, unknown>
) {
  const line = JSON.stringify({
    scope: "worker",
    event,
    ts: new Date().toISOString(),
    ...payload,
  });
  if (level === "error") {
    console.error(line);
    return;
  }
  if (DEV_LOG) console.log(line);
}

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
  const timeoutMs =
    method === "sendDocument"
      ? WORKER_TIMEOUTS.tg.documentMs
      : WORKER_TIMEOUTS.tg.defaultMs;
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
  ms: number = WORKER_TIMEOUTS.job.defaultMs,
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

function isStaleTelegramUpdateJob(job: { type?: string; created_at?: string | null }): boolean {
  if (job.type !== "telegram_update") return false;
  const createdAt = Date.parse(String(job.created_at || ""));
  if (!Number.isFinite(createdAt)) return false;
  return Date.now() - createdAt > STALE_TELEGRAM_JOB_MS;
}

async function notifyJobFailure(input: {
  chatId: number;
  error: unknown;
  category: CommandCategory;
  commandText?: string;
  context?: "message" | "callback";
}): Promise<void> {
  const { chatId, error, category, commandText, context } = input;
  const message = error instanceof Error ? error.message : String(error);
  const isTimeout = /^TIMEOUT:/i.test(message);
  const logContext = context ?? "message";
  const metricKey = buildWorkerMetricKey({
    event: "command_failed_notify",
    category,
    context: logContext,
    isTimeout,
  });
  logWorker("error", "command_failed_notify", {
    step: "notify_failure",
    chat_id: chatId,
    category,
    context: logContext,
    is_timeout: isTimeout,
    metric_key: metricKey,
    command: commandText,
    error_type: detectErrorType(error),
    error: message,
  });

  await tgFetch("sendMessage", {
    chat_id: chatId,
    text: buildFailureMessage({
      error,
      category,
      commandText,
      context,
    }),
  });

  if (isTimeout) {
    const nowMs = Date.now();
    cleanupFailureAlertStates(nowMs);
    const bucketKey = `${logContext}.${category}.timeout` as FailureAlertBucketKey;
    const evaluated = evaluateTimeoutFailureAlert({
      isTimeout,
      nowMs,
      state: failureAlertStates.get(bucketKey),
      config: FAILURE_ALERT_CONFIG,
    });
    if (evaluated.nextState) {
      failureAlertStates.set(bucketKey, evaluated.nextState);
      if (evaluated.shouldAlert) {
        await notifyAdminTimeoutAlert({
          category,
          context: logContext,
          bucketState: evaluated.nextState,
          metricKey,
        });
      }
    }
  }
}

async function tgCallOrThrow(
  method: string,
  body: any,
  chatId?: number
): Promise<TGApiResponse> {
  const resp = await tgFetch(method, body);
  if (DEV_LOG) {
    logWorker("info", "telegram_send", {
      step: "tg_send",
      method,
      chat_id: chatId,
      ok: Boolean(resp?.ok),
      description: resp?.ok ? undefined : resp?.description,
    });
  }

  if (!resp?.ok && method !== "answerCallbackQuery" && method !== "sendChatAction") {
    throw new Error(`Telegram ${method} failed: ${resp?.description || "unknown error"}`);
  }

  return resp;
}

async function handleTelegramUpdateJob(job: any) {
  const u = job.payload || {};

  // 콜백 버튼
  if (u?.callback_query?.data && u?.callback_query?.message?.chat?.id) {
    const chatId = u.callback_query.message.chat.id as number;
    const from = u.callback_query.from;
    const startedAt = Date.now();

    await tgFetch("answerCallbackQuery", {
      callback_query_id: u.callback_query.id,
      text: "처리 중\u2026",
      show_alert: false,
    });

    const callbackCategory = resolveCommandCategoryFromCallbackData(u.callback_query.data);
    const callbackTimeout = resolveJobTimeoutByCategory(callbackCategory);
    logWorker("info", "command_start", {
      step: "callback_route",
      command: u.callback_query.data,
      chat_id: chatId,
      job_id: job.id,
      category: callbackCategory,
      timeout_ms: callbackTimeout,
      metric_key: buildWorkerMetricKey({
        event: "command_start",
        category: callbackCategory,
        context: "callback",
      }),
    });
    try {
      await withTimeout(
        routeCallbackData(
          u.callback_query.data,
          { chatId, from, messageId: u.callback_query.message?.message_id },
          (method: string, body: any) => tgCallOrThrow(method, body, chatId)
        ),
        callbackTimeout,
        `callback ${u.callback_query.data}`
      );
    } catch (error) {
      await notifyJobFailure({
        chatId,
        error,
        category: callbackCategory,
        commandText: u.callback_query.data,
        context: "callback",
      });
      throw error;
    }
    logWorker("info", "command_done", {
      step: "callback_route",
      command: u.callback_query.data,
      chat_id: chatId,
      job_id: job.id,
      duration_ms: Date.now() - startedAt,
      metric_key: buildWorkerMetricKey({
        event: "command_done",
        category: callbackCategory,
        context: "callback",
      }),
    });
    return;
  }

  // 일반 텍스트 메시지
  if (u?.message?.text && u?.message?.chat?.id) {
    const chatId = u.message.chat.id as number;
    const from = u.message.from;
    const startedAt = Date.now();
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
      const prefix = cmdFromPlaceholder
        ? getReplyPrefixForPromptKind(cmdFromPlaceholder)
        : null;

      // reply 텍스트 패턴으로도 매칭 시도
      const fallbackCmd = !prefix
        ? resolveReplyPrefixFromText(replyText) ?? null
        : null;

      const resolvedPrefix = prefix || fallbackCmd;
      if (resolvedPrefix) {
        text = `${resolvedPrefix} ${text}`;
      }
    }

    await tgFetch("sendChatAction", { chat_id: chatId, action: "typing" });
    const messageCategory = resolveCommandCategoryFromMessageText(text);
    const messageTimeout = resolveJobTimeoutByCategory(messageCategory);
    logWorker("info", "command_start", {
      step: "route_message",
      command: text,
      chat_id: chatId,
      job_id: job.id,
      category: messageCategory,
      timeout_ms: messageTimeout,
      metric_key: buildWorkerMetricKey({
        event: "command_start",
        category: messageCategory,
        context: "message",
      }),
    });
    try {
      await withTimeout(
        routeMessage(text, { chatId, from }, (method: string, body: any) =>
          tgCallOrThrow(method, body, chatId)
        ),
        messageTimeout,
        `routeMessage ${text}`
      );
    } catch (error) {
      await notifyJobFailure({
        chatId,
        error,
        category: messageCategory,
        commandText: text,
        context: "message",
      });
      throw error;
    }
    logWorker("info", "command_done", {
      step: "route_message",
      command: text,
      chat_id: chatId,
      job_id: job.id,
      duration_ms: Date.now() - startedAt,
      metric_key: buildWorkerMetricKey({
        event: "command_done",
        category: messageCategory,
        context: "message",
      }),
    });
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
    const fetchStartedAt = Date.now();
    const { data: jobs, error } = await supa()
      .from("jobs")
      .select("*")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(5);

    if (error || !jobs) {
      logWorker("error", "jobs_fetch_failed", {
        step: "fetch_jobs",
        duration_ms: Date.now() - fetchStartedAt,
        error_type: detectErrorType(error),
        error: error?.message || String(error),
      });
      break;
    }

    if (jobs.length === 0) break; // 큐 비었으면 종료

    for (const job of jobs) {
      const jobStartedAt = Date.now();

      const { data: claimed } = await supa()
        .from("jobs")
        .update({ status: "running", started_at: new Date().toISOString() })
        .eq("id", job.id)
        .eq("status", "queued")
        .select("id");

      if (!claimed || claimed.length === 0) {
        logWorker("info", "job_skipped", {
          step: "claim_job",
          job_id: job.id,
          job_type: job.type,
          reason: "already_claimed",
        });
        continue;
      }

      logWorker("info", "job_start", {
        step: "start_job",
        job_id: job.id,
        job_type: job.type,
      });

      if (isStaleTelegramUpdateJob(job)) {
        logWorker("info", "job_skipped", {
          step: "drop_stale_job",
          job_id: job.id,
          job_type: job.type,
          created_at: job.created_at,
          stale_after_ms: STALE_TELEGRAM_JOB_MS,
          reason: "stale_telegram_update",
        });
        await supa()
          .from("jobs")
          .update({
            status: "failed",
            finished_at: new Date().toISOString(),
            ok: false,
            error: "stale telegram update dropped",
          })
          .eq("id", job.id);
        totalProcessed++;
        continue;
      }

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
        logWorker("info", "job_done", {
          step: "complete_job",
          job_id: job.id,
          job_type: job.type,
          duration_ms: Date.now() - jobStartedAt,
        });
        totalProcessed++;
      } catch (e: any) {
        logWorker("error", "job_failed", {
          step: "process_job",
          job_id: job.id,
          job_type: job.type,
          duration_ms: Date.now() - jobStartedAt,
          error_type: detectErrorType(e),
          error: e?.message || String(e),
        });
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
