/**
 * 보유·관심 종목 '비중 조절 경고' — 고점을 맞히는 매도 신호가 아니라 "평소보다 크게 빠질 확률이 높은 상태"를 알린다.
 *
 * 근거: scripts/research/validate_weight_caution.py (2015~2025, 하루 거래대금 30억원 이상 종목, 약 월 1회 표본,
 * 상장폐지 포함·수정주가·하루 ±31% 넘는 급변 구간 제외). 기준값은 검증 전에 고정했고 튜닝하지 않았다.
 *   - 과열: 종가가 200일 평균보다 60% 넘게 높다
 *   - 변동성 급등: 최근 20일 변동성이 지난 1년 20일 변동성 중앙값의 2배를 넘고, 52주 고점에서 10% 안쪽이다
 * 둘 다 켜지면 '강함'이다. 신호 뒤에도 상위 10%는 60거래일에 +40% 넘게 더 올랐다 → 전부 매도가 아니라
 * 비중 축소·추가매수 중단 안내로만 쓴다.
 */
type SupabaseClientAny = any;

export const OVERHEAT_MA200_GAP = 0.6;
export const VOL_SPIKE_RATIO = 2;
export const VOL_SPIKE_NEAR_HIGH = 0.9;
/** 계산에 필요한 최소 종가 수(200일선·52주 고점·1년 변동성 중앙값) */
export const WEIGHT_CAUTION_MIN_BARS = 261;

export type WeightCautionLevel = "none" | "caution" | "strong";

export type WeightCautionEvidence = {
  /** 신호 이후 60거래일 안에 -20% 이상 빠진 비율 */
  drop20Prob: number;
  /** 같은 기간 전체 표본의 같은 비율 */
  baseDrop20Prob: number;
  /** 신호 표본 수 */
  samples: number;
};

/** scripts/research/validate_weight_caution.py 출력(2026-10-05 생성, 2015~2025). 숫자를 바꾸려면 스크립트를 다시 돌린다. */
export const WEIGHT_CAUTION_EVIDENCE = {
  period: "2015~2025",
  generatedAt: "2026-10-05",
  universe: "하루 거래대금 30억원 이상 종목(상장폐지 포함)",
  overheat: { drop20Prob: 0.58, baseDrop20Prob: 0.34, samples: 6568 },
  volSpike: { drop20Prob: 0.52, baseDrop20Prob: 0.34, samples: 3525 },
  both: { drop20Prob: 0.63, baseDrop20Prob: 0.34, samples: 1654 },
  limit: "고점 시점은 맞히지 못한다. 신호 뒤에도 상위 10%는 3개월에 +40% 넘게 더 올랐다.",
} as const;

export type WeightCautionResult = {
  level: WeightCautionLevel;
  overheat: boolean;
  volSpike: boolean;
  /** 종가 / 200일 평균 - 1 */
  ma200Gap: number;
  /** 최근 20일 변동성 / 1년 중앙값 */
  volRatio: number | null;
  /** 종가 / 52주 고점 */
  fromHigh: number;
  evidence: WeightCautionEvidence | null;
  message: string | null;
};

function std(values: number[]): number {
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** closes: 오래된 것부터 최신까지 일별 종가(수정주가). 데이터가 부족하면 null. */
export function computeWeightCaution(closes: number[]): WeightCautionResult | null {
  const c = closes.filter((v) => Number.isFinite(v) && v > 0);
  if (c.length < WEIGHT_CAUTION_MIN_BARS || c.length !== closes.length) return null;
  const i = c.length - 1;
  const ma200 = c.slice(i - 199).reduce((s, v) => s + v, 0) / 200;
  const high = Math.max(...c.slice(i - 250));
  const r = c.slice(1).map((v, k) => Math.log(v / c[k])); // r[k]: c[k] → c[k+1]
  // 검증 스크립트와 같은 창: 최근 20개 수익률, 그 이전 1년은 20일 간격 12개 창의 중앙값
  const rv20 = std(r.slice(i - 20, i));
  const pastVols: number[] = [];
  for (let j = i - 240; j < i; j += 20) pastVols.push(std(r.slice(j - 20, j)));
  const rvMed = median(pastVols);
  const ma200Gap = c[i] / ma200 - 1;
  const fromHigh = c[i] / high;
  const volRatio = rvMed > 0 ? rv20 / rvMed : null;
  const overheat = ma200Gap > OVERHEAT_MA200_GAP;
  const volSpike = volRatio != null && volRatio > VOL_SPIKE_RATIO && fromHigh >= VOL_SPIKE_NEAR_HIGH;
  const level: WeightCautionLevel = overheat && volSpike ? "strong" : overheat || volSpike ? "caution" : "none";
  const ev = WEIGHT_CAUTION_EVIDENCE;
  const evidence = level === "strong" ? ev.both : overheat ? ev.overheat : volSpike ? ev.volSpike : null;
  const parts: string[] = [];
  if (overheat) parts.push(`200일 평균보다 ${Math.round(ma200Gap * 100)}% 높음`);
  if (volSpike && volRatio != null) parts.push(`고점 부근에서 변동성 평소의 ${volRatio.toFixed(1)}배`);
  const message = evidence
    ? `${parts.join(" · ")} — 과거 같은 상태에서 3개월 안에 -20% 이상 빠진 비율 ${Math.round(evidence.drop20Prob * 100)}%` +
      `(평소 ${Math.round(evidence.baseDrop20Prob * 100)}%). 추가매수를 멈추고 비중을 줄일지 검토하세요.`
    : null;
  return { level, overheat, volSpike, ma200Gap, volRatio, fromHigh, evidence, message };
}

// 일별 종가로만 계산하므로 하루 안에서는 거의 바뀌지 않는다 → 종목별 30분 캐시(데이터 부족도 캐시)
const CACHE_TTL_MS = 30 * 60_000;
const cache = new Map<string, { expiresAt: number; result: WeightCautionResult | null }>();

/** stock_daily에서 종목별 최근 종가를 읽어 계산한다. 데이터가 부족한 종목은 결과에서 빠진다. */
export async function fetchWeightCautions(
  supabase: SupabaseClientAny,
  codes: string[]
): Promise<Map<string, WeightCautionResult>> {
  const out = new Map<string, WeightCautionResult>();
  const now = Date.now();
  const unique: string[] = [];
  for (const code of new Set(codes.map((c) => String(c).trim()).filter(Boolean))) {
    const hit = cache.get(code);
    if (hit && now < hit.expiresAt) {
      if (hit.result) out.set(code, hit.result);
    } else unique.push(code);
  }
  if (!unique.length) return out;
  // 영업일 261개 ≈ 달력 380일. 휴장일 여유를 두고 420일.
  const since = new Date(Date.now() - 420 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const queue = [...unique];
  const worker = async () => {
    for (let code = queue.shift(); code; code = queue.shift()) {
      const { data, error } = await supabase
        .from("stock_daily")
        .select("date, close")
        .eq("ticker", code)
        .gte("date", since)
        .order("date", { ascending: true })
        .limit(400);
      if (error) continue; // 조회 실패는 캐시하지 않는다
      const closes = ((data ?? []) as any[]).map((r) => Number(r.close));
      const result = computeWeightCaution(closes);
      cache.set(code, { expiresAt: Date.now() + CACHE_TTL_MS, result });
      if (result) out.set(code, result);
    }
  };
  // 동시 요청 8개로 제한(후보 수십 종목을 한꺼번에 조회하지 않게)
  await Promise.all(Array.from({ length: Math.min(8, unique.length) }, worker));
  return out;
}
