/**
 * 단기 진입 금지 세 가지 — 급등 추격, 긴 윗꼬리, 떨어지는 칼날. 모두 '사면 이후 지수보다 나빴다'가 확인된 상태다.
 *
 * 근거: scripts/research/validate_trader_paths.py --large (C16), validate_large_cap_trading.py (R1, R4b),
 * validate_entry_features.py (F1, 15개 특징 10분위 스캔에서 유일하게 두 구간 모두 t < -3).
 * 판정 기준은 결과 보기 전에 docs/hypothesis-ledger.md에 고정했다. 2015~2026, 전날까지 20일 거래대금 상위 300종목
 * (상장폐지 포함·수정주가), KODEX 200 대비, 날짜 묶음 NW t.
 *   - 급등 추격: 하루 +8% 이상 · 거래량 직전 20일 평균의 5배 이상 · 종가가 고가의 95% 이상.
 *     그 뒤 1~5일째 어느 날 사도 20일 뒤 -2.9~-5.9%(2021년까지·2022년부터 모두 t < -3) → 사건 뒤 5거래일 동안 막는다.
 *   - 긴 윗꼬리: 마지막 일봉 고가가 종가보다 6% 이상 높다(고가에서 크게 밀려 마감). 기준 6%는 2021년까지 표본의
 *     날짜별 상위 10% 경계 중앙값. 다음날 사면 20일 뒤 같은 날 평균보다 -1.4%(~2021, t -3.3) / -3.0%(2022~, t -6.9).
 *   - 떨어지는 칼날: 21거래일 수익 -15% 이하. 다음날 사면 20일 뒤 -1.5%(~2021, t -3.7) / -3.7%(2022~, t -5.7).
 */
type SupabaseClientAny = any;

export const CHASE_MIN_JUMP = 0.08;
export const CHASE_VOLUME_MULTIPLE = 5;
export const CHASE_NEAR_HIGH = 0.95;
/** 급등 사건 뒤 막는 거래일 수(사건일 포함 최근 완료 일봉 5개 안에 사건이 있으면 막는다) */
export const CHASE_BLOCK_DAYS = 5;
export const WICK_MIN_RATIO = 0.06;
export const KNIFE_LOOKBACK = 21;
export const KNIFE_MAX_RETURN = -0.15;
/** 판단에 필요한 최소 일봉: 사건 탐색 5개 + 직전 20일 평균 + 전날 종가 */
export const CHASE_MIN_BARS = 22;
/** 마지막 일봉이 이보다 오래되면(달력일) 판단하지 않는다 */
const MAX_STALE_DAYS = 6;
const FETCH_BARS = CHASE_MIN_BARS + CHASE_BLOCK_DAYS + 3;

/** 스크립트 출력(2026-10-06 생성). 숫자를 바꾸려면 스크립트를 다시 돌린다. */
export const CHASE_ENTRY_EVIDENCE = {
  period: "2015~2026",
  generatedAt: "2026-10-06",
  universe: "전날까지 20일 거래대금 상위 300종목(상장폐지 포함)",
  eventsPerYear: 295,
  excess20dByDay: { 1: -0.0424, 2: -0.0334, 3: -0.0312, 4: -0.0287, 5: -0.0301 },
  excess20d: -0.0428,
  median20d: -0.0855,
} as const;

export const FALLING_KNIFE_EVIDENCE = {
  period: "2015~2026",
  generatedAt: "2026-10-06",
  universe: CHASE_ENTRY_EVIDENCE.universe,
  excess20dBefore2022: -0.0154,
  excess20dSince2022: -0.0368,
} as const;

export type DailyBar = { date: string; open: number; high: number; close: number; volume: number };

export const UPPER_WICK_EVIDENCE = {
  period: "2015~2026",
  generatedAt: "2026-10-06",
  universe: CHASE_ENTRY_EVIDENCE.universe,
  excess20dBefore2022: -0.0138,
  excess20dSince2022: -0.0296,
} as const;

export type EntryGuardKind = "chase" | "wick" | "knife";

export type ChaseEntryResult = {
  kind: EntryGuardKind;
  /** 급등: 사건일 / 칼날: 마지막 일봉 날짜 */
  date: string;
  /** 급등: 사건일 하루 수익 / 윗꼬리: 고가÷종가−1 / 칼날: 21거래일 수익 */
  jump: number;
  /** 급등: 거래량 배수 / 그 밖: null */
  volumeRatio: number | null;
  message: string;
};

