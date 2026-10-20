/**
 * 리밸런싱 가이드 계좌별 보기 — 고른 계좌 하나만으로 비중·할 일·주문안을 계산한다.
 * 2026-10-20 사용자: 가족 계좌·개인 계좌를 합쳐서 보면 어느 계좌에서 무엇을 할지 정하기 어렵다 → 계좌마다 따로 정리한다.
 * 목표(인컴·현금성·위성 상한·해외 비중·월 목표 인컴 등)는 기본이 공통 설정이고, 계좌마다 통째로 덮어쓸 수 있다.
 * 매달 넣는 돈과 점검 기록도 계좌마다 따로 둔다. 예전 기록(합산)은 GuideFile.history에 그대로 남는다.
 */
import { sanitizeIncomeGuideSettings, type GuideHistoryEntry, type IncomeGuideSettings } from "./incomeGuide";

/** 계좌마다 따로 정할 수 있는 목표 칸 */
export const ACCOUNT_TARGET_KEYS = [
  "monthlyNeed",
  "incomeStart",
  "satelliteCapPct",
  "overseasPct",
  "customTargets",
  "financialIncomeCap",
  "ageBand",
] as const;

export type AccountTargets = Partial<Pick<IncomeGuideSettings, (typeof ACCOUNT_TARGET_KEYS)[number]>>;

/** 계좌 종류 — 이름만으로는 ISA·연금저축 등을 확실히 가를 수 없어 사용자가 고른다 */
export const ACCOUNT_KINDS = ["general", "cma", "isa", "irp", "pension"] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];
export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = { general: "일반", cma: "CMA", isa: "ISA", irp: "IRP", pension: "연금저축" };

/** 고르지 않았을 때 이름으로 추정 */
export function guessAccountKind(label: string): AccountKind {
  const s = String(label ?? "");
  if (/ISA/i.test(s)) return "isa";
  if (/IRP|퇴직/i.test(s)) return "irp";
  if (/연금/.test(s)) return "pension";
  if (/CMA/i.test(s)) return "cma";
  return "general";
}

export const isShelteredKind = (k: AccountKind) => k === "isa" || k === "irp" || k === "pension";

/**
 * 고른 종류가 이름에 드러나지 않으면 표시 이름 뒤에 붙인다 — 절세 판정(isTaxAdvantagedAccount)이 이름을 보기 때문에,
 * 이렇게 하면 세금 배치·분배금 과세 계산이 모두 고른 종류를 따른다.
 * 일반·CMA로 골랐는데 이름에 ISA·연금이 들어 있으면 '(일반)'만 붙이고 절세 판정은 kindOverride로 끈다.
 */
export function labelWithKind(label: string, kind: AccountKind | undefined): string {
  if (!kind || guessAccountKind(label) === kind) return label;
  return `${label} (${ACCOUNT_KIND_LABEL[kind]})`;
}

export type AccountGuideEntry = {
  /** 계좌 종류 — 없으면 이름으로 추정 */
  kind?: AccountKind;
  /** 있으면 공통 설정 대신 이 계좌 목표 (없으면 공통) */
  targets?: AccountTargets;
  /** 이 계좌에 매달 넣는 돈(원) */
  monthlyContribution?: number;
  /** 이 계좌만의 점검 기록 */
  history?: GuideHistoryEntry[];
};

export type AccountGuideMap = Record<string, AccountGuideEntry>;

/** 전체 합산 보기를 고를 때 쓰는 키 */
export const ALL_ACCOUNTS_KEY = "__all";

const validKey = (key: string) => key.includes("|") && key.length <= 120;

/** 저장 파일에서 읽은 값을 정리 — 모르는 모양은 버린다 */
export function sanitizeAccountGuideMap(input: unknown, base: IncomeGuideSettings): AccountGuideMap {
  if (!input || typeof input !== "object") return {};
  const out: AccountGuideMap = {};
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!validKey(key) || !raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const entry: AccountGuideEntry = {};
    if (r.targets && typeof r.targets === "object") entry.targets = sanitizeAccountTargets(r.targets as Record<string, unknown>, base);
    if (ACCOUNT_KINDS.includes(r.kind as AccountKind)) entry.kind = r.kind as AccountKind;
    const mc = Number(r.monthlyContribution);
    if (Number.isFinite(mc) && mc > 0) entry.monthlyContribution = Math.min(1e9, Math.round(mc));
    if (Array.isArray(r.history)) entry.history = r.history as GuideHistoryEntry[];
    if (Object.keys(entry).length) out[key] = entry;
  }
  return out;
}

/**
 * 계좌 목표 저장값 — 공통 설정을 시작점으로 같은 검사(sanitizeIncomeGuideSettings)를 거친 뒤 목표 칸만 남긴다.
 * 통째로 저장해 두어야 나중에 공통 설정을 고쳐도 이 계좌 목표가 섞여 바뀌지 않는다.
 */
