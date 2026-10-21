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

export type AccountCashRow = {
  /** 가이드 계좌 키 "증권사|계좌" */
  key: string;
  amount: number;
  checkedAt: string | null;
  /** 마지막으로 적은 뒤 기록(매매·분배금·입금)으로 바뀐 몫. 적은 적 없으면 null */
  sinceCheck: number | null;
};

const MAX_WON = 1e9;
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
): { settings: IncomeGuideSettings; checks: CashChecks } | null {
  if (!isKey(key) || !Number.isFinite(amount) || amount < 0) return null;
  const won = Math.min(MAX_WON, Math.round(amount));
  const cashByAccount = { ...(settings.cashByAccount ?? {}) };
  if (won > 0) cashByAccount[key] = won;
  else delete cashByAccount[key];
  const { cashByAccount: _drop, ...rest } = settings;
  return {
    settings: { ...rest, ...(Object.keys(cashByAccount).length ? { cashByAccount } : {}), cashUpdatedAt: today },
    checks: { ...checks, [key]: { amount: won, at: today } },
  };
}

/** 보유가 있는 계좌 + 예수금만 있는 계좌 */
export function accountCashRows(settings: IncomeGuideSettings, checks: CashChecks, accountKeys: string[]): AccountCashRow[] {
  const keys = new Set([...accountKeys, ...Object.keys(settings.cashByAccount ?? {})]);
  return [...keys].map((key) => {
    const amount = Math.max(0, Math.round(settings.cashByAccount?.[key] ?? 0));
    const check = checks[key];
    return { key, amount, checkedAt: check?.at ?? null, sinceCheck: check ? amount - check.amount : null };
  });
}

/** 포트폴리오 계좌 키("증권사|||계좌") → 가이드 계좌 키("증권사|계좌") */
export function guideCashKey(brokerName: string | null | undefined, accountName: string | null | undefined): string {
  return `${String(brokerName ?? "").trim()}|${String(accountName ?? "").trim()}`;
}
