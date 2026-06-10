/**
 * 한국/미국 시장 정기 이벤트 자동 계산
 * - 한국 네마녀의 날: 3/6/9/12월 두 번째 목요일 (선물·옵션 동시만기)
 * - 한국 월간 옵션만기: 매월 두 번째 목요일
 * - 미국 Quad Witching: 3/6/9/12월 셋째 금요일 (글로벌 변동성 영향)
 */

export type MarketEventType =
  | "KR_QUAD_WITCHING"   // 한국 네마녀 (분기 선물·옵션 동시만기)
  | "KR_OPTION_EXPIRY"   // 한국 월간 옵션만기
  | "US_QUAD_WITCHING";  // 미국 Quad Witching

export type MarketEvent = {
  type: MarketEventType;
  date: string;        // YYYY-MM-DD
  label: string;
  importance: "critical" | "high";
  warningDays: number; // 이 일수 전부터 경고 시작
  blockBuyDays: number; // 이 일수 이내에는 신규 매수 차단
  averageKospiReaction: number;
  impactSeverity: number;
};

/** N번째 특정 요일 날짜 계산 (dayOfWeek: 0=일, 1=월, ..., 4=목, 5=금) */
function nthWeekdayOfMonth(year: number, month: number, dayOfWeek: number, n: number): Date {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const firstDow = first.getUTCDay();
  let offset = (dayOfWeek - firstDow + 7) % 7;
  offset += (n - 1) * 7;
  return new Date(Date.UTC(year, month - 1, 1 + offset));
}

function toYmd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 한국 네마녀의 날: 3/6/9/12월 두 번째 목요일 */
export function getKrQuadWitchingDays(year: number): Date[] {
  return [3, 6, 9, 12].map((month) => nthWeekdayOfMonth(year, month, 4, 2));
}

/** 한국 월간 옵션만기: 매월 두 번째 목요일 */
export function getKrxOptionExpiryDays(year: number): Date[] {
  return Array.from({ length: 12 }, (_, i) => nthWeekdayOfMonth(year, i + 1, 4, 2));
}

/** 미국 Quad Witching: 3/6/9/12월 셋째 금요일 */
export function getUsQuadWitchingDays(year: number): Date[] {
  return [3, 6, 9, 12].map((month) => nthWeekdayOfMonth(year, month, 5, 3));
}

/** 지정 연도의 모든 정기 시장 이벤트를 MarketEvent 형태로 반환 */
export function getMarketEventsForYear(year: number): MarketEvent[] {
  const events: MarketEvent[] = [];

  const krQuad = getKrQuadWitchingDays(year);
  const krOption = getKrxOptionExpiryDays(year);
  const usQuad = getUsQuadWitchingDays(year);

  const krQuadDates = new Set(krQuad.map(toYmd));

  for (const date of krOption) {
    const ymd = toYmd(date);
    if (krQuadDates.has(ymd)) {
      events.push({
        type: "KR_QUAD_WITCHING",
        date: ymd,
        label: "한국 네마녀의 날 (선물·옵션 동시만기)",
        importance: "critical",
        warningDays: 5,
        blockBuyDays: 1,
        averageKospiReaction: -0.9,
        impactSeverity: 85,
      });
    } else {
      events.push({
        type: "KR_OPTION_EXPIRY",
        date: ymd,
        label: "KOSPI200 옵션만기일",
        importance: "high",
        warningDays: 3,
        blockBuyDays: 0,
        averageKospiReaction: -0.4,
        impactSeverity: 60,
      });
    }
  }

  for (const date of usQuad) {
    events.push({
      type: "US_QUAD_WITCHING",
      date: toYmd(date),
      label: "미국 Quad Witching (글로벌 변동성)",
      importance: "critical",
      warningDays: 5,
      blockBuyDays: 1,
      averageKospiReaction: -0.6,
      impactSeverity: 78,
    });
  }

  return events.sort((a, b) => a.date.localeCompare(b.date));
}

/** 오늘로부터 daysAhead일 이내에 해당하는 시장 이벤트 반환 */
export function getUpcomingMarketEvents(daysAhead: number, now?: Date): MarketEvent[] {
  const base = now ?? new Date();
  const todayYmd = toYmd(base);
  const limitDate = new Date(base.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const limitYmd = toYmd(limitDate);

  const years = new Set([base.getUTCFullYear(), limitDate.getUTCFullYear()]);
  const allEvents: MarketEvent[] = [];
  for (const year of years) {
    allEvents.push(...getMarketEventsForYear(year));
  }

  return allEvents.filter((e) => e.date >= todayYmd && e.date <= limitYmd);
}

/** 특정 날짜까지 남은 일수 (음수면 이미 지남) */
export function daysUntil(eventDateYmd: string, now?: Date): number {
  const base = now ?? new Date();
  const todayYmd = toYmd(base);
  const eventMs = Date.parse(eventDateYmd);
  const todayMs = Date.parse(todayYmd);
  return Math.round((eventMs - todayMs) / (24 * 60 * 60 * 1000));
}
