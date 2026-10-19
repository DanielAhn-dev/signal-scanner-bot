/**
 * 내 계획 — 매달 투자할 돈·넣는 날·버틸 하락폭·개별주 몫을 한 묶음으로 둔다 (docs/plan-real-vs-experiment-ux-2026-10-12.md).
 *
 * 방향을 바꾸는 저장 경로는 이것 하나다. 실험(가상) 계좌는 이 계획을 그대로 따른다:
 * - monthly·depositDay → 가상 월 입금(monthlyDeposit.ts의 virtual_monthly_deposit·virtual_deposit_day)
 * - satellitePct → 자동매매 방식(0이면 지수 보유, 10이면 종목 봇이 시드 10% 안에서 개별주)
 * 실제 계좌(내가 직접 매매)에는 입금·자동매매를 걸지 않는다 — 기록과 리밸런싱 제안만.
 *
 * 예전 계정은 invest_plan이 없다 — 지금 저장된 월 입금·입금일·자동매매 방식에서 읽어 온다.
 * 구성(mix)이 없으면 코스피200 100%로 읽는다(effectiveMix). 가상 계좌는 11/23 판정 전까지 구성을 따르지 않는다.
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

/** 구성에 넣을 수 있는 지수 — 처음엔 이 셋만 (섞어보기의 채권·금은 실험용으로 남긴다, docs/plan-screen-map-2026-10-19.md 3절) */
export const MIX_INDEXES = ["kospi200", "sp500", "nasdaq100"] as const;
export type MixIndex = (typeof MIX_INDEXES)[number];

/** 구성 한 줄 — 지수·비중(0~1)·지수별 상품·계좌 */
export type MixEntry = {
  index: MixIndex;
  weight: number;
  /** null이면 지수별 추천 규칙(규모·거래대금·보수)을 따른다 */
  product: { code: string; name: string } | null;
  /** null이면 안내만 — 사용자가 고르기 전 */
  account: { broker: string; account: string } | null;
};

/** 구성을 정하지 않은 계정은 지금처럼 코스피200 100%로 읽는다 */
export const DEFAULT_MIX: readonly MixEntry[] = Object.freeze([
  Object.freeze({ index: "kospi200", weight: 1, product: null, account: null }) as MixEntry,
]);

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
  /** 구성(지수·비중·상품·계좌). 정하지 않았으면 null — 읽을 때는 effectiveMix로 코스피200 100% */
  mix: MixEntry[] | null;
};

/** 구성을 쓰는 쪽은 이걸로 읽는다 — 정하지 않았으면 코스피200 100% */
export function effectiveMix(plan: Pick<InvestPlan, "mix">): readonly MixEntry[] {
  return plan.mix ?? DEFAULT_MIX;
}

const MIX_WEIGHT_TOLERANCE = 0.01;
const MAX_TEXT_LEN = 40;
/** KRX 단축코드 6자리 (2024년 이후 상장분은 영문이 섞인다, 예: 0080G0) */
const PRODUCT_CODE_RE = /^[0-9A-Z]{6}$/;

function cleanText(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  return s && s.length <= MAX_TEXT_LEN ? s : null;
}

/**
 * 구성을 검증해 정리한다: 지수는 목록 안·중복 없이, 비중은 0 초과·합 1(반올림 오차 1%p까지 받고 합 1로 맞춘다).
 * 상품·계좌는 비워 둘 수 있다(null). 잘못된 값은 이유를 돌려준다.
 */
export function normalizeMix(raw: unknown): { ok: true; value: MixEntry[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "구성은 지수를 하나 이상 담아야 합니다" };
  if (raw.length > MIX_INDEXES.length) return { ok: false, error: `구성에는 지수를 ${MIX_INDEXES.length}개까지 담을 수 있습니다` };
  const seen = new Set<string>();
  const entries: MixEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return { ok: false, error: "구성 항목 형식이 잘못됐습니다" };
    const r = item as Record<string, unknown>;
    if (!MIX_INDEXES.includes(r.index as MixIndex)) return { ok: false, error: "구성에는 코스피200·S&P500·나스닥100만 담을 수 있습니다" };
    const index = r.index as MixIndex;
    if (seen.has(index)) return { ok: false, error: "같은 지수를 구성에 두 번 담을 수 없습니다" };
    seen.add(index);
    const weight = Number(r.weight);
    if (!Number.isFinite(weight) || weight <= 0 || weight > 1) return { ok: false, error: "비중은 0보다 크고 1 이하여야 합니다" };

    let product: MixEntry["product"] = null;
    if (r.product != null) {
      const p = r.product as Record<string, unknown>;
      const code = typeof p.code === "string" ? p.code.trim().toUpperCase() : "";
      const name = cleanText(p.name);
      if (!PRODUCT_CODE_RE.test(code) || !name) return { ok: false, error: "상품은 6자리 종목코드와 이름이 있어야 합니다" };
      product = { code, name };
    }
    let account: MixEntry["account"] = null;
    if (r.account != null) {
      const a = r.account as Record<string, unknown>;
      const broker = cleanText(a.broker);
      const accountName = cleanText(a.account);
      if (!broker || !accountName) return { ok: false, error: `계좌는 증권사와 계좌 이름이 있어야 합니다(각 ${MAX_TEXT_LEN}자 이내)` };
      account = { broker, account: accountName };
    }
    entries.push({ index, weight, product, account });
  }
  const sum = entries.reduce((s, e) => s + e.weight, 0);
  if (Math.abs(sum - 1) > MIX_WEIGHT_TOLERANCE) return { ok: false, error: "비중의 합은 100%여야 합니다" };
  // 1/3씩처럼 반올림된 비중을 합 1로 맞춘다 (마지막 항목이 나머지를 받아 합이 정확히 1)
  let rest = 1;
  entries.forEach((e, i) => {
    e.weight = i === entries.length - 1 ? Math.round(rest * 10_000) / 10_000 : Math.round((e.weight / sum) * 10_000) / 10_000;
    rest -= e.weight;
  });
  return { ok: true, value: entries };
}

/**
 * 구성 중 해외지수(S&P500·나스닥100) 몫(%) — 리밸런싱 가이드의 '성장 바구니 안 해외 비중'이 이 값을 따른다(화면 지도 7단계).
 * 구성을 정하지 않았으면 null — 가이드에 따로 적어 둔 값을 그대로 쓴다.
 */
export function overseasPctOfMix(mix: MixEntry[] | null): number | null {
  if (!mix) return null;
  return Math.round(mix.filter((e) => e.index !== "kospi200").reduce((s, e) => s + e.weight, 0) * 100);
}

/** 저장된 구성 — 깨진 값은 정하지 않은 것(null)으로 본다 */
function readMix(raw: unknown): MixEntry[] | null {
  if (raw == null) return null;
  const parsed = normalizeMix(raw);
  return parsed.ok ? parsed.value : null;
}

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
    mix: readMix(stored.mix),
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
  // 구성은 통째로 바꾼다 (줄 단위 합치기는 합 1 검증이 애매해진다). null이면 정하지 않은 상태(코스피200 100%)로 되돌린다
  if (patch.mix !== undefined) {
    if (patch.mix === null) next.mix = null;
    else {
      const mix = normalizeMix(patch.mix);
      if (!mix.ok) return { ok: false, error: mix.error };
      next.mix = mix.value;
    }
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
    // 구성은 정했을 때만 쓴다 — 안 정한 계정에 기본값을 적어 두면 "정함"과 구별되지 않는다
    invest_plan: { payday: plan.payday, tolerancePct: plan.tolerancePct, ...(plan.mix ? { mix: plan.mix } : {}) },
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
