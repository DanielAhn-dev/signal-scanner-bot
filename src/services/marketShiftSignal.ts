/**
 * '시장 분위기 변화' — 하락을 예측하는 신호가 아니라, 코스피의 네 가지 지표가 자기 과거(최근 약 1년)에 비해
 * 어느 위치인지, 한 달 전과 비교해 어느 쪽으로 움직였는지만 보여준다. 검증 결과가 없는 현황 표시이므로
 * 매매 규칙·경고에 쓰지 않는다(하락 선행 여부는 docs/hypothesis-ledger.md H29에서 따로 검증).
 *
 * 지표와 기준은 결과를 보기 전에 고정했고 튜닝하지 않았다.
 *   - 이격도: 코스피 종가 / 60일 평균 - 1
 *   - 시장 폭: 상승 종목 / (상승+하락) 5일 평균. 전체 시장이 아니라 봇 관리 종목(core·extended, 코스피 약 150종목) 기준이고,
 *     과거 250거래일은 현재 구성 종목으로 한 번에 채운 값이다(생존 편향 있음, scripts/aggregate_market_breadth.py --backfill-days)
 *   - 외국인 20일 순매수 합(억원)
 *   - 변동성: 최근 20일 일간 로그수익률 표준편차
 * 위치 = 직전 250개 값 중 오늘보다 작은 비율(0~1). 직전 값이 120개 미만이면 위치를 내지 않는다.
 * '평소와 다름' = 위치가 상위 10% 이상 또는 하위 10% 이하. 변화 = 오늘 위치와 20거래일 전 위치의 차이가 ±0.2 이상.
 */
import { fetchKospiCloses } from "./marketFlowCaution";

type SupabaseClientAny = any;

export const SHIFT_RANK_WINDOW = 250;
export const SHIFT_MIN_HISTORY = 120;
export const SHIFT_UNUSUAL_HIGH = 0.9;
export const SHIFT_UNUSUAL_LOW = 0.1;
export const SHIFT_LOOKBACK_DAYS = 20;
export const SHIFT_MOVE_THRESHOLD = 0.2;
export const SHIFT_MIN_DAYS = 80;
/** 오늘 값이 없을 때 거슬러 올라가 볼 최대 거래일 수 */
export const SHIFT_STALE_TOLERANCE = 5;

export type MarketShiftDay = {
  date: string;
  close: number;
  /** 외국인 순매수(억원). 없으면 null */
  foreignNet: number | null;
  /** 상승 종목 / (상승+하락). 없으면 null */
  breadthRatio: number | null;
};

export type ShiftKey = "gap60" | "breadth" | "foreign20" | "vol20";
export type ShiftMove = "up" | "down" | "flat" | null;

export type ShiftIndicator = {
  key: ShiftKey;
  label: string;
  /** 오늘 값 (이격도·시장 폭·변동성은 비율, 외국인은 억원) */
  value: number | null;
  /** 이 지표를 계산한 기준일(수급·시장 폭은 오늘 자료가 아직 없으면 며칠 전일 수 있다) */
  asOf: string;
  /** 자기 과거 대비 위치 0~1 (1에 가까울수록 높음). 데이터 부족이면 null */
  rank: number | null;
  /** 20거래일 전 위치 */
  rankPrev: number | null;
  move: ShiftMove;
  unusual: boolean;
  /** 위치를 계산에 쓴 직전 값 개수 */
  samples: number;
};

export type MarketShift = {
  asOf: string;
  indicators: ShiftIndicator[];
  unusualCount: number;
  message: string;
  evidence: { windowDays: number; lookbackDays: number; unusualRule: string; limit: string; generatedAt: string };
};

const LABELS: Record<ShiftKey, string> = {
  gap60: "코스피 60일선 이격",
  breadth: "상승·하락 종목 비(관리 종목)",
  foreign20: "외국인 20일 순매수",
  vol20: "변동성(20일)",
};

function rankAt(values: (number | null)[], i: number): { rank: number | null; samples: number } {
  const cur = values[i];
  if (cur == null) return { rank: null, samples: 0 };
  let lower = 0;
  let n = 0;
  for (let j = Math.max(0, i - SHIFT_RANK_WINDOW); j < i; j += 1) {
    const v = values[j];
    if (v == null) continue;
    n += 1;
    if (v < cur) lower += 1;
  }
  return n >= SHIFT_MIN_HISTORY ? { rank: lower / n, samples: n } : { rank: null, samples: n };
}

function rolling(days: MarketShiftDay[], size: number, fn: (slice: MarketShiftDay[]) => number | null): (number | null)[] {
  return days.map((_, i) => (i + 1 >= size ? fn(days.slice(i + 1 - size, i + 1)) : null));
}

