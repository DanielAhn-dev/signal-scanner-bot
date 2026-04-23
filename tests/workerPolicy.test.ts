import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWorkerMetricKey,
  buildFailureMessage,
  DEFAULT_WORKER_TIMEOUTS,
  evaluateTimeoutFailureAlert,
  resolveCommandCategoryFromCallbackData,
  resolveCommandCategoryFromMessageText,
  resolveJobTimeoutByCategory,
  resolveWorkerTimeoutsFromEnv,
} from "../api/workerPolicy";

test("resolveCommandCategoryFromMessageText: 주요 명령을 카테고리로 분류한다", () => {
  assert.equal(resolveCommandCategoryFromMessageText("/리포트 주간"), "report");
  assert.equal(resolveCommandCategoryFromMessageText("/자동사이클 실행"), "autocycle");
  assert.equal(resolveCommandCategoryFromMessageText("/주간코파일럿"), "weekly");
  assert.equal(resolveCommandCategoryFromMessageText("/종목분석 삼성전자"), "trade");
  assert.equal(resolveCommandCategoryFromMessageText("/brief"), "briefing");
  assert.equal(resolveCommandCategoryFromMessageText("/help"), "default");
});

test("resolveCommandCategoryFromCallbackData: 주요 콜백을 카테고리로 분류한다", () => {
  assert.equal(resolveCommandCategoryFromCallbackData("cmd:report"), "report");
  assert.equal(resolveCommandCategoryFromCallbackData("cmd:report:full"), "report");
  assert.equal(resolveCommandCategoryFromCallbackData("cmd:autocycle:run"), "autocycle");
  assert.equal(resolveCommandCategoryFromCallbackData("trade:005930"), "trade");
  assert.equal(resolveCommandCategoryFromCallbackData("cmd:brief"), "briefing");
  assert.equal(resolveCommandCategoryFromCallbackData("cmd:unknown"), "default");
});

test("resolveJobTimeoutByCategory: 카테고리별 타임아웃을 반환한다", () => {
  assert.equal(resolveJobTimeoutByCategory("default"), 20000);
  assert.equal(resolveJobTimeoutByCategory("trade"), 45000);
  assert.equal(resolveJobTimeoutByCategory("autocycle"), 30000);
  assert.equal(resolveJobTimeoutByCategory("weekly"), 54000);
  assert.equal(resolveJobTimeoutByCategory("briefing"), 50000);
  assert.equal(resolveJobTimeoutByCategory("report"), 52000);
});

test("buildFailureMessage: 주간코파일럿 타임아웃은 강제 재실행 안내를 포함한다", () => {
  const text = buildFailureMessage({
    error: new Error("TIMEOUT: routeMessage /주간코파일럿"),
    category: "weekly",
    commandText: "/주간코파일럿",
  });

  assert.match(text, /주간코파일럿 처리 시간이 길어/);
  assert.match(text, /\/주간코파일럿 강제/);
});

test("buildFailureMessage: 리포트 타임아웃/일반 오류 문구를 구분한다", () => {
  const timeoutText = buildFailureMessage({
    error: new Error("TIMEOUT: report"),
    category: "report",
    commandText: "/리포트 주간",
  });
  assert.match(timeoutText, /리포트 생성 시간이 길어져/);

  const errorText = buildFailureMessage({
    error: new Error("network error"),
    category: "report",
    commandText: "/리포트 주간",
  });
  assert.match(errorText, /리포트 생성 중 오류/);
});

test("buildFailureMessage: 자동사이클 타임아웃은 전용 재시도 안내를 포함한다", () => {
  const text = buildFailureMessage({
    error: new Error("TIMEOUT: callback cmd:autocycle:run"),
    category: "autocycle",
    commandText: "cmd:autocycle:run",
    context: "callback",
  });

  assert.match(text, /자동사이클 요청 처리 시간이 길어/);
  assert.match(text, /\/자동사이클 점검/);
});

