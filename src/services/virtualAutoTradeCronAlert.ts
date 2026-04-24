import type { AutoTradeRunSummary } from "./virtualAutoTradeService";

type CronAlertOptions = {
  duplicateWindowThreshold?: number;
};

function findSkipReasonCount(summary: AutoTradeRunSummary, code: string): number {
  return summary.skipReasonStats.find((stat) => stat.code === code)?.count ?? 0;
}

export function buildAutoTradeCronAlertMessage(
  summary: AutoTradeRunSummary,
  options?: CronAlertOptions
): string | null {
  const duplicateWindowThreshold = Math.max(1, Math.floor(options?.duplicateWindowThreshold ?? 3));
  const duplicateWindowCount = findSkipReasonCount(summary, "duplicate_window");
  const outOfSessionCount = findSkipReasonCount(summary, "out_of_session");
  const hasErrors = summary.errorCount > 0;
  const shouldAlert =
    hasErrors || outOfSessionCount > 0 || duplicateWindowCount >= duplicateWindowThreshold;

  if (!shouldAlert) return null;

  const lines = [
    "[자동사이클 운영 알림]",
    `runKey=${summary.runKey}`,
    `실행 ${summary.processedUsers}/${summary.totalUsers} · 매수 ${summary.buyCount} · 매도 ${summary.sellCount} · 스킵 ${summary.skippedCount} · 오류 ${summary.errorCount}`,
  ];

  if (summary.skipReasonStats.length > 0) {
    lines.push(
      `스킵 상위: ${summary.skipReasonStats
        .slice(0, 3)
        .map((stat) => `${stat.label} ${stat.count}건`)
        .join(" · ")}`
    );
  }

  if (hasErrors) {
    lines.push("조치: 오류 로그와 virtual_autotrade_runs 상세를 우선 확인하세요.");
  } else if (outOfSessionCount > 0) {
    lines.push("조치: 장중 cron 시각 또는 intradayOnly 호출 경로를 확인하세요.");
  } else {
    lines.push("조치: 수동 실행/중복 호출 여부를 확인하세요.");
  }

  return lines.join("\n");
}
