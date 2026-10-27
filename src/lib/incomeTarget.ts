/**
 * 인컴 목표 — 고정비 사다리를 분배금으로 덮으려 할 때 "다음 칸까지 얼마가 더 필요한가"와
 * "일반 계좌 금융소득 한도 안에서 어디까지 가능한가"를 계산한다.
 * 서버(handlers/ui/saving-progress.ts)와 웹(features/saving-progress)이 같이 쓴다 — 서버 전용 패키지를 import하지 않는다.
 *
 * 세금 선(일반 계좌 이자·배당 합계, 연, 세전):
 *  - 직장가입자: 2,000만원 — 금융소득종합과세 기준이자, 보수 외 소득이 이를 넘으면 건강보험 소득월액 보험료가 붙기 시작한다
 *  - 지역가입자: 1,000만원 — 이를 넘으면 금융소득이 건강보험료 소득에 잡힌다(2,000만원은 종합과세 기준)
 * 세법·건강보험 기준은 바뀔 수 있고 가족 상황마다 달라서, 화면은 "넘기 전에 확인" 안내로만 쓴다.
 */
import { DISTRIBUTION_TAX_RATE, costLadder, type AccountKind, type CostLadder, type LadderRung } from "./savingProgress";

export type TaxProfile = "worker" | "regional";

export const FINANCIAL_INCOME_LIMIT: Record<TaxProfile, number> = { worker: 20_000_000, regional: 10_000_000 };
/** 선에 딱 맞추지 않고 분배금이 늘어날 여유를 둔다 */
export const LIMIT_SAFETY = 0.9;
/** 같은 계열이 일반 인컴에서 넘지 않을 비중(상품 점검의 쏠림 기준과 같은 값) */
export const FAMILY_SHARE_CAP = 0.4;
const NET = 1 - DISTRIBUTION_TAX_RATE;

export type DistributionHolding = { value: number; accountKind: AccountKind; isTR: boolean; yieldPct: number };

/**
 * 계좌 종류별 연 분배금(세전). 분배금을 안에서 재투자하는 TR형은 지급이 없어 뺀다.
 * 일반 계좌 값이 세금 선과 비교되고 바로 꺼내 쓸 수 있는 돈이다. ISA·연금은 계좌 안에 쌓여 고정비로 바로 쓰이지 않는다.
 */
export function annualDistribution(holdings: DistributionHolding[]): { general: number; isa: number; pension: number } {
  const out = { general: 0, isa: 0, pension: 0 };
  for (const h of holdings) {
    if (!(h.value > 0) || h.isTR || !(h.yieldPct > 0)) continue;
    out[h.accountKind] += (h.value * h.yieldPct) / 100;
  }
  return { general: Math.round(out.general), isa: Math.round(out.isa), pension: Math.round(out.pension) };
}

export type TargetRung = LadderRung & { state: "passed" | "next" | "later" };
export type RungGap = {
  label: string;
  cumulative: number;
  /** 지금 분배금(세후 월)과의 차이 */
  gapMonthly: number;
  /** 같은 분배율로 일반 계좌에 담을 때 더 필요한 원금 */
  extraCapital: number;
  /** 이 칸이 일반 계좌 세금 선 안에서 닿는 칸인지 */
  withinLimit: boolean;
};
export type IncomeTargetPlan = {
  /** 세금 선(연, 세전)과 여유를 둔 선 */
  limitAnnual: number;
  safeLimitAnnual: number;
  /** 지금 일반 계좌 분배금이 여유 선의 몇 %인지 */
  usedPct: number;
  status: "ok" | "near" | "over";
  /** 지금 일반 계좌 분배금(세후 월)과, 여유 선까지 받을 수 있는 최대(세후 월) */
  monthlyNow: number;
  maxMonthly: number;
  /** 여유 선까지 일반 계좌에 더 담을 수 있는 원금 */
  roomCapital: number;
  ladder: CostLadder;
  next: RungGap | null;
  target: RungGap | null;
};

