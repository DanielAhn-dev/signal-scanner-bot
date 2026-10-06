/**
 * 급등 다음날 추격 매수 금지 — 전날 거래량이 터지며 크게 오른 종목은 다음 날 사지 않는다.
 *
 * 근거: scripts/research/validate_trader_paths.py --large (가설 T4b, 판정 기준은 결과 보기 전 고정).
 * 2015~2026, 전날까지 20일 거래대금 상위 300종목(상장폐지 포함·수정주가), 다음날 시가 진입, 코스피 대비.
 *   - 조건: 하루 +8% 이상 · 거래량이 직전 20일 평균의 5배 이상 · 종가가 고가의 95% 이상(고가 근처 마감)
 *   - 결과: 5일 -1.97%(t -5.3), 20일 -4.28%(중앙 -8.55%, t -5.8). 전반(~2021)·후반(2022~) 모두 음수, +15% 기준도 같은 방향
 * 신호 다음 날 진입만 검증했다 → 마지막 완료 일봉(오늘 이전)이 조건을 만족할 때만 막는다.
 */
type SupabaseClientAny = any;

export const CHASE_MIN_JUMP = 0.08;
export const CHASE_VOLUME_MULTIPLE = 5;
export const CHASE_NEAR_HIGH = 0.95;
/** 직전 20일 평균 거래량 + 전날 종가 + 신호일 */
export const CHASE_MIN_BARS = 22;
/** 마지막 일봉이 이보다 오래되면(달력일) 판단하지 않는다 */
const MAX_STALE_DAYS = 6;

/** validate_trader_paths.py --large 출력(2026-10-06 생성). 숫자를 바꾸려면 스크립트를 다시 돌린다. */
export const CHASE_ENTRY_EVIDENCE = {
  period: "2015~2026",
  generatedAt: "2026-10-06",
  universe: "전날까지 20일 거래대금 상위 300종목(상장폐지 포함)",
  eventsPerYear: 295,
  excess5d: -0.0197,
  excess20d: -0.0428,
  median20d: -0.0855,
} as const;

export type DailyBar = { date: string; open: number; high: number; close: number; volume: number };

export type ChaseEntryResult = {
  date: string;
  jump: number;
  volumeRatio: number;
  closeToHigh: number;
  message: string;
};

/** bars: 오래된 것부터 최신까지 '완료된' 일봉. 마지막 봉이 조건을 만족하면 결과, 아니면 null. */
export function computeChaseEntry(bars: DailyBar[]): ChaseEntryResult | null {
  if (bars.length < CHASE_MIN_BARS) return null;
  const i = bars.length - 1;
  const last = bars[i];
  const prev = bars[i - 1];
  const window = bars.slice(i - 20, i);
  const valid = (b: DailyBar) => [b.high, b.close, b.volume].every((v) => Number.isFinite(v) && v > 0);
  if (!valid(last) || !valid(prev) || !window.every(valid)) return null;
  const avgVolume = window.reduce((s, b) => s + b.volume, 0) / window.length;
  const jump = last.close / prev.close - 1;
  const volumeRatio = last.volume / avgVolume;
  const closeToHigh = last.close / last.high;
  if (jump < CHASE_MIN_JUMP || volumeRatio < CHASE_VOLUME_MULTIPLE || closeToHigh < CHASE_NEAR_HIGH) return null;
  const ev = CHASE_ENTRY_EVIDENCE;
  return {
    date: last.date,
    jump,
    volumeRatio,
    closeToHigh,
    message:
      `${last.date} +${(jump * 100).toFixed(1)}% · 거래량 평소의 ${volumeRatio.toFixed(1)}배로 급등 — ` +
      `과거 같은 날 다음 날 사면 20일 뒤 코스피보다 평균 ${(ev.excess20d * 100).toFixed(1)}%` +
      `(중앙 ${(ev.median20d * 100).toFixed(1)}%). 추격 매수하지 않습니다.`,
  };
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** 오늘(KST) 이전 일봉으로만 판단한다. 조회 실패·데이터 부족 종목은 결과에서 빠진다(막지 않음). */
export async function fetchChaseEntries(
  supabase: SupabaseClientAny,
  codes: string[],
  todayKst: string
): Promise<Map<string, ChaseEntryResult>> {
  const out = new Map<string, ChaseEntryResult>();
  const queue = [...new Set(codes.map((c) => String(c).trim()).filter(Boolean))];
  const worker = async () => {
    for (let code = queue.shift(); code; code = queue.shift()) {
      const { data, error } = await supabase
        .from("stock_daily")
        .select("date, open, high, close, volume")
        .eq("ticker", code)
        .lt("date", todayKst)
        .order("date", { ascending: false })
        .limit(CHASE_MIN_BARS + 3);
      if (error || !data?.length) continue;
      const bars: DailyBar[] = (data as any[])
        .map((r) => ({
          date: String(r.date).slice(0, 10),
          open: Number(r.open),
          high: Number(r.high),
          close: Number(r.close),
          volume: Number(r.volume),
        }))
        .reverse();
      if (daysBetween(bars[bars.length - 1].date, todayKst) > MAX_STALE_DAYS) continue;
      const result = computeChaseEntry(bars);
      if (result) out.set(code, result);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, queue.length) }, worker));
  return out;
}
