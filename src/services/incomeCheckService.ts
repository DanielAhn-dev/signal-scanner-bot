/**
 * 가이드 '인컴 상품 점검' 자료 모으기 — 일반 계좌 인컴 보유 + 분배금 이력(etf_distributions) + 네이버 3개월 수익률.
 * 판정 규칙은 src/lib/incomeProductCheck.ts. 이력이나 시세를 못 읽어도 가이드를 막지 않고 빈 목록을 돌려준다.
 */
import { computeDistributionStats, pickYieldPct } from "../lib/distributionStats";
import { buildIncomeCheck, type IncomeCheckInput, type IncomeCheckRow } from "../lib/incomeProductCheck";
import { isTaxAdvantagedAccount, resolveYieldPct, type AssetBucket, type YieldPctByCode } from "../lib/incomeGuide";
import { strategyKey } from "../lib/rebalancePlan";
import { loadDistributionRows } from "./etfDistributionStore";
import { fetchEtfKeyIndicators } from "./etfKeyIndicator";

type CheckHolding = { code: string; name: string; price: number; value: number; group: string; bucket: AssetBucket; accountLabel: string };

export async function loadIncomeCheck(input: {
  supabase: any;
  holdings: CheckHolding[];
  yieldPctByCode: YieldPctByCode | null;
  today: string;
}): Promise<IncomeCheckRow[]> {
  const general = input.holdings.filter((h) => h.group === "income" && h.code !== "CASH" && !isTaxAdvantagedAccount(h.accountLabel));
  if (!general.length) return [];
  const byCode = new Map<string, CheckHolding>();
  for (const h of general) {
    const cur = byCode.get(h.code);
    byCode.set(h.code, cur ? { ...cur, value: cur.value + h.value } : { ...h });
  }
  const codes = [...byCode.keys()];
  try {
    const [rowsByCode, indicators] = await Promise.all([
      loadDistributionRows(input.supabase, codes),
      Promise.race([
        fetchEtfKeyIndicators(codes).catch(() => new Map()),
        new Promise<Map<string, any>>((resolve) => setTimeout(() => resolve(new Map()), 4_000)),
      ]),
    ]);
    const inputs: IncomeCheckInput[] = [...byCode.values()].map((h) => {
      const stats = computeDistributionStats(h.code, rowsByCode.get(h.code) ?? [], input.today);
      const naver = input.yieldPctByCode?.[h.code] ?? null;
      const resolved = resolveYieldPct(h.code, h.bucket, h.name, input.yieldPctByCode);
      const pick = pickYieldPct(stats, h.price, naver);
      return {
        code: h.code,
        name: h.name,
        value: h.value,
        price: h.price,
        family: strategyKey(h.name),
        yieldPct: resolved.pct,
        yieldSource: pick ? pick.source : resolved.source === "ttm" ? "naver" : "assumed",
        stats,
        price3mPct: (indicators.get(h.code) as { return3m?: number | null } | undefined)?.return3m ?? null,
      };
    });
    return buildIncomeCheck(inputs);
  } catch {
    return [];
  }
}
