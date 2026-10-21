/**
 * 리밸런싱 가이드 계획 + 그달 안내 스냅샷 — 가이드 화면(handlers/ui/income-guide.ts)과 월 자동 기록 배치(scripts/income_guide_monthly.ts)가
 * 같은 계산으로 기록을 남겨야 가이드 따름 판정(src/lib/guideAdherence.ts)이 어느 쪽 기록이든 같은 안내를 기준으로 한다.
 */
import { isTaxAdvantagedAccount, resolveYieldPct, type GuideHistoryEntry, type IncomeGuideView, type YieldPctByCode } from "../lib/incomeGuide";
import { buildRebalancePlan, type RebalancePlan } from "../lib/rebalancePlan";
import { projectNextMonth, type DistributionReceipt } from "../lib/distributionReceipts";
import { adviceFromPlan, type GuideAdvice } from "../lib/guideAdherence";
import { loadIndexAlternatives } from "./indexAlternatives";
import { fetchGuidePrices, type GuideFile } from "./incomeGuideStore";

export async function buildGuidePlanSnapshot(input: {
  supabase: any;
  file: GuideFile;
  view: IncomeGuideView;
  yieldPctByCode: YieldPctByCode | null;
  today: string;
  /** 이미 받은 시세 (없는 종목만 더 받는다) */
  prices: Map<string, number>;
  /** 같은 지수 상품 비교가 이보다 오래 걸리면 비교 없이 (화면용). 없으면 끝까지 기다린다 */
  alternativesTimeoutMs?: number;
}): Promise<{
  plan: RebalancePlan | null;
  projection: ReturnType<typeof projectNextMonth>;
  advice: GuideAdvice | null;
  /** 기록에 같이 남길 가격 — 보유·이번 안내 상품·지난 기록의 안내 상품 */
  entryPrices: Record<string, number>;
}> {
  const { supabase, file, view, yieldPctByCode, today } = input;
  const receipts: DistributionReceipt[] = file.receipts ?? [];
  const estimateMonthlyNet = (code: string) =>
    view.holdings
      .filter((h) => h.code === code)
      .reduce((s, h) => s + (h.value * resolveYieldPct(h.code, h.bucket, h.name, yieldPctByCode).pct) / 100 / 12 * (isTaxAdvantagedAccount(h.accountLabel) ? 1 : 0.846), 0);
  const projection = projectNextMonth({ receipts, holdings: view.holdings, estimateMonthlyNet, today });
  // 받은 기록이 하나라도 있으면 월 인컴은 기록 기반 예상을 쓴다
  const planSettings = { ...file.settings, actualMonthlyNet: projection.receiptCodes > 0 ? projection.total : undefined };
  const growth = view.holdings.filter((h) => h.group === "growth").map((h) => ({ code: h.code, name: h.name }));
  const altPromise = loadIndexAlternatives(supabase, growth);
  const indexAlt = input.alternativesTimeoutMs
    ? await Promise.race([altPromise, new Promise<null>((resolve) => setTimeout(() => resolve(null), input.alternativesTimeoutMs))])
    : await altPromise;
  const plan = buildRebalancePlan({
    holdings: view.holdings,
    total: view.total,
    groups: view.groups,
    settings: planSettings,
    cashPlan: view.cashPlan,
    holdFinalTargets: view.holdFinalTargets,
    yieldPctByCode,
    today,
    etf: indexAlt?.etf,
    feeAlternatives: indexAlt?.alternatives,
  });
  const advice = adviceFromPlan(plan, view);

  // 가격: 보유 + 이번 안내 + 지난 기록의 안내(다음 판정에서 '안내대로였다면'을 이 날 가격으로 계산)
  const lastAdvice = [...(file.history ?? [])].reverse().find((h: GuideHistoryEntry) => h.advice)?.advice;
  const codes = new Set<string>([
    ...view.holdings.filter((h) => h.code !== "CASH").map((h) => h.code),
    ...(advice?.buy ?? []).map((b) => b.code),
    ...(lastAdvice?.buy ?? []).map((b) => b.code),
  ]);
  const altPrice = new Map((indexAlt?.alternatives ?? []).map((a) => [a.code, a.price]));
  const missing = [...codes].filter((c) => !(Number(input.prices.get(c)) > 0) && !(Number(altPrice.get(c)) > 0));
  const extra = missing.length ? (await fetchGuidePrices(supabase, missing).catch(() => null))?.prices : null;
  const entryPrices: Record<string, number> = {};
  for (const c of codes) {
    const p = Number(input.prices.get(c)) || Number(altPrice.get(c)) || Number(extra?.get(c)) || 0;
    if (p > 0) entryPrices[c] = p;
  }
  return { plan, projection, advice, entryPrices };
}
