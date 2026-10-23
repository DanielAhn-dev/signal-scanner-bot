/**
 * 실계좌 예수금 — 포트폴리오 계좌 화면에서 보고 고친다(2026-10-21 사용자: 예수금은 그 계좌에 든 돈이라 포트폴리오에 있어야 한다).
 * 값은 리밸런싱 가이드 파일의 settings.cashByAccount 그대로다. 매수·매도·분배금 기록이 그 값을 자동으로 더하고 빼는 것도 그대로
 * (incomeGuide.ts applyTradeToCash·applyReceiptToCash·applyCashDeposit). 가이드는 읽기만 한다.
 *
 * cashChecks: 사용자가 증권사 앱의 실제 잔액을 마지막으로 적은 값과 날짜. 지금 값과의 차이 = 그 뒤 기록으로 자동 반영된 몫.
 * 앱 값과 실제 잔액이 어긋날 때 "적은 뒤 무엇이 더해지고 빠졌나"를 보여 준다. 소액 이자·이벤트 적립은 앱이 모르니 가끔 다시 적는다.
 */
import type { IncomeGuideSettings } from "./incomeGuide";

export type CashCheck = { amount: number; at: string };
export type CashChecks = Record<string, CashCheck>;
export type CashActivityEntry = {
  kind: "deposit" | "correction";
  delta: number;
  before: number;
  after: number;
  at: string;
};
export type CashActivity = Record<string, CashActivityEntry[]>;

export type AccountCashRow = {
  /** 가이드 계좌 키 "증권사|계좌" */
  key: string;
  amount: number;
  checkedAt: string | null;
  /** 마지막으로 적은 뒤 기록(매매·분배금·입금)으로 바뀐 몫. 적은 적 없으면 null */
  sinceCheck: number | null;
  activity: CashActivityEntry[];
};

const MAX_WON = 1e9;
const MAX_ACTIVITY = 100;
const isKey = (k: string) => k.includes("|") && k.length <= 120;

export function sanitizeCashChecks(raw: unknown): CashChecks {
  if (!raw || typeof raw !== "object") return {};
  const out: CashChecks = {};
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isKey(key) || !v || typeof v !== "object") continue;
    const amount = Number((v as CashCheck).amount);
    const at = String((v as CashCheck).at ?? "");
    if (!Number.isFinite(amount) || amount < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(at)) continue;
    out[key] = { amount: Math.min(MAX_WON, Math.round(amount)), at };
  }
  return out;
}

export function sanitizeCashActivity(raw: unknown): CashActivity {
  if (!raw || typeof raw !== "object") return {};
  const out: CashActivity = {};
  for (const [key, entries] of Object.entries(raw as Record<string, unknown>)) {
    if (!isKey(key) || !Array.isArray(entries)) continue;
    const valid = entries.flatMap((entry): CashActivityEntry[] => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as Partial<CashActivityEntry>;
      const before = Number(item.before);
      const after = Number(item.after);
      const delta = Number(item.delta);
      const at = String(item.at ?? "");
      if (
        (item.kind !== "deposit" && item.kind !== "correction") ||
        !Number.isFinite(before) || !Number.isFinite(after) || !Number.isFinite(delta) ||
        before < 0 || before > MAX_WON || after < 0 || after > MAX_WON ||
        Math.round(after - before) !== Math.round(delta) ||
        (item.kind === "deposit" && delta <= 0) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(at)
      ) return [];
      return [{ kind: item.kind, before: Math.round(before), after: Math.round(after), delta: Math.round(delta), at }];
    });
    if (valid.length) out[key] = valid.slice(-MAX_ACTIVITY);
  }
  return out;
}

function appendActivity(activity: CashActivity, key: string, entry: CashActivityEntry): CashActivity {
  return { ...activity, [key]: [...(activity[key] ?? []), entry].slice(-MAX_ACTIVITY) };
}

/**
 * 한 계좌 예수금을 실제 잔액으로 맞춘다. 0이면 칸을 비운다(cashByAccount는 0 이하를 두지 않는 규칙).
 * cashUpdatedAt도 오늘로 — 이날 이전 체결 기록은 이미 이 잔액에 들어 있다고 본다(applyTradeToCash).
 */
export function setAccountCash(
  settings: IncomeGuideSettings,
  checks: CashChecks,
  key: string,
  amount: number,
  today: string,
  activity: CashActivity = {},
): { settings: IncomeGuideSettings; checks: CashChecks; activity: CashActivity } | null {
  if (!isKey(key) || !Number.isFinite(amount) || amount < 0 || amount > MAX_WON) return null;
  const won = Math.min(MAX_WON, Math.round(amount));
  const before = Math.max(0, Math.round(settings.cashByAccount?.[key] ?? 0));
  const cashByAccount = { ...(settings.cashByAccount ?? {}) };
  if (won > 0) cashByAccount[key] = won;
  else delete cashByAccount[key];
  const { cashByAccount: _drop, ...rest } = settings;
  const nextActivity = won === before
    ? activity
    : appendActivity(activity, key, { kind: "correction", before, after: won, delta: won - before, at: today });
  return {
    settings: { ...rest, ...(Object.keys(cashByAccount).length ? { cashByAccount } : {}), cashUpdatedAt: today },
    checks: { ...checks, [key]: { amount: won, at: today } },
    activity: nextActivity,
  };
}

/** 선택한 계좌에 입금액을 더하고 별도 이력으로 남긴다. */
export function addAccountCash(
  settings: IncomeGuideSettings,
  activity: CashActivity,
  key: string,
  amount: number,
  today: string,
): { settings: IncomeGuideSettings; activity: CashActivity } | null {
  if (!isKey(key) || !Number.isFinite(amount) || amount <= 0) return null;
  const delta = Math.round(amount);
  const before = Math.max(0, Math.round(settings.cashByAccount?.[key] ?? 0));
  const after = before + delta;
  if (delta <= 0 || after > MAX_WON) return null;
  const cashByAccount = { ...(settings.cashByAccount ?? {}), [key]: after };
  const { cashByAccount: _drop, ...rest } = settings;
  return {
    settings: { ...rest, cashByAccount },
    activity: appendActivity(activity, key, { kind: "deposit", before, after, delta, at: today }),
  };
}

/** 보유가 있는 계좌 + 예수금만 있는 계좌 */
export function accountCashRows(settings: IncomeGuideSettings, checks: CashChecks, accountKeys: string[], activity: CashActivity = {}): AccountCashRow[] {
  const keys = new Set([...accountKeys, ...Object.keys(settings.cashByAccount ?? {})]);
  return [...keys].map((key) => {
    const amount = Math.max(0, Math.round(settings.cashByAccount?.[key] ?? 0));
    const check = checks[key];
    return { key, amount, checkedAt: check?.at ?? null, sinceCheck: check ? amount - check.amount : null, activity: activity[key] ?? [] };
  });
}

/** 포트폴리오 계좌 키("증권사|||계좌") → 가이드 계좌 키("증권사|계좌") */
export function guideCashKey(brokerName: string | null | undefined, accountName: string | null | undefined): string {
  return `${String(brokerName ?? "").trim()}|${String(accountName ?? "").trim()}`;
}