test("resolveWorkerTimeoutsFromEnv: env 값으로 카테고리별 타임아웃을 덮어쓴다", () => {
  const timeouts = resolveWorkerTimeoutsFromEnv({
    WORKER_TG_TIMEOUT_MS: "9000",
    WORKER_TG_DOCUMENT_TIMEOUT_MS: "45000",
    WORKER_JOB_TIMEOUT_DEFAULT_MS: "25000",
    WORKER_JOB_TIMEOUT_TRADE_MS: "47000",
    WORKER_JOB_TIMEOUT_AUTOCYCLE_MS: "33000",
    WORKER_JOB_TIMEOUT_WEEKLY_MS: "54000",
    WORKER_JOB_TIMEOUT_BRIEFING_MS: "51000",
    WORKER_JOB_TIMEOUT_REPORT_MS: "56000",
  });

  assert.equal(timeouts.tg.defaultMs, 9000);
  assert.equal(timeouts.tg.documentMs, 45000);
  assert.equal(resolveJobTimeoutByCategory("default", timeouts), 25000);
  assert.equal(resolveJobTimeoutByCategory("trade", timeouts), 47000);
  assert.equal(resolveJobTimeoutByCategory("autocycle", timeouts), 33000);
  assert.equal(resolveJobTimeoutByCategory("weekly", timeouts), 54000);
  assert.equal(resolveJobTimeoutByCategory("briefing", timeouts), 51000);
  assert.equal(resolveJobTimeoutByCategory("report", timeouts), 56000);
});

test("resolveWorkerTimeoutsFromEnv: 잘못된 env 값은 기본값으로 폴백한다", () => {
  const timeouts = resolveWorkerTimeoutsFromEnv({
    WORKER_TG_TIMEOUT_MS: "0",
    WORKER_JOB_TIMEOUT_TRADE_MS: "abc",
  });

  assert.equal(timeouts.tg.defaultMs, DEFAULT_WORKER_TIMEOUTS.tg.defaultMs);
  assert.equal(
    resolveJobTimeoutByCategory("trade", timeouts),
    DEFAULT_WORKER_TIMEOUTS.job.byCategory.trade
  );
});

test("buildWorkerMetricKey: 이벤트/컨텍스트/카테고리 조합으로 집계 키를 만든다", () => {
  assert.equal(
    buildWorkerMetricKey({
      event: "command_start",
      category: "report",
      context: "callback",
    }),
    "worker.command_start.callback.report"
  );

  assert.equal(
    buildWorkerMetricKey({
      event: "command_failed_notify",
      category: "autocycle",
      context: "message",
      isTimeout: true,
    }),
    "worker.command_failed_notify.message.autocycle.timeout"
  );
});

test("evaluateTimeoutFailureAlert: 임계치 도달 전에는 알림하지 않는다", () => {
  const config = { threshold: 3, windowMs: 10_000, cooldownMs: 10_000 };
  let state;

  const first = evaluateTimeoutFailureAlert({
    isTimeout: true,
    nowMs: 1_000,
    state,
    config,
  });
  state = first.nextState;
  assert.equal(first.shouldAlert, false);

  const second = evaluateTimeoutFailureAlert({
    isTimeout: true,
    nowMs: 2_000,
    state,
    config,
  });
  state = second.nextState;
  assert.equal(second.shouldAlert, false);
});

test("evaluateTimeoutFailureAlert: 임계치 도달 시 알림하고 cooldown 중복 알림을 막는다", () => {
  const config = { threshold: 2, windowMs: 10_000, cooldownMs: 10_000 };

  const first = evaluateTimeoutFailureAlert({
    isTimeout: true,
    nowMs: 1_000,
    state: undefined,
    config,
  });
  assert.equal(first.shouldAlert, false);

  const second = evaluateTimeoutFailureAlert({
    isTimeout: true,
    nowMs: 2_000,
    state: secondStateOrThrow(first.nextState),
    config,
  });
  assert.equal(second.shouldAlert, true);

  const third = evaluateTimeoutFailureAlert({
    isTimeout: true,
    nowMs: 3_000,
    state: secondStateOrThrow(second.nextState),
    config,
  });
  assert.equal(third.shouldAlert, false);
});

test("evaluateTimeoutFailureAlert: 윈도우가 지나면 카운트가 초기화된다", () => {
  const config = { threshold: 2, windowMs: 1_000, cooldownMs: 0 };
  const first = evaluateTimeoutFailureAlert({
    isTimeout: true,
    nowMs: 1_000,
    state: undefined,
    config,
  });

  const second = evaluateTimeoutFailureAlert({
    isTimeout: true,
    nowMs: 3_000,
    state: secondStateOrThrow(first.nextState),
    config,
  });

  assert.equal(second.shouldAlert, false);
  assert.equal(secondStateOrThrow(second.nextState).count, 1);
});

function secondStateOrThrow<T>(value: T | undefined): T {
  assert.ok(value != null);
  return value;
}
