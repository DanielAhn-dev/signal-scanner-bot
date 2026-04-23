export type CommandCategory =
  | "default"
  | "trade"
  | "autocycle"
  | "weekly"
  | "briefing"
  | "report";

export type WorkerTimeouts = {
  tg: {
    defaultMs: number;
    documentMs: number;
  };
  job: {
    defaultMs: number;
    byCategory: Record<CommandCategory, number>;
  };
};

export const DEFAULT_WORKER_TIMEOUTS: WorkerTimeouts = {
  tg: {
    defaultMs: 5000,
    documentMs: 30000,
  },
  job: {
    defaultMs: 20000,
    byCategory: {
      default: 20000,
      trade: 45000,
      autocycle: 30000,
      weekly: 54000,
      briefing: 50000,
      report: 52000,
    } as Record<CommandCategory, number>,
  },
} as const;

function toPositiveInt(input: string | undefined, fallback: number): number {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) return fallback;
  const intValue = Math.floor(parsed);
  return intValue > 0 ? intValue : fallback;
}

export function resolveWorkerTimeoutsFromEnv(
  env: Record<string, string | undefined> = process.env
): WorkerTimeouts {
  const base = DEFAULT_WORKER_TIMEOUTS;

  return {
    tg: {
      defaultMs: toPositiveInt(env.WORKER_TG_TIMEOUT_MS, base.tg.defaultMs),
      documentMs: toPositiveInt(env.WORKER_TG_DOCUMENT_TIMEOUT_MS, base.tg.documentMs),
    },
    job: {
      defaultMs: toPositiveInt(env.WORKER_JOB_TIMEOUT_DEFAULT_MS, base.job.defaultMs),
      byCategory: {
        default: toPositiveInt(env.WORKER_JOB_TIMEOUT_DEFAULT_MS, base.job.byCategory.default),
        trade: toPositiveInt(env.WORKER_JOB_TIMEOUT_TRADE_MS, base.job.byCategory.trade),
        autocycle: toPositiveInt(env.WORKER_JOB_TIMEOUT_AUTOCYCLE_MS, base.job.byCategory.autocycle),
        weekly: toPositiveInt(env.WORKER_JOB_TIMEOUT_WEEKLY_MS, base.job.byCategory.weekly),
        briefing: toPositiveInt(env.WORKER_JOB_TIMEOUT_BRIEFING_MS, base.job.byCategory.briefing),
        report: toPositiveInt(env.WORKER_JOB_TIMEOUT_REPORT_MS, base.job.byCategory.report),
      },
    },
  };
}

export const WORKER_TIMEOUTS = resolveWorkerTimeoutsFromEnv();

export function resolveJobTimeoutByCategory(
  category: CommandCategory,
  timeouts: WorkerTimeouts = WORKER_TIMEOUTS
): number {
  return timeouts.job.byCategory[category] ?? timeouts.job.defaultMs;
}

export function isAutoCycleCommandText(text: string): boolean {
  return /^\/(autocycle|자동사이클)(?:\s|$)/i.test(text.trim());
}

export function isTradeCommandText(text: string): boolean {
  return /^\/(analyze|종목분석)(?:\s|$)/i.test(text.trim());
}

export function isBriefCommandText(text: string): boolean {
  return /^\/(brief|morning|브리핑|장전)(?:\s|$)/i.test(text.trim());
}

export function isWeeklyCopilotCommandText(text: string): boolean {
  return /^\/(weekly|weeklycopilot|주간코파일럿)(?:\s|$)/i.test(text.trim());
}

export function isTradeCallbackData(data: string): boolean {
  return /^trade:/i.test(data.trim());
}

export function isBriefCallbackData(data: string): boolean {
  return data.trim() === "cmd:brief";
}

export function isReportCommandText(text: string): boolean {
  return /^\/(report|리포트)(?:\s|$)/i.test(text.trim());
}

export function resolveCommandCategoryFromMessageText(text: string): CommandCategory {
  const value = String(text || "").trim();
  if (isAutoCycleCommandText(value)) return "autocycle";
  if (isWeeklyCopilotCommandText(value)) return "weekly";
  if (isBriefCommandText(value)) return "briefing";
  if (isTradeCommandText(value)) return "trade";
  if (isReportCommandText(value)) return "report";
  return "default";
}

