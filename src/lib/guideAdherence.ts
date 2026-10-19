/**
 * 가이드 따름 기록 — 리밸런싱 가이드가 그달 안내한 '새 돈 살 곳'과 '더 사지 말 것'을, 다음 기록의 보유 변화와 맞춰
 * 따름/다르게 함을 판정하고, 다르게 한 매수는 "같은 돈을 안내 상품에 넣었다면"과 지금 가치로 비교한다.
 *
 * 원칙 (2026-10-19 사용자 승인):
 *   - 양쪽을 같은 크기로 보여 준다 — 사용자 선택이 나았던 경우도 그대로 보인다.
 *   - 3개월 안 된 결정은 숫자 없이 '아직'(몇 달 차이는 시장 잡음).
 *   - 한 사람 몇 건으로 전략을 바꾸지 않는다 — 가설 H58(docs/hypothesis-ledger.md) 자료로 쌓는다.
 * 가격은 기록할 때 같이 저장한 값(entry.prices)만 쓴다. 매수일은 두 기록 사이 어딘가라 뒤 기록 날 가격으로 근사한다.
 * 분배금은 받은 기록(receipts)이 있는 종목만 더한다(세후 비율 0.846 가정, 세후를 적었으면 그 비율).
 * DB·API 없이 계산만 한다.
 */
import { BUCKET_GROUP, classifyHolding, type BucketGroup, type GuideHistoryEntry } from "./incomeGuide";
import type { DistributionReceipt } from "./distributionReceipts";

/** 그달 가이드가 안내한 것 — 기록(GuideHistoryEntry.advice)에 같이 남긴다 */
export type GuideAdvice = {
  /** 새 돈·분배금을 넣을 곳 (계좌별 살 곳 모두. 앞이 전체 기준) */
  buy: Array<{ code: string; name: string }>;
  /** 더 사지 말라고 한 바구니 */
  noBuyGroups: BucketGroup[];
};

/** 이보다 짧으면 숫자 없이 '아직' */
export const ADHERENCE_MATURE_MONTHS = 3;
const NET_RATIO = 0.846;

export type AdherenceRow = {
  /** 고정 키 — 사용자가 판정에서 뺄 때 쓴다 */
  key: string;
  /** 판정한 기간 (앞 기록 → 뒤 기록) */
  from: string;
  to: string;
  code: string;
  name: string;
  shares: number;
  /** 산 금액 (뒤 기록 날 가격 근사) */
  amount: number;
  status: "followed" | "deviated";
  /** 다르게 한 경우 안내 상품 */
  advised: { code: string; name: string } | null;
  /** 지금 가치 — 3개월이 안 됐거나 가격이 없으면 null */
  actualNow: number | null;
  advisedNow: number | null;
  /** actualNow − advisedNow (+면 내 선택 우세) */
  diff: number | null;
  mature: boolean;
  excluded: boolean;
  /** 왜 '다르게 함'인지 */
  reason: string;
};

export type AdherenceSummary = {
  rows: AdherenceRow[];
  followed: number;
  deviated: number;
  early: number;
  /** 3개월 지난 '다르게 함'의 차이 합 (뺀 것 제외) */
  matureDiff: number;
  matureCount: number;
  /** 판정 기록이 시작된 날 (안내가 저장된 첫 기록) */
  since: string | null;
};

/** 가이드 계획에서 안내 스냅샷 — 현금 목표를 채우는 중이면 아무것도 사지 않는 게 안내다 */
export function adviceFromPlan(
  plan: {
    buyTarget: { code: string; name: string } | null;
    buyTargetsByAccount?: Array<{ target: { code: string; name: string } }>;
    cash?: { state: string } | null;
  } | null,
  view: { groups: Array<{ group: BucketGroup; actualPct: number }>; settings: { satelliteCapPct: number } },
): GuideAdvice | null {
  if (!plan) return null;
  if (plan.cash?.state === "filling") return { buy: [], noBuyGroups: ["growth", "income", "satellite"] };
  const buy: GuideAdvice["buy"] = [];
  for (const t of [plan.buyTarget, ...(plan.buyTargetsByAccount ?? []).map((a) => a.target)]) {
    if (t && !buy.some((b) => b.code === t.code)) buy.push({ code: t.code, name: t.name });
  }
  const sat = view.groups.find((g) => g.group === "satellite")?.actualPct ?? 0;
  const noBuyGroups: BucketGroup[] = ["income", ...(sat > view.settings.satelliteCapPct ? (["satellite"] as BucketGroup[]) : [])];
  return { buy, noBuyGroups };
}

const monthsBetween = (a: string, b: string) => {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am) + ((bd ?? 1) - (ad ?? 1)) / 30;
};

