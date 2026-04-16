/**
 * OHLCV 데이터 품질 검증 유틸
 *
 * - 가격/거래량 음수 / 0 제거
 * - high < low 역전 제거
 * - 종가가 [low, high] 범위 밖인 막대 제거
 * - 전일 대비 비정상 스파이크 제거 (±80% 초과)
 * - 데이터 최신성(staleness) 체크
 */

import type { StockOHLCV } from "../data/types";

/** 전일 대비 허용 최대 배율 (한국 가격제한폭 30% + 여유분) */
const MAX_DAILY_RATIO = 1.8;
/** 전일 대비 허용 최소 배율 */
const MIN_DAILY_RATIO = 0.2;

/**
 * OHLCV 배열에서 명백한 오류 데이터를 제거하고 날짜순으로 정렬해 반환
 */
export function sanitizeOHLCV(data: StockOHLCV[]): StockOHLCV[] {
  if (!data || data.length === 0) return [];

  const sorted = [...data].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const valid: StockOHLCV[] = [];

  for (const bar of sorted) {
    // 기본 유효성: 핵심 가격 필드가 양수여야 함
    if (
      bar.close <= 0 ||
      bar.open <= 0 ||
      bar.high <= 0 ||
      bar.low <= 0 ||
      bar.volume < 0
    ) {
      continue;
    }

    // 가격 범위 일관성: high ≥ low, close/open ∈ [low, high]
    if (bar.high < bar.low) continue;
    if (bar.close > bar.high || bar.close < bar.low) continue;
    if (bar.open > bar.high || bar.open < bar.low) continue;

    // 전일 대비 스파이크 필터 (데이터 오류 탐지)
    if (valid.length > 0) {
      const prevClose = valid[valid.length - 1].close;
      if (prevClose > 0) {
        const ratio = bar.close / prevClose;
        if (ratio > MAX_DAILY_RATIO || ratio < MIN_DAILY_RATIO) {
          continue; // 비정상 스파이크: 위험한 신호 오염 방지
        }
      }
    }

    valid.push(bar);
  }

  return valid;
}

/**
 * 가장 최근 데이터가 maxBizDays 영업일 이상 오래됐으면 stale로 판단
 *
 * 영업일 기준 (토·일 제외) 으로 계산.
 * today 미지정 시 현재 날짜 기준.
 */
export function isOHLCVStale(
  data: StockOHLCV[],
  maxBizDays = 5,
  today?: Date
): boolean {
  if (!data || data.length === 0) return true;

  const latest = data.reduce((best, d) =>
    d.date > best.date ? d : best
  );
  const latestDate = new Date(latest.date);
  const ref = today ?? new Date();

  // 영업일 계산 (토=6, 일=0 제외)
  let bizDays = 0;
  const cursor = new Date(latestDate);
  cursor.setDate(cursor.getDate() + 1); // 다음날부터 카운트

  while (cursor <= ref) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) bizDays++;
    cursor.setDate(cursor.getDate() + 1);
    if (bizDays > maxBizDays) return true; // early exit
  }

  return bizDays > maxBizDays;
}

/**
 * 데이터 품질 요약 반환 (로깅/모니터링용)
 */
export interface OHLCVQualitySummary {
  totalRows: number;
  validRows: number;
  removedRows: number;
  stale: boolean;
  latestDate: string | null;
}

export function summarizeOHLCVQuality(
  raw: StockOHLCV[],
  maxBizDays = 5
): OHLCVQualitySummary {
  const valid = sanitizeOHLCV(raw);
  return {
    totalRows: raw.length,
    validRows: valid.length,
    removedRows: raw.length - valid.length,
    stale: isOHLCVStale(valid, maxBizDays),
    latestDate: valid.length > 0 ? valid[valid.length - 1].date : null,
  };
}