export function sanitizeAccountTargets(input: Record<string, unknown>, start: IncomeGuideSettings): AccountTargets {
  const merged = sanitizeIncomeGuideSettings(input as Partial<IncomeGuideSettings>, start);
  const out: AccountTargets = {};
  for (const k of ACCOUNT_TARGET_KEYS) {
    const v = merged[k];
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/**
 * 이 계좌에 매달 넣는 돈 — 계좌에 적은 값이 있으면 그것.
 * 아무 계좌에도 적지 않았으면 예전 공통 값을 가장 큰 계좌에만 붙인다(리포트가 쓰던 규칙).
 */
export function accountMonthlyContribution(
  settings: Pick<IncomeGuideSettings, "monthlyContribution">,
  accounts: AccountGuideMap,
  accountKey: string,
  largestKey: string | null,
): { amount: number; source: "account" | "common" | "none" } {
  const own = accounts[accountKey]?.monthlyContribution;
  if (own != null && own > 0) return { amount: own, source: "account" };
  const anyOwn = Object.values(accounts).some((a) => (a.monthlyContribution ?? 0) > 0);
  if (!anyOwn && largestKey === accountKey && (settings.monthlyContribution ?? 0) > 0) {
    return { amount: settings.monthlyContribution!, source: "common" };
  }
  return { amount: 0, source: "none" };
}

/**
 * 계좌 하나로 계산할 설정 — 공통 설정 + 이 계좌 목표, 예수금은 이 계좌 것만(계좌 미지정 예전 값은 뺀다),
 * 매달 넣는 돈은 accountMonthlyContribution.
 */
export function scopeSettingsToAccount(
  settings: IncomeGuideSettings,
  accounts: AccountGuideMap,
  accountKey: string,
  largestKey: string | null,
): IncomeGuideSettings {
  const entry = accounts[accountKey];
  const { cashBalance: _legacy, cashByAccount, monthlyContribution: _mc, ...rest } = settings;
  const cash = cashByAccount?.[accountKey];
  const contribution = accountMonthlyContribution(settings, accounts, accountKey, largestKey).amount;
  return {
    ...rest,
    ...(entry?.targets ?? {}),
    ...(cash != null && cash > 0 ? { cashByAccount: { [accountKey]: cash } } : {}),
    ...(contribution > 0 ? { monthlyContribution: contribution } : {}),
  };
}

export type GuideAccountOption = {
  key: string;
  label: string;
  total: number;
  holdingCount: number;
  ownTargets: boolean;
  kind: AccountKind;
  /** 사용자가 고른 종류인지(아니면 이름으로 추정) */
  kindChosen: boolean;
};

/** 보유 행의 계좌 이름에 고른 종류를 반영 (labelWithKind) — toGuideHoldings 바로 뒤에 부른다 */
export function applyAccountKinds<T extends { accountKey: string; accountLabel: string }>(holdings: T[], accounts: AccountGuideMap): T[] {
  return holdings.map((h) => {
    const kind = accounts[h.accountKey]?.kind;
    return kind ? { ...h, accountLabel: labelWithKind(h.accountLabel, kind) } : h;
  });
}

/** 계좌 목록 — 평가금 큰 순. 가이드 계좌 고르기·가장 큰 계좌 판단에 쓴다 */
export function listGuideAccounts(
  holdings: Array<{ accountKey: string; accountLabel: string; quantity: number; price: number }>,
  accounts: AccountGuideMap,
  cashByAccount?: Record<string, number>,
): GuideAccountOption[] {
  const map = new Map<string, GuideAccountOption>();
  for (const h of holdings) {
    const e = accounts[h.accountKey];
    const a = map.get(h.accountKey) ?? {
      key: h.accountKey,
      label: h.accountLabel,
      total: 0,
      holdingCount: 0,
      ownTargets: !!e?.targets,
      kind: e?.kind ?? guessAccountKind(h.accountLabel),
      kindChosen: !!e?.kind,
    };
    a.total += h.quantity * h.price;
    a.holdingCount += 1;
    map.set(h.accountKey, a);
  }
  for (const a of map.values()) a.total = Math.round(a.total + Math.max(0, cashByAccount?.[a.key] ?? 0));
  return [...map.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

/** 요청한 계좌 키 → 실제로 볼 계좌. 전체(__all)면 null, 없거나 모르는 키면 가장 큰 계좌 */
export function resolveGuideAccount(requested: string, list: Array<{ key: string }>): string | null {
  if (requested === ALL_ACCOUNTS_KEY) return null;
  if (list.some((a) => a.key === requested)) return requested;
  return list[0]?.key ?? null;
}
