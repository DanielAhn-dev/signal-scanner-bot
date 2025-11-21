// src/lib/normalize.ts

export function toNumberSafe(series: any[], date: string): number | undefined {
  const row = series.find((r) => r.date === date);
  if (!row) return undefined; // 날짜 없으면 명시적으로 undefined
  const v = row.close;
  return Number.isFinite(v) ? v : undefined;
}

export function clamp(x: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, x));
}

export function getBizDaysAgo(iso: string, n: number) {
  // 간단 영업일 역산(주말 제외)
  const d = new Date(iso);
  let k = n;
  while (k > 0) {
    d.setDate(d.getDate() - 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) k--;
  }
  return d.toISOString().slice(0, 10);
}

export const fmtPct = (x: number) => `${(x * 100).toFixed(1)}%`;
export const fmtPctSafe = (x: number) =>
  Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "-";
export const fmtKRW = (x: number, d = 1) => `${(x / 1e8).toFixed(d)}억`;