const valid = (b: DailyBar) => [b.high, b.close, b.volume].every((v) => Number.isFinite(v) && v > 0);

/** bars[i]가 급등 사건이면 { jump, volumeRatio } */
function chaseAt(bars: DailyBar[], i: number): { jump: number; volumeRatio: number } | null {
  if (i < 21) return null;
  const last = bars[i];
  const prev = bars[i - 1];
  const window = bars.slice(i - 20, i);
  if (!valid(last) || !valid(prev) || !window.every(valid)) return null;
  const avgVolume = window.reduce((s, b) => s + b.volume, 0) / window.length;
  const jump = last.close / prev.close - 1;
  const volumeRatio = last.volume / avgVolume;
  if (jump < CHASE_MIN_JUMP || volumeRatio < CHASE_VOLUME_MULTIPLE || last.close / last.high < CHASE_NEAR_HIGH) return null;
  return { jump, volumeRatio };
}

/**
 * bars: 오래된 것부터 최신까지 '완료된' 일봉. 오늘 사면 안 되는 이유가 있으면 결과, 없으면 null.
 * 급등 추격(최근 5개 일봉 중 가장 최근 사건) → 긴 윗꼬리(마지막 일봉) → 떨어지는 칼날 순서로 본다.
 */
export function computeChaseEntry(bars: DailyBar[]): ChaseEntryResult | null {
  if (bars.length < CHASE_MIN_BARS) return null;
  const n = bars.length - 1;
  for (let i = n; i > n - CHASE_BLOCK_DAYS && i >= 21; i -= 1) {
    const hit = chaseAt(bars, i);
    if (!hit) continue;
    const day = n - i + 1;
    const ev = CHASE_ENTRY_EVIDENCE;
    return {
      kind: "chase",
      date: bars[i].date,
      jump: hit.jump,
      volumeRatio: hit.volumeRatio,
      message:
        `${bars[i].date} +${(hit.jump * 100).toFixed(1)}% · 거래량 평소의 ${hit.volumeRatio.toFixed(1)}배로 급등(오늘이 ${day}일째) — ` +
        `과거 급등 뒤 1~5일째에 사면 20일 뒤 코스피보다 평균 ${(ev.excess20d * 100).toFixed(1)}%` +
        `(중앙 ${(ev.median20d * 100).toFixed(1)}%). 추격 매수하지 않습니다.`,
    };
  }
  const lastBar = bars[n];
  if (valid(lastBar) && lastBar.high / lastBar.close - 1 >= WICK_MIN_RATIO) {
    const w = lastBar.high / lastBar.close - 1;
    const ev = UPPER_WICK_EVIDENCE;
    return {
      kind: "wick",
      date: lastBar.date,
      jump: w,
      volumeRatio: null,
      message:
        `${lastBar.date} 고가보다 ${(w * 100).toFixed(1)}% 밀려 마감(긴 윗꼬리) — 과거 같은 날 다음 날 사면 20일 뒤 ` +
        `${(ev.excess20dBefore2022 * 100).toFixed(1)}%(~2021)·${(ev.excess20dSince2022 * 100).toFixed(1)}%(2022~). 하루 쉬고 다시 봅니다.`,
    };
  }
  if (bars.length > KNIFE_LOOKBACK) {
    const a = bars[n - KNIFE_LOOKBACK];
    const b = bars[n];
    if (valid(a) && valid(b)) {
      const r = b.close / a.close - 1;
      if (r <= KNIFE_MAX_RETURN) {
        const ev = FALLING_KNIFE_EVIDENCE;
        return {
          kind: "knife",
          date: b.date,
          jump: r,
          volumeRatio: null,
          message:
            `최근 한 달 ${(r * 100).toFixed(1)}% — 과거 한 달 -15% 넘게 빠진 대형주를 바로 사면 20일 뒤 코스피보다 ` +
            `${(ev.excess20dBefore2022 * 100).toFixed(1)}%(~2021)·${(ev.excess20dSince2022 * 100).toFixed(1)}%(2022~). ` +
            `떨어지는 칼날은 잡지 않습니다.`,
        };
      }
    }
  }
  return null;
}

export function entryGuardLabel(kind: EntryGuardKind): string {
  return kind === "chase" ? "급등 추격" : kind === "wick" ? "긴 윗꼬리" : "한 달 급락";
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
        .limit(FETCH_BARS);
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
