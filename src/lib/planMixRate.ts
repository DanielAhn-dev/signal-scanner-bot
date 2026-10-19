/**
 * 내 계획 구성(코스피200·S&P500·나스닥100 비중)의 과거 이력으로 낸 "적립 연 수익률" — 목표 계산의 기준 하나
 * (docs/plan-screen-map-2026-10-19.md 7절 결정 1: 과거 이력 기본 + 내가 가정한 수익률은 보조).
 * 목표 트래커 화면과 금요일 텔레그램 보고가 같은 값을 쓴다.
 *
 * 계산: 구성을 매달 비중대로 맞춘 월말 이력(웹 섞어보기 simulateMix 'month'와 같은 식) → 매달 같은 돈을 넣은 모든 시작점의
 * 끝 배율(가장 긴 기간, 15년까지) → 보통(중앙값)·운 나쁨(하위 10%)을 연 수익률로 환산. 웹 lib/goalReach impliedAnnualRate와 같다.
 * 과거 숫자일 뿐 앞으로를 약속하지 않는다 — 화면·보고에 기준(이력 시작·구성)을 같이 적는다.
 */
import { PLAN_INDEX_ASOF, PLAN_INDEX_MONTHLY } from "../data/planIndexMonthly";

export type PlanMixWeights = Array<{ index: string; weight: number }>;
export type PlanMixRates = {
  /** 보통(중앙값) 연 % */
  typicalPct: number;
  /** 운 나쁨(하위 10%) 연 % */
  lowPct: number;
  /** 적립 결과를 본 기간(년) */
  years: number;
  /** 이력 시작 YYYY-MM · 끝 YYYY-MM */
  from: string;
  asOf: string;
  /** "코스피200 50 · S&P500 50" */
  label: string;
  /** 구성 비중 그대로 — 웹 목표 트래커가 '앞으로의 경우의 수'(web/src/lib/futurePaths.ts)를 같은 구성으로 돌릴 때 쓴다 */
  weights: PlanMixWeights;
};

const LABEL: Record<string, string> = { kospi200: "코스피200", sp500: "S&P500", nasdaq100: "나스닥100" };
const COST_PER_TURNOVER = 0.001;
const MAX_YEARS = 15;
const MIN_STARTS = 12;

/** 구성을 정하지 않은 계정 — 코스피200 100% */
export const DEFAULT_PLAN_WEIGHTS: PlanMixWeights = [{ index: "kospi200", weight: 1 }];

/** 매달 비중대로 맞춘 월말 이력 [YYYYMM, 값] (첫 값 1). 지수가 하나라도 없으면 null */
export function planMixSeries(mix: PlanMixWeights): Array<[string, number]> | null {
  const total = mix.reduce((s, e) => s + Math.max(0, e.weight), 0);
  if (!(total > 0)) return null;
  const parts = mix.filter((e) => e.weight > 0).map((e) => ({ w: e.weight / total, a: PLAN_INDEX_MONTHLY.find((x) => x.id === e.index) }));
  if (parts.some((p) => !p.a)) return null;
  const rets = parts.map((p) => {
    const m = new Map<string, number>();
    const drag = p.a!.dragPct / 100 / 12;
    for (let i = 1; i < p.a!.monthly.length; i += 1) m.set(p.a!.monthly[i][0], p.a!.monthly[i][1] / p.a!.monthly[i - 1][1] - 1 - drag);
    return m;
  });
  const months = [...rets[0].keys()].filter((ym) => rets.every((r) => r.has(ym))).sort();
  if (months.length < 12) return null;
  const target = parts.map((p) => p.w);
  let cur = [...target];
  let value = 1;
  const prev = (ym: string) => {
    const y = Number(ym.slice(0, 4));
    const m = Number(ym.slice(4));
    return m === 1 ? `${y - 1}12` : `${y}${String(m - 1).padStart(2, "0")}`;
  };
  const out: Array<[string, number]> = [[prev(months[0]), 1]];
  for (const ym of months) {
    const grown = cur.map((c, k) => c * (1 + rets[k].get(ym)!));
    const sum = grown.reduce((s, v) => s + v, 0);
    value *= sum;
    cur = grown.map((g) => g / sum);
    const turn = cur.reduce((s, c, k) => s + Math.abs(c - target[k]), 0);
    value *= 1 - turn * COST_PER_TURNOVER;
    cur = [...target];
    out.push([ym, value]);
  }
  return out;
}

