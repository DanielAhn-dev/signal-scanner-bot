import type { AutoTradeRunSummary } from "./virtualAutoTradeService";
import { isKrxTradingDay } from "../lib/krxCalendar";

type CronAlertOptions = {
  duplicateWindowThreshold?: number;
  now?: Date;
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
  // 장외 호출은 거래일일 때만 알린다(크론 시각 설정 오류 탐지용). 주말·휴장일 호출은 정상 스킵이다.
  const outOfSessionCount = isKrxTradingDay(options?.now ?? new Date())
    ? findSkipReasonCount(summary, "out_of_session")
    : 0;
  const hasErrors = summary.errorCount > 0;
  // 호출 하나가 통째로 이미 처리된 회차였으면(백업 경로가 늦게 도착한 경우) 매매가 없으니 알리지 않는다.
  // 계정 수만큼 스킵이 쌓여 계정이 3개만 넘어도 늦은 호출 하나에 경보가 울렸다(2026-10-19).
  const wholeCallDuplicate =
    summary.processedUsers > 0 &&
    duplicateWindowCount >= summary.processedUsers &&
    summary.buyCount === 0 &&
    summary.sellCount === 0;
  const shouldAlert =
    hasErrors ||
    outOfSessionCount > 0 ||
    (!wholeCallDuplicate && duplicateWindowCount >= duplicateWindowThreshold);

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
