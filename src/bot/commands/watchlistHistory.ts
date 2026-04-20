const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type TradeHistoryRange = {
  mode: "month" | "month-week" | "days" | "all";
  label: string;
  periodText: string;
  startIso: string | null;
  endIso: string | null;
  reliabilityDays: number | null;
  emptyText: string;
};

export type ParsedTradeHistoryInput =
  | { ok: true; range: TradeHistoryRange }
  | { ok: false; message: string };

function toKstDate(input: Date): Date {
  return new Date(input.getTime() + KST_OFFSET_MS);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatMonthDay(date: Date): string {
  return `${pad2(date.getUTCMonth() + 1)}.${pad2(date.getUTCDate())}`;
}

function toUtcIsoFromKstDateParts(year: number, monthIndex: number, day: number): string {
  return new Date(Date.UTC(year, monthIndex, day) - KST_OFFSET_MS).toISOString();
}

function getKstTodayParts(now: Date) {
  const kst = toKstDate(now);
  return {
    year: kst.getUTCFullYear(),
    monthIndex: kst.getUTCMonth(),
    day: kst.getUTCDate(),
  };
}

function getDaysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function buildMonthRange(year: number, monthIndex: number, now: Date): TradeHistoryRange {
  const today = getKstTodayParts(now);
  const isCurrentMonth = today.year === year && today.monthIndex === monthIndex;
  const lastDay = getDaysInMonth(year, monthIndex);
  const displayEndDay = isCurrentMonth ? Math.min(today.day, lastDay) : lastDay;

  return {
    mode: "month",
    label: `${year}년 ${monthIndex + 1}월`,
    periodText: `${pad2(monthIndex + 1)}.01~${pad2(monthIndex + 1)}.${pad2(displayEndDay)}`,
    startIso: toUtcIsoFromKstDateParts(year, monthIndex, 1),
    endIso: toUtcIsoFromKstDateParts(year, monthIndex + 1, 1),
    reliabilityDays: displayEndDay,
    emptyText: isCurrentMonth ? "이번 달 거래가 없습니다." : `${monthIndex + 1}월 거래가 없습니다.`,
  };
}

function buildMonthWeekRange(
  year: number,
  monthIndex: number,
  week: number,
  now: Date
): TradeHistoryRange | null {
  if (week < 1 || week > 4) return null;

  const today = getKstTodayParts(now);
  const isCurrentMonth = today.year === year && today.monthIndex === monthIndex;
  const lastDay = getDaysInMonth(year, monthIndex);
  const startDay = (week - 1) * 7 + 1;
  if (startDay > lastDay) return null;

  const rawEndDay = week === 4 ? lastDay : Math.min(week * 7, lastDay);
  const displayEndDay = isCurrentMonth && today.day >= startDay
    ? Math.min(today.day, rawEndDay)
    : rawEndDay;

  return {
    mode: "month-week",
    label: `${year}년 ${monthIndex + 1}월 ${week}주`,
    periodText: `${pad2(monthIndex + 1)}.${pad2(startDay)}~${pad2(monthIndex + 1)}.${pad2(displayEndDay)}`,
    startIso: toUtcIsoFromKstDateParts(year, monthIndex, startDay),
    endIso: toUtcIsoFromKstDateParts(year, monthIndex, rawEndDay + 1),
    reliabilityDays: Math.max(1, displayEndDay - startDay + 1),
    emptyText: `${monthIndex + 1}월 ${week}주 거래가 없습니다.`,
  };
}

function buildRecentDaysRange(days: number, now: Date): TradeHistoryRange | null {
  if (!Number.isFinite(days) || days <= 0) return null;

  const cappedDays = Math.min(365, Math.floor(days));
  const kstNow = toKstDate(now);
  const kstEndExclusive = new Date(
    Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate() + 1)
  );
  const kstStart = new Date(kstEndExclusive.getTime() - cappedDays * DAY_MS);
  const displayEnd = new Date(kstEndExclusive.getTime() - DAY_MS);

  return {
    mode: "days",
    label: `최근 ${cappedDays}일`,
    periodText: `${formatMonthDay(kstStart)}~${formatMonthDay(displayEnd)}`,
    startIso: new Date(kstStart.getTime() - KST_OFFSET_MS).toISOString(),
    endIso: new Date(kstEndExclusive.getTime() - KST_OFFSET_MS).toISOString(),
    reliabilityDays: cappedDays,
    emptyText: `최근 ${cappedDays}일 거래가 없습니다.`,
  };
}

