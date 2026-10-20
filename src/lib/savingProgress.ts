/**
 * "내 모으기" — 시장과 상관없이 내가 정할 수 있는 숫자(넣은 원금·넣은 달·세금으로 아끼는 돈)를 계산한다.
 * 평가금(수익률)은 자주 볼수록 손실을 크게 느껴 그만두기 쉬워서(근시안적 손실 회피), 화면에서는 맨 아래 작게 둔다.
 * 서버(handlers/ui/saving-progress.ts)와 웹(features/saving-progress)이 같이 쓴다 — 서버 전용 패키지를 import하지 않는다.
 */

/** 연금저축+IRP 세액공제 대상 납입 한도(연) */
export const PENSION_CREDIT_CAP = 9_000_000;
/** 세액공제율(지방소득세 포함) — 총급여 5,500만원(종합소득 4,500만원) 이하 16.5%, 초과 13.2% */
export const PENSION_CREDIT_RATE_LOW_INCOME = 0.165;
export const PENSION_CREDIT_RATE = 0.132;
/** 일반 계좌 분배금 원천징수율 */
export const DISTRIBUTION_TAX_RATE = 0.154;

export type AccountKind = "general" | "isa" | "pension";

export function accountKind(label: string | null | undefined): AccountKind {
  const s = String(label ?? "");
  if (/ISA/i.test(s)) return "isa";
  if (/연금|IRP|퇴직/i.test(s)) return "pension";
  return "general";
}

/** 분배금을 펀드 안에서 재투자하는 TR형 */
export function isTotalReturnEtf(name: string | null | undefined): boolean {
  return /TR\b|토탈리턴/i.test(String(name ?? ""));
}

