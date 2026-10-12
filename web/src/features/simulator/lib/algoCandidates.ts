import { empiricalWinProb } from '../../../lib/tpSlBaseRates'
import { defaultPlanItem, type HighlightPlanItem } from '../planStore'

/**
 * 스캔 후보(scan-candidates)와 하이라이트(scan-highlights)를 코드 기준으로 병합해 추천 후보를 만든다.
 * 등급 D는 제외하고, 하이라이트가 후보와 겹치면 하이라이트의 신호 정보를 우선 반영한다.
 */
export function mergeAlgoCandidates(scanList: any[], hlList: any[]): HighlightPlanItem[] {
  const asNum = (v: any, fallback = 0) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : fallback
  }
  const getRank = (row: any) => {
    const rank = asNum(
      row?.signal_rank ?? row?.pullback_rank ?? row?.rank ?? row?.priority_rank,
      9999,
    )
    return rank > 0 ? rank : 9999
  }
  const getSignalScore = (row: any) => asNum(
    row?.signal_score ?? row?.adaptive_score ?? row?.confidence_pct ?? row?.score,
    0,
  )

  // 스캔 페이지 기본 정렬(priority_score desc)과 동일한 우선순위 정렬
  const sortedScanList = [...scanList].sort((a, b) => {
    const pa = Number.isFinite(Number(a?.adaptive_score))
      ? Number(a.adaptive_score)
      : (Number(a?.entry_score ?? 0) * 20 - Number(a?.warn_score ?? 0) * 3)
    const pb = Number.isFinite(Number(b?.adaptive_score))
      ? Number(b.adaptive_score)
      : (Number(b?.entry_score ?? 0) * 20 - Number(b?.warn_score ?? 0) * 3)
    if (pb !== pa) return pb - pa
    const rankDiff = getRank(a) - getRank(b)
    if (rankDiff !== 0) return rankDiff
    return getSignalScore(b) - getSignalScore(a)
  })
  const sortedHlList = [...hlList].sort((a, b) => {
    const rankDiff = getRank(a) - getRank(b)
    if (rankDiff !== 0) return rankDiff
    return getSignalScore(b) - getSignalScore(a)
  })
  
  // code 기준 중복 제거 & 품질 등급별 파라미터 설정
  const merged: Record<string, HighlightPlanItem> = {}
  
  // scan-candidates 처리 (entry_grade 기반) - A/B/C는 포함, D만 제외
  for (const row of sortedScanList) {
    const code = String(row.code || '').trim()
    const name = String(row.name || code || '').trim()
    if (!code || !name) continue
    
    // 품질 필터: entry_grade D는 제외 (A/B/C는 포함)
    const grade = String(row.entry_grade || '').toUpperCase()
    if (grade === 'D') continue
    
    // 예전엔 진입등급별로 승률을 가정했다(A: 목표+8%/손절-2.5%/승률 70%). 실측하면 이 조합은 5거래일 안에
    // 목표 도달 15%, 손절 58%였고, 10년 검증에서 진입 A가 오히려 가장 부진했다. 등급과 무관하게
    // 기본 목표·손절을 두고 승률은 실측 환산값을 쓴다.
    const targetPct = 5
    const stopPct = 3
    const winProb = empiricalWinProb(targetPct, stopPct)
    
    // 가격 정보 저장 (current_price 우선, 없으면 close, 둘 다 없으면 기본값 50,000원)
    const currentPrice = Number(row.current_price ?? row.close ?? 0) || 50000
    const closePrice = Number(row.close ?? 0) || 50000
    
    const item = defaultPlanItem({ code, name, sector_id: row.sector_id })
    merged[code] = {
      ...item,
      source: 'scan-candidates',
      signal_score: getSignalScore(row),
      signal_rank: getRank(row),
      market: String(row.market || row.market_type || row.exchange || ''),
      targetPct,
      stopPct,
      winProb: Math.round(winProb),
      current_price: currentPrice,
      close: closePrice,
    }
  }
  
  // scan-highlights 처리 (expected_upside_pct 기반)
  for (const row of sortedHlList) {
    const code = String(row.code || '').trim()
    const name = String(row.name || code || '').trim()
    if (!code || !name) continue
    
    // 하이라이트 데이터: upside/downside 직접 사용
    // expected_* 는 20거래일 과거 분포라 주 1사이클 목표·손절로 쓰지 않는다.
    const targetPct = 5
    const stopPct = 3
    const winProb = empiricalWinProb(targetPct, stopPct)
    
    // 하이라이트와 후보가 중복되면, 하이라이트 신호 정보를 우선 반영
    if (code in merged) {
      merged[code] = {
        ...merged[code],
        source: 'scan-highlights',
        signal_score: Math.max(Number(merged[code].signal_score || 0), getSignalScore(row)),
        signal_rank: Math.min(Number(merged[code].signal_rank || 9999), getRank(row)),
        market: String(row.market || row.market_type || row.exchange || merged[code].market || ''),
        current_price: Number(row.entry_price ?? merged[code].current_price ?? 0) || merged[code].current_price,
      }
      continue
    }
    
    // 가격 정보 저장 (entry_price 우선, 없으면 현황 가격)
    const entryPrice = Number(row.entry_price ?? 0)
    
    const item = defaultPlanItem({ code, name, sector_id: row.sector_id })
    merged[code] = {
      ...item,
      source: 'scan-highlights',
      signal_score: getSignalScore(row),
      signal_rank: getRank(row),
      market: String(row.market || row.market_type || row.exchange || ''),
      targetPct,
      stopPct,
      winProb: Math.round(winProb),
      current_price: entryPrice || undefined,
    }
  }
  
  return Object.values(merged)
}
