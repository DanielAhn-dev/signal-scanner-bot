/**
 * 내 선택 돌아보기 — 자동매매 방식을 바꾼 시점부터 "안 바꿨다면"과 실제를 같은 출발점(100)에서 비교한다.
 *
 * 안 바꿨다면 = 전환 시점의 보유 종목을 그대로 들고 있었다면 (현금은 그대로, 이후 매매·입금 없음).
 *   종목 봇이 계속 매매했다면의 결과는 재현할 수 없으므로 그 경우에도 이 정의를 쓰고, 화면에 그대로 밝힌다.
 * 실제 = 목표 트래커의 일별 평가액을 이어 붙인 수익률 (입금·출금한 날은 수익 0, goalTracker.chainedReturn과 같은 규칙).
 *
 * 전환 직후 며칠은 우연이 크고, 보여주면 자꾸 갈아타게 만들 수 있어 MIN_REVIEW_DAYS가 지나기 전에는 숫자를 내지 않는다.
 */
import { chainedReturn, type EquityPoint } from "./goalTracker";

export const MIN_REVIEW_DAYS = 30;
export const MAX_EVENTS = 6;
export const MAX_HOLDINGS_PER_EVENT = 12;

export type SwitchHolding = { code: string; qty: number };
export type SwitchEvent = {
  id: string;
  /** YYYY-MM-DD (KST) */
  date: string;
  from: string;
  to: string;
  /** 전환 시점 평가액(현금 포함) */
  value: number;
  cash: number;
  holdings: SwitchHolding[];
};
export type CloseSeries = Array<{ date: string; close: number }>;
export type ReviewPoint = { date: string; actual: number; alt: number | null };
export type ChoiceReview = {
  event: SwitchEvent;
  days: number;
  ready: boolean;
  /** ready일 때만 채운다 */
  points: ReviewPoint[];
  actualPct: number | null;
  altPct: number | null;
  /** 실제 - 안 바꿨다면 (%p). 안 바꿨다면을 못 구하면 null */
  diffPct: number | null;
  note: string;
};

const DAY_MS = 86_400_000;
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);

/** 입력을 검증·축소한다 — 저장소에서 읽은 값이라도 형식을 믿지 않는다 */
export function sanitizeEvents(raw: unknown): SwitchEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: SwitchEvent[] = [];
  for (const row of raw.slice(-MAX_EVENTS)) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const date = String(r.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const holdings = (Array.isArray(r.holdings) ? r.holdings : [])
      .map((h) => ({ code: String((h as any)?.code ?? "").trim(), qty: Math.floor(Number((h as any)?.qty)) }))
      .filter((h) => /^[0-9A-Z]{5,7}$/.test(h.code) && Number.isFinite(h.qty) && h.qty > 0)
      .slice(0, MAX_HOLDINGS_PER_EVENT);
    out.push({
      id: String(r.id ?? date).slice(0, 40),
      date,
      from: String(r.from ?? "").slice(0, 20),
      to: String(r.to ?? "").slice(0, 20),
      value: Math.max(0, Number(r.value) || 0),
      cash: Math.max(0, Number(r.cash) || 0),
      holdings,
    });
  }
  return out;
}

function closeAt(series: CloseSeries | undefined, date: string): number | null {
  if (!series?.length) return null;
  let found: number | null = null;
  for (const p of series) {
    if (p.date > date) break;
    if (p.close > 0) found = p.close;
  }
  return found;
}

export function buildChoiceReview(input: {
  event: SwitchEvent;
  history: EquityPoint[];
  closes: Record<string, CloseSeries>;
}): ChoiceReview {
  const { event } = input;
  const pts = [...input.history]
    .filter((p) => p.date >= event.date && p.total > 0 && p.seed > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const empty = (note: string, days = 0): ChoiceReview => ({ event, days, ready: false, points: [], actualPct: null, altPct: null, diffPct: null, note });

  if (pts.length < 2) return empty("전환 뒤 기록이 아직 부족합니다. 며칠 지나면 비교가 시작됩니다.");
  const days = dayDiff(pts[0].date, pts[pts.length - 1].date);
  if (days < MIN_REVIEW_DAYS) return empty(`전환 뒤 ${days}일이 지났습니다. 짧은 기간 차이는 우연이 커서 ${MIN_REVIEW_DAYS}일이 지나면 보여드립니다.`, days);

  const baseValue = (date: string): number | null => {
    if (!event.holdings.length) return null;
    let total = event.cash;
    for (const h of event.holdings) {
      const c = closeAt(input.closes[h.code], date);
      if (c == null) return null;
      total += c * h.qty;
    }
    return total > 0 ? total : null;
  };
  const altBase = baseValue(pts[0].date);

  const points: ReviewPoint[] = pts.map((p, i) => {
    const r = chainedReturn(pts.slice(0, i + 1));
    const actual = 100 * (1 + (r ?? 0));
    const v = altBase != null ? baseValue(p.date) : null;
    return { date: p.date, actual, alt: v != null && altBase != null ? (100 * v) / altBase : null };
  });
  const last = points[points.length - 1];
  const actualPct = last.actual - 100;
  const altPct = last.alt != null ? last.alt - 100 : null;
  return {
    event,
    days,
    ready: true,
    points,
    actualPct,
    altPct,
    diffPct: altPct != null ? actualPct - altPct : null,
    note: altPct == null
      ? "전환 시점 보유 종목의 가격 기록을 구하지 못해 '안 바꿨다면'은 계산하지 못했습니다."
      : "'안 바꿨다면'은 전환 시점 보유 종목을 그대로 두었을 때입니다(이후 매매·입금 없음). 종목 봇이 계속 매매했다면의 결과와는 다릅니다. 세금·수수료를 뺀 값이고, 짧은 기간 결과는 우연일 수 있습니다.",
  };
}
