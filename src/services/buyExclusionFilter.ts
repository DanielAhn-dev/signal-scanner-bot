/**
 * 신규 매수 제외 기준 (자동매매 selectMondayCandidates와 같은 기준) — 리포트·장전플랜 공용.
 * 리포트가 권한 종목을 봇은 사지 않는 불일치를 막는다.
 *   - ETF·ETN (현금 스윕·지수 추적용, 개별주 전략 대상 아님)
 *   - 최근 5일 외국인+기관 강한 순매도 (investorFlowFilter, 백테스트 근거)
 *   - 최근 5일 악재 공시 (dartDisclosureFilter, DART_API_KEY 필요)
 *   - 실적 관문: 최근 4분기 적자·영업이익 감소 (fundamentalQualityGate, 생존편향 없는 검증 근거)
 *   - 과열·고점 변동성 급등 (weightCautionSignal, 3개월 내 -20% 확률 52~63%·평소 34%)
 *   - 급등 추격(+8%·거래량 5배·고가 근처 마감 뒤 5거래일)·한 달 -15% 이하 급락 (chaseEntrySignal)
 *     리포트 후보는 유니버스(218종목) 안이라 전부 본다(동시 8개 조회). 자동매매는 매매 시간 때문에 점수 상위 80종목만 본다.
 */
import { isExchangeTradedProduct } from "../lib/securitiesTax";
import { fetchHeavyNetSellingCodes } from "./investorFlowFilter";
import { fetchNegativeDisclosureCodes } from "./dartDisclosureFilter";
import { fetchFundamentalGateResults, type FundamentalGateResult } from "./fundamentalQualityGate";
import { fetchWeightCautions, type WeightCautionResult } from "./weightCautionSignal";
import { entryGuardLabel, fetchChaseEntries, type ChaseEntryResult } from "./chaseEntrySignal";
import { toKstDateKey } from "../lib/krxCalendar";

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
  const [heavyNetSelling, negativeDisclosures, fundamentalGate, weightCautions, chaseEntries] = await Promise.all([
    fetchHeavyNetSellingCodes(supabase, codes).catch(() => new Map<string, number>()),
    fetchNegativeDisclosureCodes().catch(() => new Map<string, { label: string }>()),
    fetchFundamentalGateResults(supabase, codes).catch(() => new Map<string, FundamentalGateResult>()),
    fetchWeightCautions(supabase, codes).catch(() => new Map<string, WeightCautionResult>()),
    fetchChaseEntries(supabase, codes, toKstDateKey()).catch(() => new Map<string, ChaseEntryResult>()),
  ]);
  for (const item of items) {
    const code = String(item.code).trim();
    if (isExchangeTradedProduct(code, item.name)) reasons.set(code, "ETF·ETN");
    else if (negativeDisclosures.has(code)) reasons.set(code, `공시악재(${negativeDisclosures.get(code)?.label ?? "-"})`);
    else if (heavyNetSelling.has(code)) reasons.set(code, "수급이탈");
    else {
      const gate = fundamentalGate.get(code);
      if (gate?.status === "fail") reasons.set(code, `실적(${gate.reason})`);
      else if ((weightCautions.get(code)?.level ?? "none") !== "none") reasons.set(code, "과열·고점 변동성");
      else if (chaseEntries.has(code)) reasons.set(code, entryGuardLabel(chaseEntries.get(code)!.kind));
    }
  }
  return { codes: new Set(reasons.keys()), reasons };
}
