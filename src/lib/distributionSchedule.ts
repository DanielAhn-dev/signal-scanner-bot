/**
 * 다음 분배 일정 추정 — 저장된 분배금 이력(기준일·지급일)에서 주기와 날짜 규칙을 읽어 다음 기준일·분배락일·지급일을 만든다.
 *
 * - 기준일(record): 이 날 주주명부에 있어야 분배를 받는다. 결제가 T+2라서 기준일 2영업일 전까지 사야 한다.
 * - 분배락일(ex): 기준일 직전 영업일. 이 날부터 사면 그 분배는 못 받고, 분배금만큼 가격이 조정돼 시작한다.
 * - 이력에 이미 다가오는 기준일이 있으면 그 값(estimated=false), 없으면 지난 규칙으로 추정(estimated=true).
 * 분배락 뒤 가격이 내려가므로 '받으려고 사는 것이 이득'이라는 뜻은 아니다 — 사실 안내용이다.
 */
import { isKrxTradingDate, nextKrxTradingDate, previousKrxTradingDate } from "./krxCalendar";

export type DistDateRow = { record_date: string; pay_date: string | null };

export type NextDistribution = {
  recordDate: string;
  /** 분배락일 — 기준일 직전 영업일 */
  exDate: string;
  /** 이 분배를 받을 수 있는 마지막 매수일 — 기준일 2영업일 전 */
  lastBuyDate: string;
  payDate: string | null;
  intervalMonths: 1 | 3 | 6 | 12;
  estimated: boolean;
};

const DAY_MS = 86_400_000;
const MIN_ROWS = 3;

function toMs(key: string): number {
  const m = String(key).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
}
function toKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** 그 달의 마지막 거래일 */
export function lastTradingDateOfMonth(year: number, month0: number): string {
  let cursor = toKey(Date.UTC(year, month0 + 1, 0));
  for (let guard = 0; guard < 15 && !isKrxTradingDate(cursor); guard += 1) cursor = toKey(toMs(cursor) - DAY_MS);
  return cursor;
}

function onOrBeforeTrading(dateKey: string): string {
  let cursor = dateKey;
  for (let guard = 0; guard < 15 && !isKrxTradingDate(cursor); guard += 1) cursor = toKey(toMs(cursor) - DAY_MS);
  return cursor;
}

function intervalOf(gapDays: number): 1 | 3 | 6 | 12 {
  if (gapDays <= 45) return 1;
  if (gapDays <= 135) return 3;
  if (gapDays <= 270) return 6;
  return 12;
}

function withDates(recordDate: string, payOffsetDays: number | null, intervalMonths: 1 | 3 | 6 | 12, estimated: boolean): NextDistribution {
  return {
    recordDate,
    exDate: previousKrxTradingDate(recordDate, 1),
    lastBuyDate: previousKrxTradingDate(recordDate, 2),
    payDate: payOffsetDays == null ? null : nextKrxTradingDate(toKey(toMs(recordDate) + (payOffsetDays - 1) * DAY_MS)),
    intervalMonths,
    estimated,
  };
}

/**
 * 오늘(todayKey) 이후 처음 올 분배의 마지막 매수일이 오늘 이상인 일정을 돌려준다. 이력이 3건 미만이거나
 * 마지막 기준일이 너무 오래됐으면(주기의 2배·최대 400일) 추정하지 않고 null.
 */
export function nextDistribution(history: DistDateRow[], todayKey: string): NextDistribution | null {
  const rows = [...history]
    .filter((r) => Number.isFinite(toMs(r.record_date)))
    .sort((a, b) => (a.record_date < b.record_date ? -1 : 1))
    .slice(-12);
  if (rows.length < MIN_ROWS) return null;

  const payOffsets = rows
    .filter((r) => r.pay_date && Number.isFinite(toMs(r.pay_date)))
    .map((r) => Math.round((toMs(r.pay_date as string) - toMs(r.record_date)) / DAY_MS))
    .filter((d) => d >= 0 && d <= 60);
  const payOffset = payOffsets.length >= 2 ? Math.round(median(payOffsets)) : null;

  const dates = rows.map((r) => r.record_date.slice(0, 10));
  const gaps = dates.slice(1).map((d, i) => Math.round((toMs(d) - toMs(dates[i])) / DAY_MS));
  const intervalMonths = intervalOf(median(gaps));
  const last = dates[dates.length - 1];

  // 이력에 이미 다가오는 기준일이 있으면 그대로
  if (last >= todayKey && previousKrxTradingDate(last, 2) >= todayKey) return withDates(last, payOffset, intervalMonths, false);

  const maxAge = Math.min(400, intervalMonths * 62);
  if ((toMs(todayKey) - toMs(last)) / DAY_MS > maxAge) return null;

  const recent = dates.slice(-6);
  const isLastTrading = (d: string) => lastTradingDateOfMonth(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1) === d;
  const monthEnd = recent.filter(isLastTrading).length >= Math.ceil(recent.length * 0.6);
  const dom = Math.round(median(recent.map((d) => Number(d.slice(8, 10)))));
  const lastY = Number(last.slice(0, 4));
  const lastM0 = Number(last.slice(5, 7)) - 1;

  for (let k = 1; k <= 24; k += 1) {
    const idx = lastM0 + k * intervalMonths;
    const y = lastY + Math.floor(idx / 12);
    const m0 = ((idx % 12) + 12) % 12;
    const record = monthEnd
      ? lastTradingDateOfMonth(y, m0)
      : onOrBeforeTrading(toKey(Math.min(Date.UTC(y, m0, dom), Date.UTC(y, m0 + 1, 0))));
    if (previousKrxTradingDate(record, 2) >= todayKey) return withDates(record, payOffset, intervalMonths, true);
  }
  return null;
}
