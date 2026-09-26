/**
 * KRX(유가증권·코스닥) 휴장일 캘린더.
 *
 * 예전엔 "토·일만 아니면 개장"으로 판단해 2026-09-24(추석 연휴)에도 자동매매가 전일 종가로 매수를 체결했고,
 * 연휴 다음 날엔 점수 기준일이 "3영업일 지연"으로 잡혀 매수가 막힐 수 있었다.
 *
 * - 2025·2026: stock_daily(005930) 실제 누락일과 대조 검증 (2026-05-22 누락은 수집 누락이라 제외)
 * - 2027: 공휴일·대체공휴일 기준 추정치 — 거래소 휴장일 공지(매년 12월) 확인 후 갱신할 것
 * - 연말 휴장일(12/31)은 공휴일이 아니지만 KRX 휴장이라 포함
 * scripts/batch_modules/utils.py의 KRX_HOLIDAYS와 같은 목록을 유지한다.
 */
const KRX_HOLIDAYS_BY_YEAR: Record<number, string[]> = {
  2025: [
    "2025-01-01", "2025-01-27", "2025-01-28", "2025-01-29", "2025-01-30", "2025-03-03",
    "2025-05-01", "2025-05-05", "2025-05-06", "2025-06-03", "2025-06-06", "2025-08-15",
    "2025-10-03", "2025-10-06", "2025-10-07", "2025-10-08", "2025-10-09", "2025-12-25",
    "2025-12-31",
  ],
  2026: [
    "2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18", "2026-03-02", "2026-05-01",
    "2026-05-05", "2026-05-25", "2026-06-03", "2026-07-17", "2026-08-17", "2026-09-24",
    "2026-09-25", "2026-10-05", "2026-10-09", "2026-12-25", "2026-12-31",
  ],
  2027: [
    "2027-01-01", "2027-02-08", "2027-02-09", "2027-03-01", "2027-05-03", "2027-05-05",
    "2027-05-13", "2027-07-19", "2027-08-16", "2027-09-14", "2027-09-15", "2027-09-16",
    "2027-10-04", "2027-10-11", "2027-12-27", "2027-12-31",
  ],
};

const KRX_HOLIDAYS = new Set(Object.values(KRX_HOLIDAYS_BY_YEAR).flat());
export const KRX_CALENDAR_COVERED_YEARS = Object.keys(KRX_HOLIDAYS_BY_YEAR).map(Number);

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** Date → KST 기준 YYYY-MM-DD */
export function toKstDateKey(base: Date = new Date()): string {
  return new Date(base.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function parseDateKey(value: string): Date | null {
  const m = String(value ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function isKrxHoliday(dateKey: string): boolean {
  return KRX_HOLIDAYS.has(String(dateKey).slice(0, 10));
}

/** YYYY-MM-DD가 KRX 거래일인지 (주말·휴장일 제외) */
export function isKrxTradingDate(dateKey: string): boolean {
  const dt = parseDateKey(dateKey);
  if (!dt) return false;
  const day = dt.getUTCDay();
  if (day === 0 || day === 6) return false;
  return !KRX_HOLIDAYS.has(dt.toISOString().slice(0, 10));
}

/** 시각(Date)의 KST 날짜가 KRX 거래일인지 */
export function isKrxTradingDay(base: Date = new Date()): boolean {
  return isKrxTradingDate(toKstDateKey(base));
}

/** KRX 정규장(09:00~15:30 KST) 여부. inclusiveClose=true면 15:30 정각도 포함 */
export function isKrxRegularSession(base: Date = new Date(), options?: { inclusiveClose?: boolean }): boolean {
  if (!isKrxTradingDay(base)) return false;
  const kst = new Date(base.getTime() + KST_OFFSET_MS);
  const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const close = 15 * 60 + 30;
  return minutes >= 9 * 60 && (options?.inclusiveClose ? minutes <= close : minutes < close);
}

function shiftDateKey(dateKey: string, days: number): string {
  const dt = parseDateKey(dateKey);
  if (!dt) return dateKey;
  return new Date(dt.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** dateKey 이전(자기 자신 제외) n번째 거래일 */
export function previousKrxTradingDate(dateKey: string, n = 1): string {
  let cursor = String(dateKey).slice(0, 10);
  let remaining = Math.max(1, Math.floor(n));
  for (let guard = 0; guard < 400 && remaining > 0; guard += 1) {
    cursor = shiftDateKey(cursor, -1);
    if (isKrxTradingDate(cursor)) remaining -= 1;
  }
  return cursor;
}

/** dateKey 이후(자기 자신 제외) 첫 거래일 */
export function nextKrxTradingDate(dateKey: string): string {
  let cursor = String(dateKey).slice(0, 10);
  for (let guard = 0; guard < 400; guard += 1) {
    cursor = shiftDateKey(cursor, 1);
    if (isKrxTradingDate(cursor)) return cursor;
  }
  return cursor;
}

/** (from, to] 구간의 거래일 수. from ≥ to면 0 */
export function countKrxTradingDaysBetween(fromKey: string, toKey: string): number {
  const from = parseDateKey(fromKey);
  const to = parseDateKey(toKey);
  if (!from || !to || from.getTime() >= to.getTime()) return 0;
  let count = 0;
  for (let t = from.getTime() + DAY_MS; t <= to.getTime(); t += DAY_MS) {
    if (isKrxTradingDate(new Date(t).toISOString().slice(0, 10))) count += 1;
  }
  return count;
}

/** 캘린더가 해당 연도를 다루는지 (연초에 목록 갱신이 빠지면 경고용) */
export function isKrxCalendarCovered(year: number): boolean {
  return KRX_CALENDAR_COVERED_YEARS.includes(year);
}