export function resolveCommandCategoryFromCallbackData(data: string): CommandCategory {
  const value = String(data || "").trim();
  if (value === "cmd:report" || value.startsWith("cmd:report:")) return "report";
  if (isBriefCallbackData(value)) return "briefing";
  if (isTradeCallbackData(value)) return "trade";
  if (value.startsWith("cmd:autocycle") || value.includes("autocycle")) return "autocycle";
  return "default";
}

export function describeCommandLabel(
  commandText?: string,
  context: "message" | "callback" = "message"
): string {
  const text = String(commandText || "").trim();
  if (!text) return context === "callback" ? "버튼 요청" : "요청";
  if (isAutoCycleCommandText(text) || /autocycle/i.test(text)) return "자동사이클 요청";
  if (isWeeklyCopilotCommandText(text) || /weeklycopilot|주간코파일럿/i.test(text)) {
    return "주간코파일럿 요청";
  }
  return isReportCommandText(text)
    ? "리포트 요청"
    : context === "callback"
    ? "버튼 요청"
    : `${text.split(/\s+/)[0]} 요청`;
}

export function buildFailureMessage(input: {
  error: unknown;
  category: CommandCategory;
  commandText?: string;
  context?: "message" | "callback";
}): string {
  const { error, category, commandText, context = "message" } = input;
  const message = error instanceof Error ? error.message : String(error);
  const isTimeout = /^TIMEOUT:/i.test(message);

  if (category === "report") {
    return isTimeout
      ? [
          "리포트 생성 시간이 길어져 이번 요청은 중단되었습니다.",
          "잠시 후 다시 시도해주세요.",
        ].join("\n")
      : [
          "리포트 생성 중 오류가 발생했습니다.",
          "잠시 후 다시 시도해주세요.",
        ].join("\n");
  }

  if (category === "weekly") {
    return isTimeout
      ? [
          "주간코파일럿 처리 시간이 길어 이번 요청은 중단되었습니다.",
          "잠시 후 /주간코파일럿 강제 로 재실행해주세요.",
        ].join("\n")
      : [
          "주간코파일럿 처리 중 오류가 발생했습니다.",
          "잠시 후 다시 시도해주세요.",
        ].join("\n");
  }

  const label = describeCommandLabel(commandText, context);
  return isTimeout
    ? [
        `${label} 처리 시간이 길어 이번 요청은 중단되었습니다.`,
        category === "autocycle"
          ? "잠시 후 /자동사이클 점검 으로 다시 확인해주세요."
          : "잠시 후 다시 시도해주세요.",
      ].join("\n")
    : [
        `${label} 처리 중 오류가 발생했습니다.`,
        "잠시 후 다시 시도해주세요.",
      ].join("\n");
}

  export function buildWorkerMetricKey(input: {
    event: "command_start" | "command_done" | "command_failed_notify";
    category: CommandCategory;
    context: "message" | "callback";
    isTimeout?: boolean;
  }): string {
    const timeoutSuffix = input.isTimeout ? ".timeout" : "";
    return `worker.${input.event}.${input.context}.${input.category}${timeoutSuffix}`;
  }

  export type FailureAlertConfig = {
    threshold: number;
    windowMs: number;
    cooldownMs: number;
  };

  export type FailureAlertState = {
    count: number;
    windowStartedAtMs: number;
    lastAlertAtMs?: number;
  };

  export function evaluateTimeoutFailureAlert(input: {
    isTimeout: boolean;
    nowMs: number;
    state?: FailureAlertState;
    config: FailureAlertConfig;
  }): { shouldAlert: boolean; nextState?: FailureAlertState } {
    const { isTimeout, nowMs, state, config } = input;
    if (!isTimeout) return { shouldAlert: false, nextState: state };

    const threshold = Math.max(1, Math.floor(config.threshold));
    const windowMs = Math.max(1, Math.floor(config.windowMs));
    const cooldownMs = Math.max(0, Math.floor(config.cooldownMs));

    const base: FailureAlertState = state
      ? { ...state }
      : { count: 0, windowStartedAtMs: nowMs };

    if (nowMs - base.windowStartedAtMs > windowMs) {
      base.count = 1;
      base.windowStartedAtMs = nowMs;
    } else {
      base.count += 1;
    }

    const cooldownPassed =
      base.lastAlertAtMs == null || nowMs - base.lastAlertAtMs >= cooldownMs;
    const shouldAlert = base.count >= threshold && cooldownPassed;
    if (shouldAlert) base.lastAlertAtMs = nowMs;

    return { shouldAlert, nextState: base };
  }
