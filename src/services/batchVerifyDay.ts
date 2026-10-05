/**
 * 일일 배치 직후 검증이 보는 "배치 기준일" 계산.
 *
 * 배치는 KST 18:10 예약이지만 GitHub 스케줄이 4~5시간 늦고 실행에 최대 1시간이 걸려 자정을 넘겨 끝난다
 * (2026-10-02 금요일 배치는 토요일 01:28 종료 → 검증이 "휴장일"로 오판해 건너뜀).
 * 그래서 현재 시각에서 8시간을 뺀 KST 날짜를 배치 기준일로 본다(18:10 정시 실행은 같은 날, 새벽 종료는 전날).
 */

import { isKrxTradingDate, previousKrxTradingDate } from "../lib/krxCalendar";

const BATCH_LAG_MS = 8 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 배치가 처리했어야 하는 날짜(YYYY-MM-DD) */
export function resolveBatchDay(now: Date): string {
  return new Date(now.getTime() - BATCH_LAG_MS + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * 배치가 최신 값으로 채웠어야 하는 거래일. 기준일이 휴장일이면 직전 거래일이다
 * (휴장일에도 배치가 돌아 마지막 거래일을 다시 처리하므로 그날 데이터가 온전한지 계속 본다 — 2026-10-05 대체공휴일).
 */
export function expectedTradingDay(now: Date): string {
  const day = resolveBatchDay(now);
  return isKrxTradingDate(day) ? day : previousKrxTradingDate(day);
}
