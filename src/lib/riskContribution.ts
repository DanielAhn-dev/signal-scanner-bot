/**
 * 계좌 위험 기여도 — 비중이 아니라 "계좌 흔들림의 몇 %가 어느 종목에서 나오는가"를 실제 일봉 수익률로 계산한다.
 * 예측이 아니라 최근 기간 기록이다(표본이 짧고 위기 때는 상관이 달라진다). 현금성(closes 없음)은 변동 0으로 둔다.
 * 가격은 분배금이 반영된 수정주가일 수 있어 변동성 용도로만 쓴다(수익 계산 금지).
 */

export type RiskInputRow = {
  code: string;
  name: string;
  /** 평가금(원) */
  value: number;
  /** 일봉 종가. null이면 현금성(변동 0), 배열이 짧으면 데이터 부족으로 제외 */
  closes: Array<{ date: string; close: number }> | null;
};

export type RiskHolding = {
  code: string;
  name: string;
  weightPct: number;
  /** 계좌 변동성 중 이 종목에서 나온 몫 % (합 100, 헤지 성격이면 음수 가능) */
  riskSharePct: number;
  /** 단독 연환산 변동성 % */
  volPct: number;
  /** 읽어 온 전체 이력(약 4년 이내) 중 이 종목의 최대 낙폭 % (음수) */
  worstDrawdownPct: number;
};

export type HighCorrPair = { a: string; b: string; corr: number };

export type RiskContribution = {
  /** 계산에 쓴 일수(수익률 개수) */
  observations: number;
  startDate: string;
  endDate: string;
  /** 계산에 들어간 평가금 비율 % (데이터 부족 종목 제외분이 빠짐) */
  coveragePct: number;
  /** 현재 비중을 기간 내내 유지했다고 가정한 연환산 변동성 % */
  portfolioVolPct: number;
  /** 같은 가정의 기간 내 최대 낙폭 % (음수) */
  maxDrawdownPct: number;
  /**
   * 종목마다 자기 최악 구간이 동시에 왔다고 가정한 계좌 낙폭 % (음수). 실제로는 최악 시점이 서로 달라 이보다 덜 빠졌을 가능성이 크지만,
   * 위기 때는 상관이 높아져 비슷해질 수도 있다. 계산에 들어간 평가금 기준(coveragePct).
   */
  worstCaseLossPct: number;
  /** 최대 낙폭을 잰 이력의 가장 짧은 종목 기준 거래일 수 */
  worstCaseMinDays: number;
  holdings: RiskHolding[];
  /** 비중 5% 이상 종목끼리 상관이 높은 쌍 — 분산 착시 */
  highCorrPairs: HighCorrPair[];
  /** 위험 몫 기준 실질 종목 수(1/Σ몫²) */
  effectiveBets: number;
  /** 데이터 부족으로 뺀 종목 */
  excluded: Array<{ code: string; name: string }>;
};

/** 위험 쏠림 안내 기준(결과를 보기 전에 정함): 위험 몫이 40% 이상이면서 비중의 2배 이상. 매매 규칙이 아니라 표시 기준이다. */
export const RISK_CONCENTRATION_SHARE_PCT = 40;
export const RISK_CONCENTRATION_RATIO = 2;

export function riskConcentrated(h: Pick<RiskHolding, "weightPct" | "riskSharePct">): boolean {
  return h.riskSharePct >= RISK_CONCENTRATION_SHARE_PCT && h.riskSharePct >= h.weightPct * RISK_CONCENTRATION_RATIO;
}

export const RISK_MIN_OBSERVATIONS = 120;
export const RISK_MAX_OBSERVATIONS = 250;
/** 종목당 읽는 일봉 수 — 최대 낙폭용(약 4년). PostgREST 1000행 캡 안쪽으로 둔다. */
export const RISK_HISTORY_ROWS = 1000;
export const HIGH_CORR = 0.9;
const TRADING_DAYS = 252;

