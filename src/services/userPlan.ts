/**
 * 내 계획 — 매달 투자할 돈·넣는 날·버틸 하락폭·개별주 몫을 한 묶음으로 둔다 (docs/plan-real-vs-experiment-ux-2026-10-12.md).
 *
 * 방향을 바꾸는 저장 경로는 이것 하나다. 실험(가상) 계좌는 이 계획을 그대로 따른다:
 * - monthly·depositDay → 가상 월 입금(monthlyDeposit.ts의 virtual_monthly_deposit·virtual_deposit_day)
 * - satellitePct → 자동매매 방식(0이면 지수 보유, 10이면 종목 봇이 시드 10% 안에서 개별주)
 * 실제 계좌(내가 직접 매매)에는 입금·자동매매를 걸지 않는다 — 기록과 리밸런싱 제안만.
 *
 * 예전 계정은 invest_plan이 없다 — 지금 저장된 월 입금·입금일·자동매매 방식에서 읽어 온다.
 */
import { INDEX_HOLD_MODE, normalizeStrategyMode, type VirtualStrategyMode } from "./indexHoldStrategy";
import { EXPERIMENT_CAP_PCT, SATELLITE_CAP_PCT, readSatelliteCapPct } from "./virtualAutoTradeCashSweep";
import {
  MAX_DEPOSIT_DAY,
  normalizeDepositDay,
  normalizeMonthlyDeposit,
  readDepositLog,
  readDepositSettings,
  resolveLastDepositMonthOnSave,
} from "./monthlyDeposit";

/** 0 지수만 · 10 개별주 10%까지 · 100 관리자 실험(종목 봇 전체, 11/23 검증 데이터 수집) */
export const SATELLITE_OPTIONS = [0, 10, 100] as const;
/** 관리자만 고를 수 있는 값 — 일반 사용자는 검증된 규칙을 따라가는 쪽이다 */
export const ADMIN_ONLY_SATELLITE = EXPERIMENT_CAP_PCT;
export type SatellitePct = (typeof SATELLITE_OPTIONS)[number];
/** 계획 점검의 버틸 하락폭 슬라이더와 같은 범위 */
export const TOLERANCE_MIN = 10;
export const TOLERANCE_MAX = 50;

export type InvestPlan = {
  /** 매달 투자할 돈 (0이면 적립 안 함) */
  monthly: number;
  /** 급여일(가구에 급여일이 둘이면 늦은 날). 넣는 날은 이 다음 날 */
  payday: number | null;
  /** 실험 계좌에 넣는 날 (1~28) */
  depositDay: number;
  /** 버틸 수 있는 하락폭(%) — 주식 비중 상한의 근거. 안 정했으면 null */
  tolerancePct: number | null;
  /** 개별주 몫(%) — 0이면 지수만, 100은 관리자 실험 */
  satellitePct: SatellitePct;
};

/** 급여일 다음 날. 28일을 넘으면 다음 달 1일 (입금일은 1~28만 쓴다) */
export function depositDayFromPayday(payday: number): number {
  const next = Math.trunc(payday) + 1;
  return next > MAX_DEPOSIT_DAY ? 1 : Math.max(1, next);
}

function normalizePayday(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null;
}

function normalizeTolerance(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= TOLERANCE_MIN && n <= TOLERANCE_MAX && n % 5 === 0 ? n : null;
}

function readSatellitePct(prefs: Record<string, unknown>): SatellitePct {
  if (normalizeStrategyMode(prefs.virtual_strategy_mode) === INDEX_HOLD_MODE) return 0;
  return readSatelliteCapPct(prefs) === EXPERIMENT_CAP_PCT ? 100 : 10;
}
const modeFromSatellite = (pct: SatellitePct): VirtualStrategyMode => (pct === 0 ? INDEX_HOLD_MODE : "stock");

