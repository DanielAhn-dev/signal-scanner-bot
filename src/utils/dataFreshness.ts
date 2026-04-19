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

function addDays(date: Date, days: number): Date {
  const copied = new Date(date.getTime());
  copied.setUTCDate(copied.getUTCDate() + days);
  return copied;
}

function isWeekday(date: Date): boolean {
  const day = date.getUTCDay();
  return day >= 1 && day <= 5;
}

export function businessDaysBehind(value?: string | null): number | null {
  const base = parseYmd(value);
  if (!base) return null;
  const today = kstTodayUtcBase();
  if (base.getTime() >= today.getTime()) return 0;

  let cursor = addDays(base, 1);
  let count = 0;
  while (cursor.getTime() <= today.getTime()) {
    if (isWeekday(cursor)) count += 1;
    cursor = addDays(cursor, 1);
  }
  return count;
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