function std(values: number[]): number {
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

export function buildShiftSeries(days: MarketShiftDay[]): Record<ShiftKey, (number | null)[]> {
  const gap60 = rolling(days, 60, (s) => {
    const ma = s.reduce((a, d) => a + d.close, 0) / s.length;
    return ma > 0 ? s[s.length - 1].close / ma - 1 : null;
  });
  const breadth = rolling(days, 5, (s) =>
    s.every((d) => d.breadthRatio != null) ? s.reduce((a, d) => a + (d.breadthRatio as number), 0) / s.length : null
  );
  const foreign20 = rolling(days, 20, (s) =>
    s.every((d) => d.foreignNet != null) ? s.reduce((a, d) => a + (d.foreignNet as number), 0) : null
  );
  const vol20 = days.map((_, i) => {
    if (i < 20) return null;
    const r: number[] = [];
    for (let k = i - 19; k <= i; k += 1) r.push(Math.log(days[k].close / days[k - 1].close));
    return std(r);
  });
  return { gap60, breadth, foreign20, vol20 };
}

/** days: 오래된 것부터 거래일별. 종가가 80일 미만이면 null */
export function computeMarketShift(days: MarketShiftDay[]): MarketShift | null {
  if (days.length < SHIFT_MIN_DAYS || days.some((d) => !(d.close > 0))) return null;
  const last = days.length - 1;
  const series = buildShiftSeries(days);
  const indicators: ShiftIndicator[] = (Object.keys(series) as ShiftKey[]).map((key) => {
    const values = series[key];
    // 수급·시장 폭 배치는 장 마감 뒤에 돌아 오늘 행이 아직 없을 수 있다 → 최근 5거래일 안 마지막 값 기준으로 본다
    let at = last;
    while (at > last - SHIFT_STALE_TOLERANCE && values[at] == null) at -= 1;
    if (values[at] == null) at = last;
    const now = rankAt(values, at);
    const prev = rankAt(values, at - SHIFT_LOOKBACK_DAYS);
    const move: ShiftMove =
      now.rank == null || prev.rank == null
        ? null
        : now.rank - prev.rank >= SHIFT_MOVE_THRESHOLD
          ? "up"
          : now.rank - prev.rank <= -SHIFT_MOVE_THRESHOLD
            ? "down"
            : "flat";
    const unusual = now.rank != null && (now.rank >= SHIFT_UNUSUAL_HIGH || now.rank <= SHIFT_UNUSUAL_LOW);
    return { key, label: LABELS[key], value: values[at], asOf: days[at].date, rank: now.rank, rankPrev: prev.rank, move, unusual, samples: now.samples };
  });
  const unusual = indicators.filter((x) => x.unusual);
  const measured = indicators.filter((x) => x.rank != null).length;
  const message = measured === 0
    ? "비교할 과거 자료가 아직 부족합니다."
    : unusual.length === 0
      ? `측정된 ${measured}개 지표 모두 최근 1년 범위 안입니다.`
      : `평소와 다른 지표 ${unusual.length}개: ${unusual.map((x) => `${x.label}(${(x.rank as number) >= 0.5 ? "높음" : "낮음"})`).join(", ")}`;
  return {
    asOf: days[last].date,
    indicators,
    unusualCount: unusual.length,
    message,
    evidence: {
      windowDays: SHIFT_RANK_WINDOW,
      lookbackDays: SHIFT_LOOKBACK_DAYS,
      unusualRule: "자기 과거 상위·하위 10%",
      limit: "하락을 예측하는 신호가 아닙니다. 평소와 얼마나 다른지만 보여줍니다. 하락 선행 여부는 가설 H29에서 검증 중입니다.",
      generatedAt: new Date().toISOString().slice(0, 10),
    },
  };
}

let cache: { expiresAt: number; value: MarketShift | null } | null = null;

/** 네이버 코스피 종가 + market_breadth_daily(외국인 순매수·시장 폭). 종가가 부족하면 null */
export async function fetchMarketShift(supabase: SupabaseClientAny): Promise<MarketShift | null> {
  if (cache && Date.now() < cache.expiresAt) return cache.value;
  const [closes, flowRes, breadthRes] = await Promise.all([
    fetchKospiCloses(7),
    supabase
      .from("market_breadth_daily")
      .select("trade_date, foreign_net")
      .eq("market", "KOSPI")
      .eq("universe_level", "market_investor")
      .order("trade_date", { ascending: false })
      .limit(400),
    supabase
      .from("market_breadth_daily")
      .select("trade_date, advancers, decliners")
      .eq("market", "KOSPI")
      .eq("universe_level", "core_extended")
      .order("trade_date", { ascending: false })
      .limit(400),
  ]);
  // 조회 실패를 '자료 없음'으로 굳히지 않는다 — 캐시하지 않고 null만 돌려준다
  if (flowRes.error || breadthRes.error || closes.size < SHIFT_MIN_DAYS) return null;
  const flows = new Map<string, number>();
  for (const r of (flowRes.data ?? []) as any[]) flows.set(String(r.trade_date).slice(0, 10), Number(r.foreign_net));
  const breadth = new Map<string, number>();
  for (const r of (breadthRes.data ?? []) as any[]) {
    const adv = Number(r.advancers);
    const dec = Number(r.decliners);
    if (adv + dec > 0) breadth.set(String(r.trade_date).slice(0, 10), adv / (adv + dec));
  }
  const days: MarketShiftDay[] = [...closes.keys()].sort().map((d) => ({
    date: d,
    close: closes.get(d)!,
    foreignNet: Number.isFinite(flows.get(d) as number) ? (flows.get(d) as number) : null,
    breadthRatio: breadth.get(d) ?? null,
  }));
  const value = computeMarketShift(days);
  cache = { expiresAt: Date.now() + 30 * 60_000, value };
  return value;
}
