import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const CRON_SECRET = process.env.CRON_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_HOBBY_DAILY_MODE =
  String(process.env.CRON_HOBBY_DAILY_MODE ?? "true").toLowerCase() !== "false";

type CronTaskName =
  | "scoreSync"
  | "briefing"
  | "report"
  | "virtualAutoTrade"
  | "virtualAutoTradeIntraday"
  | "strategyGateRefresh";

type DueTask = {
  name: CronTaskName;
  path: string;
};

const TASK_PATHS: Record<CronTaskName, string> = {
  scoreSync: "/api/cron/scoreSync",
  briefing: "/api/cron/briefing",
  report: "/api/cron/report",
  virtualAutoTrade: "/api/cron/virtualAutoTrade",
  virtualAutoTradeIntraday:
    "/api/cron/virtualAutoTrade?mode=auto&intradayOnly=true&windowMinutes=10&maxUsers=60",
  strategyGateRefresh: "/api/cron/strategyGateRefresh",
};

function getBaseUrl(req: VercelRequest): string {
  const explicit = process.env.CRON_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, "");

  const host = req.headers.host;
  if (!host) {
    throw new Error("Missing host header and CRON_BASE_URL");
  }

  const proto = String(req.headers["x-forwarded-proto"] || "https");
  return `${proto}://${host}`;
}

function utcNowParts(date: Date): { dow: number; hour: number; minute: number } {
  return {
    dow: date.getUTCDay(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
}

function resolveDueTasks(now = new Date()): DueTask[] {
  const { dow, hour, minute } = utcNowParts(now);

  if (CRON_HOBBY_DAILY_MODE) {
    if (hour !== 23 || minute !== 0) return [];

    const dailyTasks: DueTask[] = [
      { name: "scoreSync", path: TASK_PATHS.scoreSync },
      { name: "briefing", path: TASK_PATHS.briefing },
      { name: "virtualAutoTrade", path: TASK_PATHS.virtualAutoTrade },
      { name: "strategyGateRefresh", path: TASK_PATHS.strategyGateRefresh },
    ];

    // 주간 리포트는 금요일만 실행
    if (dow === 5) {
      dailyTasks.push({ name: "report", path: TASK_PATHS.report });
    }

    return dailyTasks;
  }

  const tasks: DueTask[] = [];

  // scoreSync: 40 6 * * 1-5
  if (dow >= 1 && dow <= 5 && hour === 6 && minute === 40) {
    tasks.push({ name: "scoreSync", path: TASK_PATHS.scoreSync });
  }

  // scoreSync: 0 23 * * 0-4
  if (dow >= 0 && dow <= 4 && hour === 23 && minute === 0) {
    tasks.push({ name: "scoreSync", path: TASK_PATHS.scoreSync });
  }

  // briefing: 30 23 * * 0-4
  if (dow >= 0 && dow <= 4 && hour === 23 && minute === 30) {
    tasks.push({ name: "briefing", path: TASK_PATHS.briefing });
  }

  // briefing: 10 6 * * 1-5
  if (dow >= 1 && dow <= 5 && hour === 6 && minute === 10) {
    tasks.push({ name: "briefing", path: TASK_PATHS.briefing });
  }

  // report: 35 23 * * 5
  if (dow === 5 && hour === 23 && minute === 35) {
    tasks.push({ name: "report", path: TASK_PATHS.report });
  }

  // virtualAutoTrade: 45 23 * * 0-4
  if (dow >= 0 && dow <= 4 && hour === 23 && minute === 45) {
    tasks.push({ name: "virtualAutoTrade", path: TASK_PATHS.virtualAutoTrade });
  }

  // 장중 10분 자동사이클은 무료 플랜 소모를 고려해 수동 트리거(task=virtualAutoTradeIntraday)로만 실행

  // 전략 게이트 리프레시 + 자동 튜닝: 23:55 UTC, 평일(UTC 0~4)
  if (dow >= 0 && dow <= 4 && hour === 23 && minute === 55) {
    tasks.push({
      name: "strategyGateRefresh",
      path: TASK_PATHS.strategyGateRefresh,
    });
  }

  return tasks;
}

async function claimTaskExecution(input: {
  supabase: any;
  taskName: string;
  key: string;
}): Promise<boolean> {
  const { error } = await input.supabase.from("jobs").insert({
    type: "cron_dispatch",
    status: "queued",
    dedup_key: `${input.taskName}:${input.key}`,
    payload: { task: input.taskName, key: input.key },
  });

  if (!error) return true;
  const code = String((error as any)?.code || "");
  if (code === "23505") return false;
  throw error;
}

async function callTask(baseUrl: string, taskPath: string): Promise<{ ok: boolean; status: number; body: string }> {
  const response = await fetch(`${baseUrl}${taskPath}`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${CRON_SECRET}`,
      "x-cron-dispatch": "1",
    },
  });

  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    body: text.slice(0, 2000),
  };
}

export const config = {
  maxDuration: 60,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).send("Method Not Allowed");
  }

  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).send("Unauthorized");
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ ok: false, error: "Missing supabase credentials" });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false },
    });

    const forceTask = typeof req.query.task === "string" ? req.query.task : undefined;
    const dueTasks = forceTask
      ? [forceTask]
          .filter((task): task is CronTaskName => task in TASK_PATHS)
          .map((task) => ({ name: task, path: TASK_PATHS[task] }))
      : resolveDueTasks(new Date());

    if (!dueTasks.length) {
      return res.status(200).json({ ok: true, triggered: [], skipped: "no_due_task" });
    }

    const baseUrl = getBaseUrl(req);
    const nowIsoMinuteKey = new Date().toISOString().slice(0, 16);

    const results: Array<{
      task: string;
      claimed: boolean;
      ok?: boolean;
      status?: number;
      body?: string;
      error?: string;
    }> = [];

    for (const task of dueTasks) {
      try {
        const claimed = await claimTaskExecution({
          supabase,
          taskName: task.name,
          key: nowIsoMinuteKey,
        });

        if (!claimed) {
          results.push({ task: task.name, claimed: false });
          continue;
        }

        const callResult = await callTask(baseUrl, task.path);
        results.push({
          task: task.name,
          claimed: true,
          ok: callResult.ok,
          status: callResult.status,
          body: callResult.body,
        });
      } catch (error: any) {
        results.push({
          task: task.name,
          claimed: true,
          error: error?.message ?? String(error),
        });
      }
    }

    const hasError = results.some((result) => result.error || result.ok === false);
    return res.status(hasError ? 500 : 200).json({
      ok: !hasError,
      dueCount: dueTasks.length,
      results,
    });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: error?.message ?? String(error),
    });
  }
}