function buildAllRange(): TradeHistoryRange {
  return {
    mode: "all",
    label: "전체 기록",
    periodText: "전체",
    startIso: null,
    endIso: null,
    reliabilityDays: null,
    emptyText: "아직 거래 기록이 없습니다.",
  };
}

function resolveYearForMonth(targetMonthIndex: number, now: Date): number {
  const today = getKstTodayParts(now);
  return targetMonthIndex <= today.monthIndex ? today.year : today.year - 1;
}

export function buildTradeHistoryInputGuide(): string {
  return [
    "예시: /거래기록, /거래기록 지난달, /거래기록 4월, /거래기록 4월 1주, /거래기록 최근 7일, /거래기록 전체",
    "숫자만 입력하면 최근 N일로 해석합니다. 예) /거래기록 14",
  ].join("\n");
}

export function parseTradeHistoryInput(input: string, now = new Date()): ParsedTradeHistoryInput {
  const raw = String(input ?? "").trim();
  const today = getKstTodayParts(now);

  if (!raw || /^(이번\s*달|이번달|당월)$/i.test(raw)) {
    return { ok: true, range: buildMonthRange(today.year, today.monthIndex, now) };
  }

  if (/^(전체|all)$/i.test(raw)) {
    return { ok: true, range: buildAllRange() };
  }

  if (/^(지난\s*달|지난달|전월)$/i.test(raw)) {
    const monthIndex = today.monthIndex === 0 ? 11 : today.monthIndex - 1;
    const year = today.monthIndex === 0 ? today.year - 1 : today.year;
    return { ok: true, range: buildMonthRange(year, monthIndex, now) };
  }

  const monthWeekMatch = raw.match(/^(\d{1,2})\s*월\s*(\d{1,2})\s*주$/i);
  if (monthWeekMatch) {
    const month = Number(monthWeekMatch[1]);
    const week = Number(monthWeekMatch[2]);
    if (month < 1 || month > 12) {
      return { ok: false, message: `지원하지 않는 월 입력입니다.\n${buildTradeHistoryInputGuide()}` };
    }

    const range = buildMonthWeekRange(resolveYearForMonth(month - 1, now), month - 1, week, now);
    if (!range) {
      return { ok: false, message: `지원하지 않는 주차입니다. 1주부터 4주까지만 입력해주세요.\n${buildTradeHistoryInputGuide()}` };
    }
    return { ok: true, range };
  }

  const monthMatch = raw.match(/^(\d{1,2})\s*월$/i);
  if (monthMatch) {
    const month = Number(monthMatch[1]);
    if (month < 1 || month > 12) {
      return { ok: false, message: `지원하지 않는 월 입력입니다.\n${buildTradeHistoryInputGuide()}` };
    }
    return {
      ok: true,
      range: buildMonthRange(resolveYearForMonth(month - 1, now), month - 1, now),
    };
  }

  const recentDaysMatch = raw.match(/^(?:최근\s*)?(\d{1,3})\s*일$/i);
  if (recentDaysMatch) {
    const range = buildRecentDaysRange(Number(recentDaysMatch[1]), now);
    if (!range) {
      return { ok: false, message: `최근 일수 입력을 해석하지 못했습니다.\n${buildTradeHistoryInputGuide()}` };
    }
    return { ok: true, range };
  }

  const parsedDays = Number(raw);
  if (Number.isFinite(parsedDays) && parsedDays > 0) {
    const range = buildRecentDaysRange(parsedDays, now);
    if (!range) {
      return { ok: false, message: `최근 일수 입력을 해석하지 못했습니다.\n${buildTradeHistoryInputGuide()}` };
    }
    return { ok: true, range };
  }

  return {
    ok: false,
    message: `거래기록 기간을 해석하지 못했습니다.\n${buildTradeHistoryInputGuide()}`,
  };
}