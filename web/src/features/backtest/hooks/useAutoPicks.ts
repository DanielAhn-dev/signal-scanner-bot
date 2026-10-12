import { useEffect, useState } from 'react'
import { apiFetch } from '../../../lib/api'
import type {
  AutoPickItem,
  AutoPickTier,
  BacktestResponse,
  ConditionStats,
  ReturnProfileKey,
  ScanCandidateLite,
  StockIndicators,
} from '../types'
import { estimateExpectedReturnPct, evaluateAutoPick } from '../lib/autoPick'
import { toEokFromWon } from '../lib/format'
import { matchesRuleFilter } from '../lib/ruleMatch'
import { isBuySignal } from '../lib/signal'

export function useAutoPicks(input: {
  data: BacktestResponse | null
  selectedRuleKey: string | null
  returnProfile: ReturnProfileKey
  minExpectedReturnPct: number
  minShortMomentumPct: number
  minLiquidityEok: number
}) {
  const { data, selectedRuleKey, returnProfile, minExpectedReturnPct, minShortMomentumPct, minLiquidityEok } = input
  const [autoPickLoading, setAutoPickLoading] = useState(false)
  const [autoPickError, setAutoPickError] = useState<string | null>(null)
  const [autoPicks, setAutoPicks] = useState<AutoPickItem[]>([])
  const [conditionStats, setConditionStats] = useState<ConditionStats>({
    buySignalPct: 0,
    score50PlusPct: 0,
    rsi45_65Pct: 0,
    totalScanned: 0,
  })

  useEffect(() => {
    const selectedRule = (data?.ruleCandidates ?? []).find((rule) => rule.key === selectedRuleKey)
      ?? (data?.ruleCandidates ?? [])[0]
    if (!data || !selectedRule) {
      setAutoPicks([])
      setAutoPickError(null)
      setAutoPickLoading(false)
      return
    }

    let disposed = false
    const run = async () => {
      setAutoPickLoading(true)
      setAutoPickError(null)
      try {
        const scanRes = await apiFetch('/api/ui/scan-candidates?limit=60&includeIndicatorLiquidity=1&cacheMs=0', {
          cacheMs: 0,
          timeoutMs: 12_000,
        })
        const candidates = Array.isArray(scanRes?.data)
          ? (scanRes.data as ScanCandidateLite[]).filter((row) => !!row?.code)
          : []
        const candidateMap = new Map(
          candidates.map((row) => [String(row.code || '').trim(), row]),
        )

        console.log(`[Auto-Pick] 스캔 후보: ${candidates.length}개`)

        if (candidates.length === 0) {
          if (!disposed) setAutoPicks([])
          return
        }

        let evaluatedCount = 0
        let ruleFilteredCount = 0
        let returnFilteredCount = 0
        let momentumFilteredCount = 0
        let liquidityFilteredCount = 0
        let buySignalCount = 0
        let score50PlusCount = 0
        let rsi45_65Count = 0

        const scanSlice = candidates.slice(0, 36)
        const settled = await Promise.allSettled(
          scanSlice.map(async (candidate) => {
            const code = String(candidate.code || '').trim()
            if (!code) return null
            const indicatorRes = await apiFetch(`/api/ui/stock-indicators?code=${encodeURIComponent(code)}`, {
              cacheMs: 0,
              timeoutMs: 8_000,
            })
            const indicator = (indicatorRes?.data ?? null) as StockIndicators | null
            if (!indicator) return null
            
            // 조건별 충족 여부 확인
            const score = Number(indicator.total_score ?? 0)
            const rsi = indicator.rsi14
            if (isBuySignal(indicator.signal)) buySignalCount++
            if (score >= 50) score50PlusCount++
            if (rsi != null && rsi >= 45 && rsi <= 65) rsi45_65Count++
            
            const ranked = evaluateAutoPick(indicator)
            if (!ranked) return null
            if (ranked.tier === 'watch') return null
            evaluatedCount++
            
            const ruleMatched = matchesRuleFilter(indicator, selectedRule.filter)
            if (!ruleMatched && ranked.coreMatchCount < 2) {
              ruleFilteredCount++
              return null
            }

            const scan = candidateMap.get(code)
            const intradayChangePct = Number(scan?.intraday_change_pct)
            const inferredMomentum = Number(indicator.roc21 ?? 0) / 4.2
            const shortMomentumPct = Number.isFinite(intradayChangePct) && intradayChangePct !== 0
              ? intradayChangePct
              : inferredMomentum

            const expectedReturnPct = estimateExpectedReturnPct({
              baseReturnPct: Number(
                (ruleMatched ? selectedRule.matchedAvgReturnPct : data.baseline.avgForwardReturnPct) ?? 0,
              ),
              coreMatchCount: ranked.coreMatchCount,
              ruleMatched,
              score: Number(indicator.total_score ?? 0),
              shortMomentumPct,
              tier: ranked.tier,
              profile: returnProfile,
            })

            const liquidity = Number(scan?.liquidity)
            const liquidityWon = Number.isFinite(liquidity) && liquidity > 0 ? liquidity : null
            const liquidityEok = toEokFromWon(liquidityWon)

            if (expectedReturnPct < minExpectedReturnPct) {
              returnFilteredCount++
              return null
            }
            if (shortMomentumPct < minShortMomentumPct) {
              momentumFilteredCount++
              return null
            }
            if (liquidityEok < minLiquidityEok) {
              liquidityFilteredCount++
              return null
            }

            return {
              code,
              name: String(indicator.name || candidate.name || code),
              score: Number(indicator.total_score ?? 0),
              signal: String(indicator.signal || '-'),
              rsi14: indicator.rsi14,
              market: indicator.market,
              warnGrade: indicator.warn_grade,
              ruleMatched,
              coreMatchCount: ranked.coreMatchCount,
              edgeScore: ranked.edgeScore,
              expectedReturnPct,
              shortMomentumPct: Number(shortMomentumPct.toFixed(1)),
              liquidity: liquidityWon,
              tier: ranked.tier,
            } as AutoPickItem
          }),
        )

        const tierRank: Record<AutoPickTier, number> = { now: 3, prepare: 2, watch: 1 }
        const next = settled
          .filter((row): row is PromiseFulfilledResult<AutoPickItem | null> => row.status === 'fulfilled')
          .map((row) => row.value)
          .filter((row): row is AutoPickItem => !!row)
          .sort((a, b) => {
            if (tierRank[b.tier] !== tierRank[a.tier]) return tierRank[b.tier] - tierRank[a.tier]
            if (b.edgeScore !== a.edgeScore) return b.edgeScore - a.edgeScore
            return b.score - a.score
          })
          .slice(0, 12)

        console.log(`[Auto-Pick] 필터 결과:
  - 조건 충족률 (36개 중):
    • BUY 신호: ${buySignalCount}개 (${Math.round(buySignalCount / 36 * 100)}%)
    • 점수 50+: ${score50PlusCount}개 (${Math.round(score50PlusCount / 36 * 100)}%)
    • RSI 45-65: ${rsi45_65Count}개 (${Math.round(rsi45_65Count / 36 * 100)}%)
  - 티어 평가 통과: ${evaluatedCount}개
  - 규칙 필터 제외: ${ruleFilteredCount}개
  - 기대수익 필터 제외: ${returnFilteredCount}개 (최소값: ${minExpectedReturnPct}%)
  - 모멘텀 필터 제외: ${momentumFilteredCount}개 (최소값: ${minShortMomentumPct}%)
  - 거래대금 필터 제외: ${liquidityFilteredCount}개 (최소값: ${minLiquidityEok}억)
  - 최종 추천: ${next.length}개`)

        const scanned = scanSlice.length
        if (!disposed) {
          setConditionStats({
            buySignalPct: scanned > 0 ? Math.round(buySignalCount / scanned * 100) : 0,
            score50PlusPct: scanned > 0 ? Math.round(score50PlusCount / scanned * 100) : 0,
            rsi45_65Pct: scanned > 0 ? Math.round(rsi45_65Count / scanned * 100) : 0,
            totalScanned: scanned,
          })
          setAutoPicks(next)
        }
      } catch (e: any) {
        if (!disposed) {
          setAutoPicks([])
          setAutoPickError(e?.message || '자동 추천 조회 실패')
        }
      } finally {
        if (!disposed) setAutoPickLoading(false)
      }
    }

    void run()
    return () => {
      disposed = true
    }
  }, [data, selectedRuleKey, minExpectedReturnPct, minShortMomentumPct, minLiquidityEok, returnProfile])

  return { autoPickLoading, autoPickError, autoPicks, conditionStats }
}