/** 'YYYY-MM' 다음 달 */
export function nextYm(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function prevYm(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** 넣은 달 = 직접 체크인한 달(금액 > 0) ∪ 실계좌 순매수(매수 − 매도)가 있었던 달 */
export function doneMonths(input: { deposits: Array<[string, number]>; buyMonths: string[] }): Set<string> {
  const out = new Set<string>();
  for (const [ym, amount] of input.deposits) if (amount > 0) out.add(ym);
  for (const ym of input.buyMonths) out.add(ym);
  return out;
}

/**
 * 이어서 넣은 달 수. 이번 달은 아직 기회가 남았으니, 안 넣었어도 지난달까지의 연속을 끊지 않는다.
 * pendingThisMonth = 이번 달을 아직 안 넣었는지(화면에서 "이번 달 남음"으로 보여 줄 때 쓴다).
 */
export function streak(done: Set<string>, currentYm: string): { count: number; pendingThisMonth: boolean } {
  const pendingThisMonth = !done.has(currentYm);
  let ym = pendingThisMonth ? prevYm(currentYm) : currentYm;
  let count = 0;
  while (done.has(ym)) {
    count += 1;
    ym = prevYm(ym);
  }
  return { count, pendingThisMonth };
}

export type MonthCell = { ym: string; state: "done" | "missed" | "pending" | "future" | "before" };

/**
 * 최근 years년 달력(1~12월 한 줄씩). 첫 기록 전 달은 'before'(기록 없음 — 빠진 게 아니다),
 * 첫 기록 뒤 안 넣은 지난 달은 'missed', 이번 달을 아직 안 넣었으면 'pending'.
 */
export function monthGrid(done: Set<string>, currentYm: string, years = 2): Array<{ year: number; months: MonthCell[] }> {
  const first = [...done].sort()[0] ?? currentYm;
  const curYear = Number(currentYm.slice(0, 4));
  const rows: Array<{ year: number; months: MonthCell[] }> = [];
  for (let year = curYear - years + 1; year <= curYear; year++) {
    const months: MonthCell[] = [];
    for (let m = 1; m <= 12; m++) {
      const ym = `${year}-${String(m).padStart(2, "0")}`;
      let state: MonthCell["state"];
      if (ym > currentYm) state = "future";
      else if (done.has(ym)) state = "done";
      else if (ym === currentYm) state = "pending";
      else if (ym < first) state = "before";
      else state = "missed";
      months.push({ ym, state });
    }
    rows.push({ year, months });
  }
  return rows;
}

/** 연금저축·IRP 세액공제 — 연 납입액(한도 900만원)에 공제율 두 가지 */
export function pensionCredit(annualContribution: number): { base: number; low: number; high: number } {
  const base = Math.max(0, Math.min(PENSION_CREDIT_CAP, Math.round(annualContribution)));
  return { base, low: Math.round(base * PENSION_CREDIT_RATE), high: Math.round(base * PENSION_CREDIT_RATE_LOW_INCOME) };
}

export type TaxHolding = { value: number; accountKind: AccountKind; isTR: boolean; yieldPct: number };

/**
 * 1년에 분배금 세금(15.4%)을 덜 내거나 미루는 금액(추정).
 * - tr: 일반 계좌 TR형 — 분배금이 지급되지 않아 원천징수가 없다. 분배율은 같은 지수 일반형 값(underlyingYieldPct)
 * - isa: ISA 안 분배금(비과세 한도 안이라고 본다)
 * - pension: 연금 계좌 안 분배금(지금 떼지 않고 연금 받을 때 3.3~5.5%로 — 미루는 것)
 */
export function distributionTaxSaved(holdings: TaxHolding[], underlyingYieldPct: number | null): { tr: number; isa: number; pension: number } {
  let tr = 0;
  let isa = 0;
  let pension = 0;
  for (const h of holdings) {
    if (!(h.value > 0)) continue;
    if (h.accountKind === "general") {
      if (h.isTR && underlyingYieldPct != null && underlyingYieldPct > 0) tr += (h.value * underlyingYieldPct) / 100 * DISTRIBUTION_TAX_RATE;
    } else {
      const y = h.isTR ? (underlyingYieldPct ?? 0) : h.yieldPct;
      const saved = (h.value * Math.max(0, y)) / 100 * DISTRIBUTION_TAX_RATE;
      if (h.accountKind === "isa") isa += saved;
      else pension += saved;
    }
  }
  return { tr: Math.round(tr), isa: Math.round(isa), pension: Math.round(pension) };
}

/** 지수가 고점보다 fromHighPct(음수) 낮을 때, 같은 돈으로 고점 때보다 몇 % 더 많은 수량을 사는지 */
export function extraUnitsPct(fromHighPct: number): number {
  if (!(fromHighPct < 0) || fromHighPct <= -100) return 0;
  return (1 / (1 + fromHighPct / 100) - 1) * 100;
}

export type LadderRung = { label: string; amount: number; cumulative: number };
export type CostLadder = {
  /** 원금 × 인출률 ÷ 12 — 원금으로 매달 꺼내 쓸 수 있다고 보는 돈 */
  monthly: number;
  /** 고정비를 작은 것부터 쌓은 계단. cumulative = 이 칸까지 합계 */
  rungs: LadderRung[];
  /** 지금 넘은 칸 수 */
  passedCount: number;
  /** 다음 칸과 거기까지 온 비율(0~100). 다 넘었으면 null */
  next: (LadderRung & { pct: number }) | null;
  /** 이번 달에 넣은 돈으로 새로 넘은 칸 중 가장 높은 것 */
  newlyPassed: LadderRung | null;
};

/**
 * "이 돈이 대신 내 주는 우리 집 고정비" — 가계부 고정지출을 작은 것부터 쌓아, 원금으로 매달 꺼낼 수 있는 돈이 어느 칸까지 왔는지.
 * 원금 기준이라 시장이 빠져도 칸이 뒤로 가지 않는다. 인출률은 목표 트래커와 같은 값을 받아 같은 카드의 목표 막대와 어긋나지 않게 한다.
 * 같은 이름은 합치고, 0원 이하(환급 등)는 뺀다.
 */
export function costLadder(input: {
  fixed: Array<{ label: string; amount: number }>;
  principal: number;
  withdrawalPct: number;
  addedThisMonth: number;
}): CostLadder {
  const toMonthly = (p: number) => (Math.max(0, p) * Math.max(0, input.withdrawalPct)) / 100 / 12;
  const monthly = toMonthly(input.principal);
  const before = toMonthly(input.principal - Math.max(0, input.addedThisMonth));
  const byLabel = new Map<string, number>();
  for (const f of input.fixed) {
    const label = String(f.label ?? "").trim();
    const amount = Number(f.amount);
    if (!label || !(amount > 0)) continue;
    byLabel.set(label, (byLabel.get(label) ?? 0) + amount);
  }
  let cumulative = 0;
  const rungs = [...byLabel.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([label, amount]) => ({ label, amount, cumulative: (cumulative += amount) }));
  const passed = rungs.filter((r) => r.cumulative <= monthly);
  const nextRung = rungs[passed.length];
  const fresh = passed.filter((r) => r.cumulative > before);
  return {
    monthly,
    rungs,
    passedCount: passed.length,
    next: nextRung ? { ...nextRung, pct: Math.min(100, (monthly / nextRung.cumulative) * 100) } : null,
    newlyPassed: fresh.length ? fresh[fresh.length - 1] : null,
  };
}

/**
 * 코스피가 최근 window거래일 고점보다 thresholdPct(음수) 이상 빠진 날이 있었던 달('YYYY-MM').
 * closes는 오래된 것부터. 처음 window일은 고점을 다 볼 수 없어 판정하지 않고, 판정을 시작한 달을 since로 준다.
 * "내 모으기"의 '빠진 달에도 넣은 횟수'에 쓴다 — 그만두기 가장 쉬운 때 넣은 것을 센다.
 */
export function dropMonths(closes: Array<{ date: string; close: number }>, thresholdPct = -10, window = 60): { months: string[]; since: string | null } {
  const days = closes.filter((d) => Number.isFinite(d.close) && d.close > 0);
  const out = new Set<string>();
  let since: string | null = null;
  for (let i = window - 1; i < days.length; i += 1) {
    let high = 0;
    for (let j = i - window + 1; j <= i; j += 1) high = Math.max(high, days[j].close);
    const ym = days[i].date.slice(0, 7);
    if (since == null) since = ym;
    if ((days[i].close / high - 1) * 100 <= thresholdPct) out.add(ym);
  }
  return { months: [...out].sort(), since };
}
