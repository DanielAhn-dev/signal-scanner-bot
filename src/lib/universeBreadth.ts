/** 최근 거래일(curDate)과 직전 거래일 종가가 모두 있는 종목 중 오른 종목 비율(%). 비교 가능한 종목이 50개 미만이면 신뢰할 수 없어 null */
export function computeUniverseBreadth(
  rows: Array<{ ticker: string; date: string; close: number | string | null }>,
  curDate: string
): number | null {
  const byTicker = new Map<string, { cur?: number; prev?: number }>();
  for (const row of rows) {
    const close = Number(row.close);
    const entry = byTicker.get(row.ticker) ?? {};
    if (String(row.date).slice(0, 10) === curDate) entry.cur = Number.isFinite(close) ? close : 0;
    else entry.prev = Number.isFinite(close) ? close : 0;
    byTicker.set(row.ticker, entry);
  }
  let advancing = 0;
  let total = 0;
  for (const { cur, prev } of byTicker.values()) {
    if (!cur || !prev) continue;
    total += 1;
    if (cur > prev) advancing += 1;
  }
  return total >= 50 ? Number(((advancing / total) * 100).toFixed(1)) : null;
}