/** code 종목을 shares주 들고 있었을 때 month(YYYY-MM) 초과 달에 받은 분배금 (세후 추정) */
function receivedSince(receipts: DistributionReceipt[], code: string, shares: number, afterMonth: string): number {
  let s = 0;
  for (const r of receipts) {
    if (r.code !== code || r.month <= afterMonth || !(r.perShare > 0)) continue;
    const gross = r.perShare * r.quantity;
    const ratio = r.net != null && gross > 0 ? r.net / gross : NET_RATIO;
    s += r.perShare * shares * ratio;
  }
  return s;
}

export function buildAdherence(input: {
  history: GuideHistoryEntry[];
  today: string;
  priceOf: (code: string) => number | null | undefined;
  receipts?: DistributionReceipt[];
  excluded?: string[];
}): AdherenceSummary {
  const history = [...input.history].sort((a, b) => a.date.localeCompare(b.date));
  const excluded = new Set(input.excluded ?? []);
  const receipts = input.receipts ?? [];
  const rows: AdherenceRow[] = [];
  let since: string | null = null;
  for (let i = 0; i < history.length - 1; i++) {
    const a = history[i];
    const b = history[i + 1];
    if (!a.advice || !a.holdings || !b.holdings) continue;
    since ??= a.date;
    const qa = new Map(a.holdings.map((h) => [h.code, h.quantity]));
    const buyCodes = new Set(a.advice.buy.map((x) => x.code));
    const advised = a.advice.buy[0] ?? null;
    for (const h of b.holdings) {
      const delta = h.quantity - (qa.get(h.code) ?? 0);
      if (!(delta > 0)) continue;
      const group = BUCKET_GROUP[classifyHolding(h.code, h.name)];
      if (group === "cash") continue; // 현금성 ETF는 판정하지 않는다
      const price = b.prices?.[h.code] ?? null;
      const amount = price ? Math.round(delta * price) : 0;
      const key = `${b.date}|${h.code}`;
      const base = { key, from: a.date, to: b.date, code: h.code, name: h.name, shares: delta, amount, excluded: excluded.has(key) };
      if (buyCodes.has(h.code)) {
        rows.push({ ...base, status: "followed", advised: null, actualNow: null, advisedNow: null, diff: null, mature: monthsBetween(b.date, input.today) >= ADHERENCE_MATURE_MONTHS, reason: "안내한 곳에 넣음" });
        continue;
      }
      const offGroup = a.advice.noBuyGroups.includes(group);
      const otherGrowth = group === "growth" && a.advice.buy.length > 0;
      if (!offGroup && !otherGrowth) continue;
      const reason = offGroup
        ? a.advice.buy.length === 0
          ? "현금 목표를 채우는 중이라 사지 않기로 한 달"
          : group === "income"
            ? "인컴 ETF는 더 사지 않기로 한 달"
            : "위성(개별주·테마)이 상한을 넘어 더 사지 않기로 한 달"
        : `새 돈은 ${advised!.name} 한 곳으로 안내한 달`;
      const mature = monthsBetween(b.date, input.today) >= ADHERENCE_MATURE_MONTHS;
      let actualNow: number | null = null;
      let advisedNow: number | null = null;
      if (mature && price) {
        const nowPrice = Number(input.priceOf(h.code));
        if (nowPrice > 0) actualNow = Math.round(delta * nowPrice + receivedSince(receipts, h.code, delta, b.date.slice(0, 7)));
        if (advised) {
          const advPriceThen = b.prices?.[advised.code] ?? null;
          const advNow = Number(input.priceOf(advised.code));
          if (advPriceThen && advNow > 0) {
            const shares = amount / advPriceThen;
            advisedNow = Math.round(shares * advNow + receivedSince(receipts, advised.code, shares, b.date.slice(0, 7)));
          }
        } else {
          // 사지 않기로 한 달 — 안내대로였다면 그 돈은 현금으로 남아 있다 (이자는 넣지 않는다)
          advisedNow = amount;
        }
      }
      rows.push({
        ...base,
        status: "deviated",
        advised: advised ? { code: advised.code, name: advised.name } : null,
        actualNow,
        advisedNow,
        diff: actualNow != null && advisedNow != null ? actualNow - advisedNow : null,
        mature,
        reason,
      });
    }
  }
  const counted = rows.filter((r) => !r.excluded);
  const matureDev = counted.filter((r) => r.status === "deviated" && r.diff != null);
  return {
    rows: rows.sort((x, y) => y.to.localeCompare(x.to) || x.code.localeCompare(y.code)),
    followed: counted.filter((r) => r.status === "followed").length,
    deviated: counted.filter((r) => r.status === "deviated").length,
    early: counted.filter((r) => !r.mature).length,
    matureDiff: matureDev.reduce((s, r) => s + r.diff!, 0),
    matureCount: matureDev.length,
    since,
  };
}
