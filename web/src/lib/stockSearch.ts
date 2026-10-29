import type { StockItem } from './stockCache'

export function normalizeSearchTerm(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[·ㆍ\.\-_/()\[\]{}]/g, '')
}

/**
 * 종목 검색 결과 정렬: 이름·코드가 정확히 같음 → 앞부분 일치 → 포함, 같은 순위 안에서는 거래대금 큰 종목이 먼저.
 * 예전엔 목록 순서대로 앞 10개만 보여, "삼성"을 쳐도 이름 앞부분이 맞는 종목이 밀렸다.
 */
export function rankStockMatches(stocks: readonly StockItem[], query: string, limit = 10): StockItem[] {
  const q = query.trim()
  if (!q) return []
  const nq = normalizeSearchTerm(q)
  const scored: { s: StockItem; tier: number }[] = []
  for (const s of stocks) {
    const name = normalizeSearchTerm(s.name)
    let tier = -1
    if (s.code === q || (nq && name === nq)) tier = 0
    else if (s.code.startsWith(q) || (nq && name.startsWith(nq))) tier = 1
    else if (s.code.includes(q) || (nq && name.includes(nq))) tier = 2
    if (tier >= 0) scored.push({ s, tier })
  }
  scored.sort((a, b) => a.tier - b.tier || (b.s.liquidity ?? -1) - (a.s.liquidity ?? -1))
  return scored.slice(0, limit).map((x) => x.s)
}