export function incomeTargetPlan(input: {
  fixed: Array<{ label: string; amount: number }>;
  /** 인컴으로 덮을 마지막 칸의 이름. 없거나 사다리에 없으면 목표 없음 */
  targetLabel: string | null;
  taxProfile: TaxProfile;
  generalGrossAnnual: number;
  /** 새로 담을 인컴의 가정 분배율(%) */
  yieldPct: number;
}): IncomeTargetPlan {
  const limitAnnual = FINANCIAL_INCOME_LIMIT[input.taxProfile];
  const safeLimitAnnual = limitAnnual * LIMIT_SAFETY;
  const gross = Math.max(0, input.generalGrossAnnual);
  const y = Math.max(0, input.yieldPct) / 100;
  const monthlyNow = (gross * NET) / 12;
  const maxMonthly = (safeLimitAnnual * NET) / 12;
  const usedPct = safeLimitAnnual > 0 ? (gross / safeLimitAnnual) * 100 : 0;
  const status: IncomeTargetPlan["status"] = gross > limitAnnual ? "over" : usedPct >= 80 ? "near" : "ok";
  // 사다리 계단을 만드는 규칙(같은 이름 합치기·작은 것부터)을 그대로 쓰려고, 월 분배금을 원금×100%÷12로 넘긴다
  const ladder = costLadder({ fixed: input.fixed, principal: monthlyNow * 12, withdrawalPct: 100, addedThisMonth: 0 });
  const gap = (r: LadderRung): RungGap => {
    const gapMonthly = Math.max(0, r.cumulative - monthlyNow);
    return {
      label: r.label,
      cumulative: r.cumulative,
      gapMonthly,
      extraCapital: y > 0 ? Math.round((gapMonthly * 12) / NET / y) : 0,
      withinLimit: r.cumulative <= maxMonthly,
    };
  };
  const targetRung = input.targetLabel ? ladder.rungs.find((r) => r.label === input.targetLabel) : undefined;
  return {
    limitAnnual,
    safeLimitAnnual,
    usedPct,
    status,
    monthlyNow,
    maxMonthly,
    roomCapital: y > 0 ? Math.round(Math.max(0, safeLimitAnnual - gross) / y) : 0,
    ladder,
    next: ladder.next ? gap(ladder.next) : null,
    target: targetRung ? gap(targetRung) : null,
  };
}

export type SplitCandidate = { code: string; name: string; verdict: string; value: number; familySharePct: number };

/**
 * 더 담을 금액을 상품 점검의 "담을 후보"에게 나눈다. 균등하게 나누되, 담은 뒤에도 같은 계열이
 * 일반 인컴의 40%를 넘지 않게 상한을 두고, 못 나눈 몫은 leftover로 돌려준다(후보가 없으면 전부 leftover).
 */
export function splitAmount(rows: SplitCandidate[], amount: number): { parts: Array<{ code: string; name: string; amount: number }>; leftover: number } {
  const total = rows.reduce((s, r) => s + Math.max(0, r.value), 0);
  const want = Math.max(0, Math.round(amount));
  const picks = rows.filter((r) => r.verdict === "add");
  if (!picks.length || total <= 0 || want <= 0) return { parts: [], leftover: want };
  // 같은 계열(같은 비중)은 상한을 나눠 쓴다
  const perFamily = new Map<number, number>();
  for (const r of picks) perFamily.set(Math.round(r.familySharePct * 10), (perFamily.get(Math.round(r.familySharePct * 10)) ?? 0) + 1);
  const room = new Map<string, number>(
    picks.map((r) => {
      const familyValue = (r.familySharePct / 100) * total;
      const n = perFamily.get(Math.round(r.familySharePct * 10)) ?? 1;
      return [r.code, Math.max(0, (FAMILY_SHARE_CAP * (total + want) - familyValue) / n)];
    }),
  );
  const given = new Map<string, number>();
  let remaining = want;
  for (let pass = 0; pass < picks.length && remaining > 1; pass += 1) {
    const open = picks.filter((r) => (room.get(r.code) ?? 0) - (given.get(r.code) ?? 0) > 1);
    if (!open.length) break;
    const share = remaining / open.length;
    for (const r of open) {
      const left = (room.get(r.code) ?? 0) - (given.get(r.code) ?? 0);
      const give = Math.min(share, left);
      given.set(r.code, (given.get(r.code) ?? 0) + give);
      remaining -= give;
    }
  }
  const parts = picks
    .map((r) => ({ code: r.code, name: r.name, amount: Math.round((given.get(r.code) ?? 0) / 1000) * 1000 }))
    .filter((p) => p.amount > 0);
  return { parts, leftover: Math.max(0, want - parts.reduce((s, p) => s + p.amount, 0)) };
}

export type CompositionId = "income" | "balanced" | "growth";
/**
 * 인컴 구성 3종 — 순위가 아니라 대가를 나란히 보는 용도. 분배율은 docs/research-income-then-growth-2026-10-03.md 한국 표본의
 * 값(커버드콜 2종 균등 8.2%, 고배당 50%+커버드콜 50% 6.5%)이고, 성장 중심 4.5%는 고배당 위주 가정이다(검증 표 없음).
 * 같은 문서에서 분배율 1%p를 올릴 때마다 이 기간 총수익이 대략 15~20%p 줄었다.
 */
export const COMPOSITIONS: Record<CompositionId, { label: string; mix: string; yieldPct: number; cost: string }> = {
  income: { label: "인컴 집중", mix: "커버드콜 위주", yieldPct: 8.2, cost: "분배금이 시장 변동에 따라 크게 흔들리고 원금이 깎일 수 있으며, 장기 성장을 가장 많이 포기합니다" },
  balanced: { label: "균형", mix: "고배당 50% + 커버드콜 50%", yieldPct: 6.5, cost: "분배가 덜 흔들리지만 필요한 원금이 늘고, 성장은 지수보다 낮습니다" },
  growth: { label: "성장 중심", mix: "고배당·배당성장 + 지수 일부", yieldPct: 4.5, cost: "분배금이 안정적이고 성장이 남지만 같은 월 금액에 필요한 원금이 가장 큽니다" },
};

