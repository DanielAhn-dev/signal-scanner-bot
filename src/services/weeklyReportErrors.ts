export type WeeklyReportFailureStep =
  | "trade_query"
  | "watchlist_query"
  | "sector_query"
  | "sector_stocks_query"
  | "market_data"
  | "realtime_price"
  | "font_load"
  | "pdf_render"
  | "pdf_save";

const WEEKLY_REPORT_STEP_LABEL: Record<WeeklyReportFailureStep, string> = {
  trade_query: "거래 내역 조회",
  watchlist_query: "보유 종목 조회",
  sector_query: "섹터 데이터 조회",
  sector_stocks_query: "섹터 구성 종목 조회",
  market_data: "시장 데이터 조회",
  realtime_price: "실시간 가격 조회",
  font_load: "PDF 폰트 로드",
  pdf_render: "PDF 렌더링",
  pdf_save: "PDF 저장",
};

export class WeeklyReportError extends Error {
  readonly step: WeeklyReportFailureStep;
  readonly detail: string;
  readonly cause?: unknown;

  constructor(step: WeeklyReportFailureStep, detail: string, cause?: unknown) {
    super(`[WeeklyReport:${step}] ${detail}`);
    this.name = "WeeklyReportError";
    this.step = step;
    this.detail = detail;
    this.cause = cause;
  }
}

const DEV_LOG = process.env.NODE_ENV !== "production";

function detectErrorType(error: unknown): string {
  if (error instanceof WeeklyReportError) return "WeeklyReportError";
  if (error instanceof Error) {
    if (error.name) return error.name;
    if (/timeout/i.test(error.message)) return "TimeoutError";
  }
  return "UnknownError";
}

function logWeeklyReportStep(
  level: "info" | "error",
  payload: Record<string, unknown>
) {
  const line = JSON.stringify({
    scope: "weekly_report",
    ts: new Date().toISOString(),
    ...payload,
  });

  if (level === "error") {
    console.error(line);
    return;
  }
  if (DEV_LOG) console.log(line);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

export async function runReportStep<T>(
  step: WeeklyReportFailureStep,
  fn: () => PromiseLike<T> | T
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    logWeeklyReportStep("info", {
      event: "step_done",
      step,
      duration_ms: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    logWeeklyReportStep("error", {
      event: "step_failed",
      step,
      duration_ms: Date.now() - startedAt,
      error_type: detectErrorType(error),
      error: errorMessage(error),
    });
    if (error instanceof WeeklyReportError) throw error;
    throw new WeeklyReportError(
      step,
      `${WEEKLY_REPORT_STEP_LABEL[step]} 중 오류가 발생했습니다. ${errorMessage(error)}`,
      error
    );
  }
}

export function describeWeeklyReportFailure(error: unknown): string {
  if (error instanceof WeeklyReportError) {
    return `${WEEKLY_REPORT_STEP_LABEL[error.step]} 실패: ${error.detail}`;
  }
  if (error instanceof Error && /^TIMEOUT:/i.test(error.message)) {
    return `처리 시간 초과: ${error.message.replace(/^TIMEOUT:\s*/i, "")}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}