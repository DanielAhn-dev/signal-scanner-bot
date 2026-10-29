/** PER·PBR·ROE·부채비율이 하나도 없는 종목 — 수집 실패·신규상장·ETF. 빈 칸만 보이면 '좋지도 나쁘지도 않음'으로 오해하기 쉽다. */
export function hasNoValuationData(result: any): boolean {
  if (!result) return false
  return [result.per, result.pbr, result.roe, result.debt_ratio].every((v) => v == null || !Number.isFinite(Number(v)))
}
