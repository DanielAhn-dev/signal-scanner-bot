/**
 * 같은 실행창에 이미 기록이 있을 때 이번 실행을 건너뛸지. 드라이런이 남긴 기록(summary.dryRun)은 실제 실행을 막지 않는다 —
 * 예전엔 드라이런이 그날 실행창을 점유해 같은 날 실제 자동사이클이 "이미 처리됨"으로 건너뛰어졌다(2026-11-25).
 */
export function shouldSkipExistingRun(existingSummary: unknown, isDryRun: boolean): boolean {
  const wasDryRun = (existingSummary as { dryRun?: unknown } | null)?.dryRun === true;
  return !(wasDryRun && !isDryRun);
}
