/**
 * 지금과 비슷했던 때 — 코스피 오늘의 '시장 상태'(가격 기반 심리 점수·60일 고점 대비·20일 변동성) 계산.
 * 정의는 scripts/research/build_similar_times.py의 state_series와 같아야 한다(tests/fixtures/sentiment_parity.json으로 검증).
 * 예측이 아니라 지금 위치를 과거와 견주기 위한 숫자다. 매매 규칙에 쓰지 않는다.
 */
import { fetchKospiCloses } from "./marketFlowCaution";

const RANK_WINDOW = 500;
const RANK_MIN_OBS = 250;

export type SentimentState = {
  /** 마지막 거래일(YYYY-MM-DD) */
  asOf: string;
  /** 0~100, 모멘텀·가격 강도·고요함(변동성이 평소보다 낮음) 백분위 평균 */
  score: number;
  /** 60거래일 고점 대비(%, 0 이하) */
  dd60: number;
  /** 20일 변동성(연율 %) */
  vol20: number;
};

function rollApply(x: number[], w: number, fn: (seg: number[]) => number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  for (let i = w - 1; i < x.length; i += 1) {
    const seg = x.slice(i - w + 1, i + 1);
    if (seg.every(Number.isFinite)) out[i] = fn(seg);
  }
  return out;
}

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const popStd = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / a.length);
};

function pctRank(x: number[]): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  for (let i = 0; i < x.length; i += 1) {
    if (!Number.isFinite(x[i])) continue;
    const h = x.slice(Math.max(0, i - RANK_WINDOW + 1), i + 1).filter(Number.isFinite);
    if (h.length >= RANK_MIN_OBS) out[i] = (h.filter((v) => v <= x[i]).length / h.length) * 100;
  }
  return out;
}

/** closes: 오래된 것부터 종가. 자료가 모자라면 null */
export function computeSentimentState(closes: number[]): Omit<SentimentState, "asOf"> | null {
  const K = closes.filter((c) => Number.isFinite(c) && c > 0);
  const n = K.length;
  if (n < RANK_MIN_OBS + 250) return null;
  const ret = K.map((c, i) => (i === 0 ? NaN : Math.log(c / K[i - 1])));
  const vol20 = rollApply(ret, 20, popStd).map((v) => v * Math.sqrt(252));
  const volAvg = rollApply(vol20, 50, mean);
  const ma125 = rollApply(K, 125, mean);
  const hi250 = rollApply(K, 250, (s) => Math.max(...s));
  const lo250 = rollApply(K, 250, (s) => Math.min(...s));
  const hi60 = rollApply(K, 60, (s) => Math.max(...s));
  const mom = K.map((c, i) => c / ma125[i] - 1);
  const strength = K.map((c, i) => (c - lo250[i]) / (hi250[i] - lo250[i]));
  const calm = vol20.map((v, i) => -(v / volAvg[i] - 1));
  const last = n - 1;
  const ranks = [pctRank(mom)[last], pctRank(strength)[last], pctRank(calm)[last]];
  const dd60 = (K[last] / hi60[last] - 1) * 100;
  const v20 = vol20[last] * 100;
  if (![...ranks, dd60, v20].every(Number.isFinite)) return null;
  return { score: mean(ranks), dd60: Math.min(0, dd60), vol20: v20 };
}

/** 네이버 코스피 종가(약 840거래일, 30분 공유 캐시)로 오늘 상태를 계산. 실패하면 null */
export async function fetchSentimentState(): Promise<SentimentState | null> {
  const map = await fetchKospiCloses(14);
  const days = [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  const state = computeSentimentState(days.map(([, c]) => c));
  if (!state || !days.length) return null;
  return { asOf: days[days.length - 1][0], ...state };
}