/** 매달 1씩 n개월 넣어 끝에 넣은 돈의 ratio배가 됐다면, 그에 맞는 연 수익률(소수) — 웹 impliedAnnualRate와 같은 식 */
export function impliedAnnualRate(ratio: number, months: number): number | null {
  if (!(ratio > 0) || months <= 0) return null;
  const fv = (r: number) => {
    const m = Math.pow(1 + r, 1 / 12) - 1;
    let v = 0;
    for (let i = 0; i < months; i += 1) v = (v + 1) * (1 + m);
    return v / months;
  };
  let lo = -0.5;
  let hi = 1;
  if (fv(lo) > ratio || fv(hi) < ratio) return null;
  for (let k = 0; k < 80; k += 1) {
    const mid = (lo + hi) / 2;
    if (fv(mid) < ratio) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** 가장 긴 기간(15년까지, 시작점 12개 이상) 매달 1씩 넣은 모든 시작점의 끝 배율, 오름차순 */
function dcaFinalRatios(prices: number[]): { ratios: number[]; months: number } | null {
  const years = Math.max(0, Math.min(MAX_YEARS, Math.floor((prices.length - MIN_STARTS - 1) / 12)));
  if (years < 1) return null;
  const n = years * 12;
  const starts = prices.length - n;
  const ratios: number[] = [];
  for (let s = 0; s < starts; s += 1) {
    let units = 0;
    for (let i = 0; i < n; i += 1) units += 1 / prices[s + i];
    ratios.push((units * prices[s + n]) / n);
  }
  return { ratios: ratios.sort((a, b) => a - b), months: n };
}

export function planMixLabel(mix: PlanMixWeights): string {
  const total = mix.reduce((s, e) => s + Math.max(0, e.weight), 0) || 1;
  return mix.filter((e) => e.weight > 0).map((e) => `${LABEL[e.index] ?? e.index} ${Math.round((e.weight / total) * 100)}`).join(" · ");
}

const cache = new Map<string, PlanMixRates | null>();

/** 구성의 적립 연 수익률(보통·운 나쁨). 구성이 없으면 코스피200 100% */
export function planMixRates(mix: PlanMixWeights | null | undefined): PlanMixRates | null {
  const m = mix && mix.length ? mix : DEFAULT_PLAN_WEIGHTS;
  const key = m.map((e) => `${e.index}:${e.weight}`).join(",");
  if (cache.has(key)) return cache.get(key)!;
  const series = planMixSeries(m);
  const dca = series ? dcaFinalRatios(series.map(([, p]) => p)) : null;
  let out: PlanMixRates | null = null;
  if (series && dca) {
    const q = (f: number) => dca.ratios[Math.floor((dca.ratios.length - 1) * f)];
    const typical = impliedAnnualRate(q(0.5), dca.months);
    const low = impliedAnnualRate(q(0.1), dca.months);
    if (typical != null && low != null) {
      out = {
        typicalPct: Math.round(typical * 1000) / 10,
        lowPct: Math.round(low * 1000) / 10,
        years: dca.months / 12,
        from: `${series[0][0].slice(0, 4)}-${series[0][0].slice(4)}`,
        asOf: PLAN_INDEX_ASOF,
        label: planMixLabel(m),
        weights: m.map((e) => ({ index: e.index, weight: e.weight })),
      };
    }
  }
  cache.set(key, out);
  return out;
}
