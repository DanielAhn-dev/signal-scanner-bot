import { countKrxTradingDaysBetween, isKrxTradingDate } from "../lib/krxCalendar";

function parseYmd(value?: string | null): Date | null {
  if (!value) return null;
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo, d));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function kstNow(): Date {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  return new Date(utcMs + 9 * 60 * 60 * 1000);
}

function kstTodayUtcBase(): Date {
  const kst = kstNow();
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()));
}

export function businessDaysBehind(value?: string | null): number | null {
  const base = parseYmd(value);
  if (!base) return null;
  const today = kstTodayUtcBase();
  if (base.getTime() >= today.getTime()) return 0;
  // 주말뿐 아니라 KRX 휴장일도 뺀다 (연휴 직후 "3영업일 지연"으로 매수가 막히던 문제)
  return countKrxTradingDaysBetween(base.toISOString().slice(0, 10), today.toISOString().slice(0, 10));
}

/**
 * 일봉 기반 데이터(점수·수급)의 "기대 대비" 지연 영업일.
 * 일일 배치는 장 마감 후 저녁에 돌기 때문에, 거래일 당일 배치 전에는 직전 거래일 데이터가 최신이다.
 * 예전엔 이를 1영업일 지연으로 봐서 장중 자동매매가 매번 진입 수 60% · 최소점수 +6 보수 모드로 돌았다.
 * 당일이 거래일이고 당일 데이터가 아직 없으면 1일을 빼고 센다 (전날 배치가 실패했으면 여전히 1 이상).
 */
export function businessDaysBehindExpected(value?: string | null): number | null {
  const lag = businessDaysBehind(value);
  if (lag == null || lag === 0) return lag;
  const todayKey = kstTodayUtcBase().toISOString().slice(0, 10);
  return isKrxTradingDate(todayKey) ? lag - 1 : lag;
}

export function isBusinessStale(value: string | null | undefined, maxBusinessDays = 1): boolean {
  const diff = businessDaysBehind(value);
  if (diff == null) return true;
  return diff > maxBusinessDays;
}

export function buildFreshnessLabel(value: string | null | undefined, maxBusinessDays = 1): string {
  const diff = businessDaysBehind(value);
  if (diff == null) return "기준일 확인 불가";
  if (diff === 0) return "당일 기준";
  if (diff <= maxBusinessDays) return `최대 허용 범위 (${diff}영업일 차이)`;
  return `지연 ${diff}영업일`;
}
