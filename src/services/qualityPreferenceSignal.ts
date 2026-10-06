/**
 * 선호 점수 — 같은 후보군 안에서 '변동성이 낮고 52주 고가에 가까운' 종목을 후보 정렬에서 조금 앞에 둔다(매수 제외가 아니라 가산점).
 *
 * 근거: scripts/research/validate_composite_pref.py · validate_composite_robust.py (C22, 판정 기준은 결과 보기 전 hypothesis-ledger에 고정).
 * 2015~2026, 전날까지 20일 거래대금 상위 300종목(상장폐지 포함·수정주가), 5거래일마다 표본, 다음날 시가 진입.
 * 저변동(20일 변동성 낮음)+52주 고가 근접 순위 평균 상위 20%가 같은 날 평균보다 20일 +0.9%(~2021, t 2.7)·+2.2%(2022~, t 4.9),
 * 60일 +2.3%·+5.1%. 연도별 9/9 양수. 시장이 내릴 때(전체 평균 20일 -) 상위 20%가 -2.7% vs 전체 -5.7%, 오를 때는 +5.4% vs +5.1%.
 * 한계: 이 후보군(거래대금 상위 300 동일가중)은 같은 기간 KODEX 200보다 연 20%p 이상 뒤졌고, 선호 점수 상위 20종목 월 교체도
 * 비용 후 KODEX 200보다 뒤졌다(2016~2021 연 +6% vs +11%, 2022~ +18% vs +28%). 지수를 이기는 규칙이 아니라
 * '개별주를 고를 때 덜 나쁜 쪽을 앞에 두는' 규칙이다. 재무(ROE)는 가격만으로 같은 효과가 나와 넣지 않았다.
 */
type SupabaseClientAny = any;

/** 순위 0~1 → -3 ~ +3점 (기존 가산점 최대 +6보다 작게) */
export const QUALITY_PREF_BOOST_RANGE = 6;
export const QUALITY_PREF_MIN_POOL = 10;
export const QUALITY_PREF_BARS = 252;
const MIN_BARS = 220;
const MAX_STALE_DAYS = 6;

export const QUALITY_PREF_EVIDENCE = {
  period: "2015~2026",
  generatedAt: "2026-10-06",
  universe: "전날까지 20일 거래대금 상위 300종목(상장폐지 포함)",
  excess20dBefore2022: 0.0089,
  excess20dSince2022: 0.0223,
  excess60dBefore2022: 0.0233,
  excess60dSince2022: 0.0505,
} as const;

export type DailyHighClose = { date: string; high: number; close: number };
export type QualityMetrics = { vol20: number; nearHigh52: number };

/** 오래된 것부터 최신까지 완료된 일봉. 데이터가 부족하면 null. */
export function computeQualityMetrics(bars: DailyHighClose[]): QualityMetrics | null {
  if (bars.length < MIN_BARS) return null;
  const tail = bars.slice(-QUALITY_PREF_BARS);
  if (!tail.every((b) => Number.isFinite(b.close) && b.close > 0 && Number.isFinite(b.high) && b.high > 0)) return null;
  const last21 = tail.slice(-21);
  const rets: number[] = [];
  for (let i = 1; i < last21.length; i += 1) rets.push(last21[i].close / last21[i - 1].close - 1);
  const mean = rets.reduce((s, v) => s + v, 0) / rets.length;
  const vol20 = Math.sqrt(rets.reduce((s, v) => s + (v - mean) ** 2, 0) / rets.length);
  const high = Math.max(...tail.map((b) => b.high));
  return { vol20, nearHigh52: tail[tail.length - 1].close / high };
}

function rank01(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(values.length).fill(0);
  order.forEach(([, i], r) => {
    out[i] = values.length > 1 ? r / (values.length - 1) : 0.5;
  });
  return out;
}

/**
 * 같은 후보군 안의 순위(0~1, 클수록 선호)와 정렬 가산점(-3~+3)을 돌려준다.
 * 후보가 QUALITY_PREF_MIN_POOL개 미만이면 순위가 의미 없으므로 빈 결과.
 */
export function rankQualityPreference(
  metrics: Map<string, QualityMetrics>
): Map<string, { preference: number; boost: number }> {
  const codes = [...metrics.keys()];
  const out = new Map<string, { preference: number; boost: number }>();
  if (codes.length < QUALITY_PREF_MIN_POOL) return out;
  const lowVol = rank01(codes.map((c) => -metrics.get(c)!.vol20));
  const near = rank01(codes.map((c) => metrics.get(c)!.nearHigh52));
  codes.forEach((code, i) => {
    const preference = (lowVol[i] + near[i]) / 2;
    out.set(code, { preference, boost: Number(((preference - 0.5) * QUALITY_PREF_BOOST_RANGE).toFixed(3)) });
  });
  return out;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** 오늘(KST) 이전 일봉으로만 계산. 조회 실패·데이터 부족 종목은 결과에서 빠진다(가산점 없음). */
export async function fetchQualityMetrics(
  supabase: SupabaseClientAny,
  codes: string[],
  todayKst: string
): Promise<Map<string, QualityMetrics>> {
  const out = new Map<string, QualityMetrics>();
  const queue = [...new Set(codes.map((c) => String(c).trim()).filter(Boolean))];
  const worker = async () => {
    for (let code = queue.shift(); code; code = queue.shift()) {
      const { data, error } = await supabase
        .from("stock_daily")
        .select("date, high, close")
        .eq("ticker", code)
        .lt("date", todayKst)
        .order("date", { ascending: false })
        .limit(QUALITY_PREF_BARS);
      if (error || !data?.length) continue;
      const bars: DailyHighClose[] = (data as any[])
        .map((r) => ({ date: String(r.date).slice(0, 10), high: Number(r.high), close: Number(r.close) }))
        .reverse();
      if (daysBetween(bars[bars.length - 1].date, todayKst) > MAX_STALE_DAYS) continue;
      const m = computeQualityMetrics(bars);
      if (m) out.set(code, m);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, queue.length) }, worker));
  return out;
}
