/**
 * 가상 계좌 월 자동 입금 — 실제로 따라 하는 사람의 자동이체를 그대로 흉내 낸다.
 *
 * - 금액·입금일은 사용자가 정한다 (고정 기본값 없음, 0이면 적립 안 함).
 * - 입금일(1~28)이 지난 뒤 그 달 첫 자동매매 실행 때 한 번 입금한다 (주말·휴일이면 다음 거래일).
 * - 입금은 가상 현금과 시드에 같이 더한다 → 포지션 크기가 커지고, 목표 트래커는 시드가 "이전 시드 + 확정손익"과
 *   다르게 바뀐 날을 입출금으로 보고 수익률에서 뺀다 (goalTracker.isCapitalFlow) — 입금이 수익으로 잡히지 않는다.
 * - 처음 설정한 달에 입금일이 이미 지났으면 다음 달부터 (설정하자마자 돈이 불어나지 않게).
 */

/** manual: 월 자동 입금이 아니라 사용자가 직접 넣은 입금 */
export type DepositRecord = { date: string; amount: number; cashAfter: number; manual?: true };

export const MAX_DEPOSIT_DAY = 28;
export const MIN_MONTHLY_DEPOSIT = 10_000;
/** prefs에 남기는 입금 내역 개수 (20년치) */
const DEPOSIT_LOG_LIMIT = 240;

export type DepositSettings = {
  monthlyDeposit: number;
  depositDay: number;
  /** 마지막으로 입금(또는 건너뛰기로 처리)한 달 YYYY-MM */
  lastDepositMonth: string | null;
};

export function normalizeDepositDay(raw: unknown): number {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) && n >= 1 ? Math.min(MAX_DEPOSIT_DAY, n) : 1;
}

/** 0(적립 안 함) 또는 1만원 이상 정수, 아니면 null */
export function normalizeMonthlyDeposit(raw: unknown): number | null {
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n) || n < 0) return null;
  if (n === 0) return 0;
  return n >= MIN_MONTHLY_DEPOSIT && n <= 1_000_000_000 ? n : null;
}

export function readDepositSettings(prefs: Record<string, unknown>): DepositSettings {
  const amount = Number(prefs.virtual_monthly_deposit);
  return {
    monthlyDeposit: Number.isFinite(amount) && amount > 0 ? Math.trunc(amount) : 0,
    depositDay: normalizeDepositDay(prefs.virtual_deposit_day),
    lastDepositMonth: typeof prefs.virtual_last_deposit_month === "string" ? prefs.virtual_last_deposit_month : null,
  };
}

/** 오늘(KST YYYY-MM-DD) 입금할 차례인지 */
export function isDepositDue(settings: DepositSettings, todayKey: string): boolean {
  if (settings.monthlyDeposit <= 0) return false;
  const month = todayKey.slice(0, 7);
  if (settings.lastDepositMonth != null && settings.lastDepositMonth >= month) return false;
  return Number(todayKey.slice(8, 10)) >= settings.depositDay;
}

/**
 * 금액·입금일을 새로 저장할 때의 "마지막 입금 달" — 이번 달 입금일이 이미 지났으면 이번 달은 처리한 것으로 둔다.
 * 이미 이번 달에 입금했다면 그대로 둔다 (금액을 바꿔도 같은 달에 두 번 들어가지 않게).
 */
export function resolveLastDepositMonthOnSave(input: {
  depositDay: number;
  previousLastDepositMonth: string | null;
  todayKey: string;
}): string | null {
  const month = input.todayKey.slice(0, 7);
  if (input.previousLastDepositMonth != null && input.previousLastDepositMonth >= month) return input.previousLastDepositMonth;
  return Number(input.todayKey.slice(8, 10)) >= input.depositDay ? month : input.previousLastDepositMonth;
}

/** 다음 입금 예정일 (입금일 기준, 거래일 보정 없음). 적립 안 하면 null */
export function nextDepositDate(settings: DepositSettings, todayKey: string): string | null {
  if (settings.monthlyDeposit <= 0) return null;
  const [y, m] = todayKey.split("-").map(Number);
  const dd = String(settings.depositDay).padStart(2, "0");
  const thisMonth = `${todayKey.slice(0, 7)}-${dd}`;
  const doneThisMonth = settings.lastDepositMonth != null && settings.lastDepositMonth >= todayKey.slice(0, 7);
  if (!doneThisMonth) return thisMonth < todayKey ? todayKey : thisMonth;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-${dd}`;
}

export function readDepositLog(prefs: Record<string, unknown>): DepositRecord[] {
  const raw = prefs.virtual_deposit_log;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => r as Partial<DepositRecord>)
    .filter((r): r is DepositRecord => typeof r?.date === "string" && Number.isFinite(Number(r.amount)))
    .map((r) => ({ date: r.date, amount: Number(r.amount), cashAfter: Number(r.cashAfter) || 0, ...(r.manual ? { manual: true as const } : {}) }));
}

/** 직접 입금 한 번의 금액: 1만원 이상 정수 (월 자동 입금과 같은 범위, 0은 불가) */
export function normalizeManualDeposit(raw: unknown): number | null {
  const n = normalizeMonthlyDeposit(raw);
  return n != null && n > 0 ? n : null;
}

function depositPatch(input: { prefs: Record<string, unknown>; amount: number; todayKey: string; manual: boolean }): Record<string, unknown> {
  const cash = Math.max(0, Number(input.prefs.virtual_cash) || 0);
  const seed = Math.max(0, Number(input.prefs.virtual_seed_capital) || 0);
  const totalDeposited = Number(input.prefs.virtual_total_deposited);
  const cashBaseline = Number(input.prefs.virtual_cash_baseline);
  const cashAfter = Math.round(cash + input.amount);
  const record: DepositRecord = { date: input.todayKey, amount: input.amount, cashAfter, ...(input.manual ? { manual: true as const } : {}) };
  const log = [...readDepositLog(input.prefs), record];
  return {
    virtual_cash: cashAfter,
    virtual_seed_capital: Math.round(seed + input.amount),
    // 예전 계정은 총 원금 기록이 없다 — 지금 시드를 시작 원금으로 본다
    virtual_total_deposited: Math.round((Number.isFinite(totalDeposited) && totalDeposited > 0 ? totalDeposited : seed) + input.amount),
    // 원장 검산 기준선도 입금만큼 같이 올린다 (시드 재계산과 달리 이건 실제 현금 유입이라 기준선을 옮겨도 된다)
    virtual_cash_baseline: Math.round((Number.isFinite(cashBaseline) && cashBaseline > 0 ? cashBaseline : seed) + input.amount),
    virtual_deposit_log: log.slice(-DEPOSIT_LOG_LIMIT),
  };
}

/** 월 자동 입금 반영 후 prefs에 쓸 값 — 그 달 입금을 처리한 것으로 표시한다 */
export function applyDeposit(input: {
  prefs: Record<string, unknown>;
  amount: number;
  todayKey: string;
}): Record<string, unknown> {
  return { ...depositPatch({ ...input, manual: false }), virtual_last_deposit_month: input.todayKey.slice(0, 7) };
}

/** 직접 입금 반영 후 prefs에 쓸 값 — "마지막 입금 달"은 건드리지 않는다 (건드리면 이번 달 자동 입금이 건너뛰어진다) */
export function applyManualDeposit(input: {
  prefs: Record<string, unknown>;
  amount: number;
  todayKey: string;
}): Record<string, unknown> {
  return depositPatch({ ...input, manual: true });
}
