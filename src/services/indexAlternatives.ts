/**
 * 같은 지수 상품 비교 자료 — 보유 성장 ETF마다 운용사만 다른 상품(예: KODEX 200TR ↔ KIWOOM 200TR)을 종목 테이블에서 찾아
 * 총보수·규모·1년 수익률·괴리율(네이버)과 가격을 받는다. 리밸런싱 가이드(income-guide)와 리포트(rebalance-report)가 같은 자료로
 * src/lib/indexProductChoice.ts를 돌려야 화면마다 살 곳이 갈리지 않는다.
 * 실패는 빈 자료로 돌려준다(비교 없이 보유 상품을 산다).
 */
import { fetchEtfKeyIndicators, type EtfKeyIndicator } from "./etfKeyIndicator";
import { fetchGuidePrices } from "./incomeGuideStore";
import { isExchangeTradedProduct } from "../lib/securitiesTax";
import { sameIndexKey, type EtfYield, type FeeAlternative } from "../lib/indexProductChoice";

/** 네이버 ETF 지표 → 비교에 쓰는 값 (없으면 모두 null) */
export function toEtfYield(k: EtfKeyIndicator | null): EtfYield {
  return { yieldTtm: k?.yieldTtm ?? null, fee: k?.fee ?? null, marketCap: k?.marketCap ?? null, return1y: k?.return1y ?? null, deviation: k?.deviation ?? null };
}

/** 지수 하나당 비교할 다른 상품 수 상한 */
const PEERS_PER_INDEX = 12;

export async function loadIndexAlternatives(
  supabase: any,
  growth: Array<{ code: string; name: string }>,
): Promise<{ etf: Map<string, EtfYield>; alternatives: FeeAlternative[] }> {
  const etf = new Map<string, EtfYield>();
  const alternatives: FeeAlternative[] = [];
  const heldCodes = [...new Set(growth.map((g) => g.code))];
  const byKey = new Map<string, string>();
  for (const g of growth) {
    const key = sameIndexKey(g.name);
    if (key && !byKey.has(key)) byKey.set(key, g.name);
  }
  try {
    const peers: Array<{ code: string; name: string }> = [];
    const seen = new Set(heldCodes);
    for (const [key, name] of byKey) {
      const lastWord = name.trim().split(/\s+/).pop() ?? "";
      const { data, error } = await supabase.from("stocks").select("code, name").ilike("name", `%${lastWord}%`).limit(60);
      if (error) continue;
      const found = ((data ?? []) as Array<{ code: string; name: string | null }>)
        .filter((s) => s.name && sameIndexKey(s.name) === key && isExchangeTradedProduct(String(s.code), s.name))
        .slice(0, PEERS_PER_INDEX + 1);
      for (const s of found) {
        const code = String(s.code);
        if (seen.has(code)) continue;
        seen.add(code);
        peers.push({ code, name: String(s.name) });
      }
    }
    const peerCodes = peers.map((p) => p.code);
    const [indicators, peerPrices] = await Promise.all([
      fetchEtfKeyIndicators([...heldCodes, ...peerCodes]),
      peerCodes.length ? fetchGuidePrices(supabase, peerCodes) : Promise.resolve({ prices: new Map<string, number>() }),
    ]);
    for (const code of heldCodes) if (indicators.has(code)) etf.set(code, toEtfYield(indicators.get(code)!));
    for (const p of peers) {
      alternatives.push({ code: p.code, name: p.name, price: peerPrices.prices.get(p.code) ?? 0, ...toEtfYield(indicators.get(p.code) ?? null) });
    }
  } catch {
    // 비교 실패는 화면을 막지 않는다
  }
  return { etf, alternatives };
}
