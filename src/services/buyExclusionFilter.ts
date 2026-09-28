/**
 * 신규 매수 제외 기준 (자동매매 selectMondayCandidates와 같은 기준) — 리포트·장전플랜 공용.
 * 리포트가 권한 종목을 봇은 사지 않는 불일치를 막는다.
 *   - ETF·ETN (현금 스윕·지수 추적용, 개별주 전략 대상 아님)
 *   - 최근 5일 외국인+기관 강한 순매도 (investorFlowFilter, 백테스트 근거)
 *   - 최근 5일 악재 공시 (dartDisclosureFilter, DART_API_KEY 필요)
 *   - 실적 관문: 최근 4분기 적자·영업이익 감소 (fundamentalQualityGate, 생존편향 없는 검증 근거)
 */
import { isExchangeTradedProduct } from "../lib/securitiesTax";
import { fetchHeavyNetSellingCodes } from "./investorFlowFilter";
import { fetchNegativeDisclosureCodes } from "./dartDisclosureFilter";
import { fetchFundamentalGateResults, type FundamentalGateResult } from "./fundamentalQualityGate";

type SupabaseClientAny = any;

export type BuyExclusions = {
  /** 제외 대상 전체 */
  codes: Set<string>;
  /** 종목코드 → 사유 (표시용) */
  reasons: Map<string, string>;
};

export async function fetchBuyExclusions(
  supabase: SupabaseClientAny,
  items: Array<{ code: string; name?: string | null }>
): Promise<BuyExclusions> {
  const codes = [...new Set(items.map((item) => String(item.code).trim()).filter(Boolean))];
  const reasons = new Map<string, string>();
  if (!codes.length) return { codes: new Set(), reasons };
  const [heavyNetSelling, negativeDisclosures, fundamentalGate] = await Promise.all([
    fetchHeavyNetSellingCodes(supabase, codes).catch(() => new Map<string, number>()),
    fetchNegativeDisclosureCodes().catch(() => new Map<string, { label: string }>()),
    fetchFundamentalGateResults(supabase, codes).catch(() => new Map<string, FundamentalGateResult>()),
  ]);
  for (const item of items) {
    const code = String(item.code).trim();
    if (isExchangeTradedProduct(code, item.name)) reasons.set(code, "ETF·ETN");
    else if (negativeDisclosures.has(code)) reasons.set(code, `공시악재(${negativeDisclosures.get(code)?.label ?? "-"})`);
    else if (heavyNetSelling.has(code)) reasons.set(code, "수급이탈");
    else {
      const gate = fundamentalGate.get(code);
      if (gate?.status === "fail") reasons.set(code, `실적(${gate.reason})`);
    }
  }
  return { codes: new Set(reasons.keys()), reasons };
}
