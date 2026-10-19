import { ACCUMULATE_ASOF, INDEX_ETF_CANDIDATES, type IndexEtfCandidate } from '../data/accumulateData'

/**
 * 모아가기 후보 지표를 서버 최신값으로 덮는다(/api/ui/index-etf-metrics, 받는 훅은 indexEtfLive.ts). 고정 스냅샷
 * (accumulateData.ts)은 연구 스크립트로 만든 날 기준이라 보수 인하·순자산 변화가 반영되지 않았다.
 * 서버가 못 준 칸은 스냅샷 값을 그대로 쓰고, 실패하면 스냅샷 전체를 쓴다.
 */
export type LiveIndexEtfMetric = { code: string; feePct: number | null; marketCapEok: number | null; tradingValueMil: number | null }
export type IndexEtfCandidatesView = { cands: IndexEtfCandidate[]; asOf: string; live: boolean }

export const STATIC_INDEX_ETF_VIEW: IndexEtfCandidatesView = { cands: INDEX_ETF_CANDIDATES, asOf: ACCUMULATE_ASOF, live: false }

export function mergeLiveCandidates(
  base: IndexEtfCandidate[],
  live: { asOf: string | null; items: LiveIndexEtfMetric[] } | null | undefined,
): IndexEtfCandidatesView {
  if (!live?.asOf || !Array.isArray(live.items)) return { cands: base, asOf: ACCUMULATE_ASOF, live: false }
  const byCode = new Map(live.items.map((m) => [m.code, m]))
  // 세 칸이 다 온 경우만 '최신'으로 표시한다 — 일부만 덮였는데 새 기준일을 붙이면 표시가 거짓이 된다
  const complete = base.every((c) => {
    const m = byCode.get(c.code)
    return m != null && m.feePct != null && m.marketCapEok != null && m.tradingValueMil != null
  })
  const cands = base.map((c) => {
    const m = byCode.get(c.code)
    if (!m) return c
    return {
      ...c,
      feePct: m.feePct ?? c.feePct,
      marketCapEok: m.marketCapEok ?? c.marketCapEok,
      tradingValueMil: m.tradingValueMil ?? c.tradingValueMil,
    }
  })
  return complete ? { cands, asOf: live.asOf, live: true } : { cands, asOf: ACCUMULATE_ASOF, live: false }
}
