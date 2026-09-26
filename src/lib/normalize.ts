import { previousKrxTradingDate } from "./krxCalendar";
// src/lib/normalize.ts

export function toNumberSafe(series: any[], date: string): number | undefined {
  if (!series?.length) return undefined;

  // 1) target 과 정확히 일치하는 날짜 우선
  const exact = series.find((r) => r.date === date);
  if (exact && Number.isFinite(exact.close)) return exact.close;

  // 2) 없으면 target 이전 날짜 중 가장 가까운 것 선택
  const prev = [...series]
    .filter((r) => r.date <= date && Number.isFinite(r.close))
    .sort((a, b) => b.date.localeCompare(a.date))[0];

  if (prev) return prev.close as number;

  // 3) 그래도 없으면 undefined
  return undefined;
}

export function clamp(x: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, x));
}

export function getBizDaysAgo(iso: string, n: number) {
  // KRX 거래일 역산(주말·휴장일 제외)
  if (n <= 0) return String(iso).slice(0, 10);
  return previousKrxTradingDate(String(iso).slice(0, 10), n);
}

export const fmtPct = (x: number) => `${(x * 100).toFixed(1)}%`;
export const fmtPctSafe = (x: number) =>
  Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "-";
export const fmtKRW = (x: number, d = 1) => `${(x / 1e8).toFixed(d)}억`;