export function readInvestPlan(prefs: Record<string, unknown>): InvestPlan {
  const deposit = readDepositSettings(prefs);
  const stored = (prefs.invest_plan ?? {}) as Record<string, unknown>;
  return {
    monthly: deposit.monthlyDeposit,
    depositDay: deposit.depositDay,
    payday: normalizePayday(stored.payday),
    tolerancePct: normalizeTolerance(stored.tolerancePct),
    satellitePct: readSatellitePct(prefs),
  };
}

export type InvestPlanPatch = Partial<Record<keyof InvestPlan, unknown>>;

/**
 * 바꿀 칸만 받아 지금 계획에 합친다. 급여일을 바꾸고 넣는 날을 따로 주지 않으면 넣는 날은 급여일 다음 날.
 * 잘못된 값은 저장하지 않고 이유를 돌려준다.
 */
export function mergeInvestPlan(
  current: InvestPlan,
  patch: InvestPlanPatch
): { ok: true; value: InvestPlan } | { ok: false; error: string } {
  const next: InvestPlan = { ...current };
  if (patch.monthly !== undefined) {
    const monthly = normalizeMonthlyDeposit(patch.monthly);
    if (monthly === null) return { ok: false, error: "매달 투자할 돈은 0(적립 안 함) 또는 1만원 이상이어야 합니다" };
    next.monthly = monthly;
  }
  if (patch.payday !== undefined) {
    if (patch.payday === null) next.payday = null;
    else {
      const payday = normalizePayday(patch.payday);
      if (payday === null) return { ok: false, error: "급여일은 1~31일이어야 합니다" };
      next.payday = payday;
      if (patch.depositDay === undefined) next.depositDay = depositDayFromPayday(payday);
    }
  }
  if (patch.depositDay !== undefined) next.depositDay = normalizeDepositDay(patch.depositDay);
  if (patch.tolerancePct !== undefined) {
    if (patch.tolerancePct === null) next.tolerancePct = null;
    else {
      const tolerance = normalizeTolerance(patch.tolerancePct);
      if (tolerance === null) return { ok: false, error: `버틸 하락폭은 ${TOLERANCE_MIN}~${TOLERANCE_MAX}% 사이 5% 단위여야 합니다` };
      next.tolerancePct = tolerance;
    }
  }
  if (patch.satellitePct !== undefined) {
    const pct = Number(patch.satellitePct);
    if (!SATELLITE_OPTIONS.includes(pct as SatellitePct)) return { ok: false, error: "개별주 몫은 0·10%(관리자는 실험 100%)만 고를 수 있습니다" };
    next.satellitePct = pct as SatellitePct;
  }
  return { ok: true, value: next };
}

/**
 * 계획을 prefs에 쓸 값 — 실험 계좌의 월 입금·자동매매 방식도 같이 맞춘다.
 * "마지막 입금 달"은 금액·넣는 날이 바뀔 때만 다시 정한다 (개별주 몫만 바꿨는데 이번 달 입금이 건너뛰어지지 않게).
 */
export function investPlanPrefsPatch(
  plan: InvestPlan,
  prefs: Record<string, unknown>,
  todayKey: string
): Record<string, unknown> {
  const before = readInvestPlan(prefs);
  const depositChanged = before.monthly !== plan.monthly || before.depositDay !== plan.depositDay;
  return {
    invest_plan: { payday: plan.payday, tolerancePct: plan.tolerancePct },
    virtual_monthly_deposit: plan.monthly,
    virtual_deposit_day: plan.depositDay,
    ...(depositChanged
      ? {
          virtual_last_deposit_month: resolveLastDepositMonthOnSave({
            depositDay: plan.depositDay,
            previousLastDepositMonth: readDepositSettings(prefs).lastDepositMonth,
            todayKey,
            depositLog: readDepositLog(prefs),
          }),
        }
      : {}),
    virtual_strategy_mode: modeFromSatellite(plan.satellitePct),
    // 지수만(0)일 때는 몫을 쓰지 않으므로 기본값으로 둔다
    virtual_satellite_cap_pct: plan.satellitePct === 100 ? EXPERIMENT_CAP_PCT : SATELLITE_CAP_PCT,
  };
}
