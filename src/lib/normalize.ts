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
