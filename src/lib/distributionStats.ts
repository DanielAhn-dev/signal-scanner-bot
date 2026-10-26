/**
 * 분배금 이력(etf_distributions) → 연 분배금·안정성·추세. 순수 함수.
 *
 * 연 분배금(annualPerShare):
 *  - 이력이 12개월 이상이면 마지막 지급일 기준 최근 12개월의 실제 합계 (basis "ttm")
 *  - 짧으면 최근 지급액을 연환산하되 최근 3회·6회 평균 중 낮은 쪽 × 연 지급 횟수 (basis "recent")
 *    — 신규 상품은 변동성이 컸던 때의 분배금이 그대로 이어진다고 볼 수 없어 낮은 쪽을 쓴다.
 * 네이버의 12개월 분배율은 상장 1년 미만이면 받은 분배금을 연환산 없이 더한 값이라 맞지 않는다(2026-10 KODEX 200커버드콜액티브 7.5% ↔ 실제 약 30%).
 *
 * 한계: 주당 금액이라 가격 변동은 별도이고, 분배금은 시장 변동성에 따라 달라진다(변동성이 큰 시기에 커진 분배금이 조용한 시장에서 줄 수 있다).
 */

export type DistRow = { record_date: string; per_share: number };

export type DistributionStats = {
  code: string;
  payments: number;
  firstDate: string;
  lastDate: string;
  lastPerShare: number;
  /** 첫 지급 ~ 마지막 지급 사이 개월 수 */
  historyMonths: number;
  /** 지급 간격(개월, 중앙값) — 월 지급이면 1 */
  gapMonths: number;
  annualPerShare: number;
  basis: "ttm" | "recent";
  /** 최근 6회 변동계수(표준편차÷평균) — 4회 미만이면 null */
  cv6: number | null;
  /** 최근 3회 평균 ÷ 그 직전 3회 평균 − 1 (%) — 6회 미만이면 null */
  trendPct: number | null;
  /** 마지막 지급이 최근 12회 중 최고 대비 몇 %인지 */
  lastVsPeakPct: number;
  /** 최근 3회 평균 ÷ 최근 12회 중 가장 오래된 3회 평균 — 12회 미만이면 null. 분배금이 1년 새 몇 배가 됐는지 */
  surgeX: number | null;
  /** 오늘 기준 최근 약 3개월(92일)에 받은 주당 분배금 합계 */
  sum3m: number;
  /** 마지막 지급 후 지급 간격을 훨씬 넘겨 새 자료가 없다 → 분배율 교체에 쓰지 않는다 */
  stale: boolean;
};

const DAY = 86_400_000;
const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DAY;
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

export function computeDistributionStats(code: string, rows: DistRow[], today: string): DistributionStats | null {
  const list = rows
    .map((r) => ({ d: String(r.record_date).slice(0, 10), v: Number(r.per_share) }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.d) && Number.isFinite(r.v) && r.v > 0)
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  if (!list.length) return null;
  const n = list.length;
  const first = list[0];
  const last = list[n - 1];
  const historyMonths = daysBetween(first.d, last.d) / 30.44;

  // 지급 간격: 최근 12개 간격의 중앙값(개월, 최소 1)
  const gaps = list.slice(1).map((r, i) => daysBetween(list[i].d, r.d) / 30.44).slice(-12).sort((a, b) => a - b);
  const gapMonths = gaps.length ? Math.max(1, Math.round(gaps[Math.floor(gaps.length / 2)])) : 1;

  const recentValues = list.map((r) => r.v);
  let annualPerShare: number;
  let basis: "ttm" | "recent";
  if (historyMonths >= 11.5) {
    const from = Date.parse(last.d) - 365 * DAY;
    annualPerShare = list.filter((r) => Date.parse(r.d) > from).reduce((s, r) => s + r.v, 0);
    basis = "ttm";
  } else {
    const m3 = mean(recentValues.slice(-3));
    const m6 = mean(recentValues.slice(-6));
    annualPerShare = Math.min(m3, m6) * (12 / gapMonths);
    basis = "recent";
  }

  const last6 = recentValues.slice(-6);
  const cv6 = last6.length >= 4 ? (() => {
    const m = mean(last6);
    return m > 0 ? Math.sqrt(mean(last6.map((x) => (x - m) ** 2))) / m : null;
  })() : null;
  const trendPct = n >= 6 ? (mean(recentValues.slice(-3)) / mean(recentValues.slice(-6, -3)) - 1) * 100 : null;
  const peak = Math.max(...recentValues.slice(-12));

  const last12 = recentValues.slice(-12);
  const surgeX = last12.length >= 12 ? mean(last12.slice(-3)) / mean(last12.slice(0, 3)) : null;
  const from3m = Date.parse(today) - 92 * DAY;
  const sum3m = list.filter((r) => Date.parse(r.d) > from3m).reduce((s, r) => s + r.v, 0);

  const staleDays = Math.max(45, gapMonths * 31 + 15);
  return {
    code,
    payments: n,
    firstDate: first.d,
    lastDate: last.d,
    lastPerShare: last.v,
    historyMonths,
    gapMonths,
    annualPerShare,
    basis,
    cv6,
    trendPct,
    lastVsPeakPct: peak > 0 ? (last.v / peak) * 100 : 100,
    surgeX,
    sum3m,
    stale: daysBetween(last.d, today) > staleDays,
  };
}

export type YieldPick = { pct: number; source: "history" | "short" } | null;

/**
 * 가이드가 쓸 분배율(%)을 정한다. null이면 기존(네이버 12개월 → 유형별 가정) 그대로.
 *  - 새 자료가 없거나(낡음) 가격을 모르면 null
 *  - 지급 6회 이상이면 이력으로 계산한 값
 *  - 6회 미만(짧은 이력)이면 이력 값과 네이버 값 중 낮은 쪽 (과대 추정 방지)
 */
export function pickYieldPct(stats: DistributionStats | null | undefined, price: number, naverPct: number | null | undefined): YieldPick {
  if (!stats || stats.stale || !(price > 0)) return null;
  const pct = (stats.annualPerShare / price) * 100;
  if (!Number.isFinite(pct) || pct < 0) return null;
  if (stats.payments >= 6) return { pct, source: "history" };
  const naver = naverPct != null && Number.isFinite(naverPct) && naverPct >= 0 ? naverPct : null;
  return { pct: naver != null ? Math.min(pct, naver) : pct, source: "short" };
}
