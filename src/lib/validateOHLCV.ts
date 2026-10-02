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
import { countKrxTradingDaysBetween, toKstDateKey } from "./krxCalendar";

/** 전일 대비 허용 최대 배율 (한국 가격제한폭 30% + 여유분) */
const MAX_DAILY_RATIO = 1.8;
/** 전일 대비 허용 최소 배율 */
const MIN_DAILY_RATIO = 0.2;

/** 이 일수보다 길게 비어 있으면 가격 수준 변화를 분할이 아닌 실제 변동으로 본다 */
const LEVEL_SHIFT_MAX_GAP_DAYS = 10;

function calendarGapDays(from: string, to: string): number {
  const a = Date.parse(String(from).slice(0, 10));
  const b = Date.parse(String(to).slice(0, 10));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** 과거 봉을 새 가격 수준으로 환산한다(가격은 ratio배, 거래량은 1/ratio배) */
function rescaleBars(bars: StockOHLCV[], ratio: number): void {
  for (let i = 0; i < bars.length; i += 1) {
    const b = bars[i];
    bars[i] = {
      ...b,
      open: b.open * ratio,
      high: b.high * ratio,
      low: b.low * ratio,
      close: b.close * ratio,
      volume: b.volume / ratio,
    };
  }
}

/**
 * OHLCV 배열에서 명백한 오류 데이터를 제거하고 날짜순으로 정렬해 반환
 */
export function sanitizeOHLCV(data: StockOHLCV[]): StockOHLCV[] {
  if (!data || data.length === 0) return [];

  const sorted = [...data].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const valid: StockOHLCV[] = [];

  for (let i = 0; i < sorted.length; i += 1) {
    const bar = sorted[i];
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
      const prev = valid[valid.length - 1];
      const ratio = prev.close > 0 ? bar.close / prev.close : 1;
      if (ratio > MAX_DAILY_RATIO || ratio < MIN_DAILY_RATIO) {
        const gapDays = calendarGapDays(prev.date, bar.date);
        const next = sorted[i + 1];
        const nextRatio = next && bar.close > 0 ? next.close / bar.close : null;
        const persists =
          nextRatio !== null && nextRatio >= MIN_DAILY_RATIO && nextRatio <= MAX_DAILY_RATIO;
        if (!persists) {
          continue; // 하루짜리 비정상 스파이크(또는 확인할 다음 봉이 없음): 신호 오염 방지
        }
        // 다음 봉도 새 수준에 머문다 = 액면분할·병합으로 가격 수준이 바뀐 것.
        // 이 봉만 버리면 기준 종가가 분할 전에 남아 이후 봉이 전부 버려지므로 과거 봉을 새 수준에 맞춰 환산한다.
        // 거래 공백이 길면 실제 가격 변동일 수 있어 환산하지 않고 그대로 받아들인다.
        if (gapDays <= LEVEL_SHIFT_MAX_GAP_DAYS) {
          rescaleBars(valid, ratio);
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
 * KRX 거래일 기준 (주말·휴장일 제외) 으로 계산.
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
  const ref = today ?? new Date();
  const bizDays = countKrxTradingDaysBetween(String(latest.date).slice(0, 10), toKstDateKey(ref));
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