export type CompositionRow = {
  id: CompositionId;
  label: string;
  mix: string;
  yieldPct: number;
  cost: string;
  /** 목표 월 금액(세후)을 일반 계좌 분배금으로 받는 데 필요한 원금 */
  requiredCapital: number;
  /** 지금 일반 계좌 인컴 원금과의 차이 */
  extraCapital: number;
  /** 월 적립이 있을 때 걸리는 개월 수(분배금 재투자 제외). 적립이 없으면 null, 이미 닿았으면 0 */
  months: number | null;
  /** 목표가 일반 계좌 세금 선(여유 선) 안에서 받는 분배금인지, 넘는다면 선 밖 연 분배금(세전) */
  withinLimit: boolean;
  overLimitGross: number;
};

/** 목표 월 금액을 구성 3종으로 만들 때의 필요 원금·기간·세금 선 */
export function compareCompositions(input: {
  targetMonthlyNet: number;
  generalIncomeCapital: number;
  monthlyDeposit: number;
  taxProfile: TaxProfile;
}): CompositionRow[] {
  const target = Math.max(0, input.targetMonthlyNet);
  const grossAnnual = (target * 12) / NET;
  const safeLimit = FINANCIAL_INCOME_LIMIT[input.taxProfile] * LIMIT_SAFETY;
  return (Object.keys(COMPOSITIONS) as CompositionId[]).map((id) => {
    const c = COMPOSITIONS[id];
    const requiredCapital = Math.round(grossAnnual / (c.yieldPct / 100));
    const extraCapital = Math.max(0, requiredCapital - Math.max(0, input.generalIncomeCapital));
    return {
      id,
      ...c,
      requiredCapital,
      extraCapital,
      months: extraCapital === 0 ? 0 : input.monthlyDeposit > 0 ? Math.ceil(extraCapital / input.monthlyDeposit) : null,
      withinLimit: grossAnnual <= safeLimit,
      overLimitGross: Math.max(0, Math.round(grossAnnual - safeLimit)),
    };
  });
}

export type ShortfallPlan = {
  /** 목표 시점까지 남은 개월(모르면 null) */
  monthsLeft: number | null;
  /** 기한 안에 닿으려면 매달 넣어야 하는 돈(기한을 모르면 null)과, 지금 적립에서 모자란 몫 */
  neededDeposit: number | null;
  depositGap: number;
  /** 지금 적립 그대로면 걸리는 개월(적립이 없으면 null) — 기한을 늘리는 선택지 */
  monthsAtCurrentDeposit: number | null;
  /** 기한 안에 지금 적립으로 닿는 세후 월 금액(세금 선으로 자른 값)과, 그 안에서 덮이는 가장 높은 칸 — 목표를 낮추는 선택지 */
  reachableMonthly: number | null;
  reachableRung: string | null;
  /** 일반 계좌 세금 선을 넘는 연 분배금(세전) — 다른 계좌 배치·급여로 메울 몫 */
  overLimitGross: number;
};

/**
 * 목표에 모자랄 때의 선택지를 숫자로 낸다 — 적립을 늘리거나, 기한을 늘리거나, 목표를 낮추거나, 세금 선 밖은 따로 메운다.
 * 분배금 재투자는 빼고(보수적), 목표를 낮추는 쪽은 일반 계좌 세금 선 안으로 자른다.
 */
export function shortfallPlan(input: {
  row: CompositionRow;
  generalIncomeCapital: number;
  monthlyDeposit: number;
  monthsLeft: number | null;
  taxProfile: TaxProfile;
  rungs: Array<{ label: string; cumulative: number }>;
}): ShortfallPlan {
  const { row } = input;
  const deposit = Math.max(0, input.monthlyDeposit);
  const months = input.monthsLeft != null && input.monthsLeft > 0 ? Math.round(input.monthsLeft) : null;
  const neededDeposit = months != null ? Math.ceil(row.extraCapital / months) : null;
  let reachableMonthly: number | null = null;
  let reachableRung: string | null = null;
  if (months != null) {
    const capital = Math.max(0, input.generalIncomeCapital) + deposit * months;
    const maxMonthly = (FINANCIAL_INCOME_LIMIT[input.taxProfile] * LIMIT_SAFETY * NET) / 12;
    reachableMonthly = Math.min((capital * (row.yieldPct / 100) * NET) / 12, maxMonthly);
    const passed = input.rungs.filter((r) => r.cumulative <= reachableMonthly!);
    reachableRung = passed.length ? passed[passed.length - 1].label : null;
  }
  return {
    monthsLeft: months,
    neededDeposit,
    depositGap: neededDeposit != null ? Math.max(0, neededDeposit - deposit) : 0,
    monthsAtCurrentDeposit: row.months,
    reachableMonthly,
    reachableRung,
    overLimitGross: row.overLimitGross,
  };
}