/** 날짜 오름차순 종가에서 고점 대비 최대 낙폭(음수) */
function maxDrawdown(closes: Array<{ date: string; close: number }>): number {
  const sorted = closes.filter((c) => c.close > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
  let peak = 0;
  let mdd = 0;
  for (const c of sorted) {
    peak = Math.max(peak, c.close);
    mdd = Math.min(mdd, c.close / peak - 1);
  }
  return mdd;
}

export function buildRiskContribution(rows: RiskInputRow[], opts?: { minObs?: number; maxObs?: number }): RiskContribution | null {
  const minObs = opts?.minObs ?? RISK_MIN_OBSERVATIONS;
  const maxObs = opts?.maxObs ?? RISK_MAX_OBSERVATIONS;
  const live = rows.filter((r) => r.value > 0);
  const totalValue = live.reduce((s, r) => s + r.value, 0);
  if (totalValue <= 0) return null;

  const excluded: Array<{ code: string; name: string }> = [];
  let priced = live.filter((r) => r.closes != null);
  const cashValue = live.filter((r) => r.closes == null).reduce((s, r) => s + r.value, 0);

  // 공통 날짜가 모자라면 이력이 가장 짧은 종목부터 빼며 다시 맞춘다.
  let dates: string[] = [];
  for (;;) {
    const usable = priced.filter((r) => (r.closes ?? []).filter((c) => c.close > 0).length > minObs);
    for (const r of priced) if (!usable.includes(r)) excluded.push({ code: r.code, name: r.name });
    priced = usable;
    if (priced.length === 0) return null;
    const sets = priced.map((r) => new Set((r.closes ?? []).filter((c) => c.close > 0).map((c) => c.date)));
    dates = [...sets[0]].filter((d) => sets.every((s) => s.has(d))).sort();
    if (dates.length > minObs) break;
    const shortest = priced.reduce((a, b) => ((a.closes?.length ?? 0) <= (b.closes?.length ?? 0) ? a : b));
    excluded.push({ code: shortest.code, name: shortest.name });
    priced = priced.filter((r) => r !== shortest);
  }
  if (dates.length > maxObs + 1) dates = dates.slice(dates.length - (maxObs + 1));

  const n = priced.length;
  const T = dates.length - 1;
  const rets: number[][] = priced.map((r) => {
    const m = new Map((r.closes ?? []).map((c) => [c.date, c.close]));
    const out: number[] = [];
    for (let t = 1; t < dates.length; t++) out.push(m.get(dates[t])! / m.get(dates[t - 1])! - 1);
    return out;
  });
  const mean = rets.map((r) => r.reduce((s, v) => s + v, 0) / T);
  const cov = (i: number, j: number) => {
    let s = 0;
    for (let t = 0; t < T; t++) s += (rets[i][t] - mean[i]) * (rets[j][t] - mean[j]);
    return s / (T - 1);
  };
  const C: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => cov(i, j)));

  const covered = priced.reduce((s, r) => s + r.value, 0) + cashValue;
  const w = priced.map((r) => r.value / covered); // 현금성은 변동 0이라 행렬에는 없고 분모에만 포함
  const Cw = C.map((row) => row.reduce((s, c, j) => s + c * w[j], 0));
  const varP = w.reduce((s, wi, i) => s + wi * Cw[i], 0);
  if (!(varP > 0)) return null;
  const sigmaP = Math.sqrt(varP);

  const shares = w.map((wi, i) => (wi * Cw[i]) / varP);
  const holdings: RiskHolding[] = priced
    .map((r, i) => ({
      code: r.code,
      name: r.name,
      weightPct: (r.value / totalValue) * 100,
      riskSharePct: shares[i] * 100,
      volPct: Math.sqrt(C[i][i] * TRADING_DAYS) * 100,
      worstDrawdownPct: maxDrawdown(r.closes ?? []) * 100,
    }))
    .sort((a, b) => b.riskSharePct - a.riskSharePct);

  const worstCaseLossPct = holdings.reduce((sum, h) => sum + (h.weightPct / 100) * h.worstDrawdownPct, 0);
  const worstCaseMinDays = Math.min(...priced.map((r) => (r.closes ?? []).filter((c) => c.close > 0).length));

  const pairs: HighCorrPair[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (priced[i].value / totalValue < 0.05 || priced[j].value / totalValue < 0.05) continue;
      const d = Math.sqrt(C[i][i] * C[j][j]);
      if (!(d > 0)) continue;
      const corr = C[i][j] / d;
      if (corr >= HIGH_CORR) pairs.push({ a: priced[i].name, b: priced[j].name, corr });
    }
  }
  pairs.sort((a, b) => b.corr - a.corr);

  const pos = shares.map((s) => Math.max(0, s));
  const posSum = pos.reduce((s, v) => s + v, 0);
  const effectiveBets = posSum > 0 ? 1 / pos.reduce((s, v) => s + (v / posSum) ** 2, 0) : 1;

  let nav = 1;
  let peak = 1;
  let mdd = 0;
  for (let t = 0; t < T; t++) {
    nav *= 1 + w.reduce((s, wi, i) => s + wi * rets[i][t], 0);
    peak = Math.max(peak, nav);
    mdd = Math.min(mdd, nav / peak - 1);
  }

  return {
    observations: T,
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    coveragePct: (covered / totalValue) * 100,
    portfolioVolPct: sigmaP * Math.sqrt(TRADING_DAYS) * 100,
    maxDrawdownPct: mdd * 100,
    worstCaseLossPct,
    worstCaseMinDays,
    holdings,
    highCorrPairs: pairs.slice(0, 3),
    effectiveBets,
    excluded,
  };
}
