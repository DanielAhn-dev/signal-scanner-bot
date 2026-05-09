import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  fetchAllMarketData,
  type MarketOverview,
} from '../../src/utils/fetchMarketData'
import {
  scoreSectors,
  getTopSectors,
  getNextSectorCandidates,
  type SectorScore,
} from '../../src/lib/sectors'

const MARKET_CACHE_TTL_MS = Math.max(0, Number(process.env.UI_MARKET_CACHE_TTL_MS || 30_000))
const MARKET_QUERY_TIMEOUT_MS = Math.max(1_000, Number(process.env.UI_MARKET_QUERY_TIMEOUT_MS || 15_000))

type MarketRegime =
  | 'strong_bull'
  | 'bull'
  | 'neutral'
  | 'bear'
  | 'strong_bear'

interface MarketDiagnosis {
  regime: MarketRegime
  riskScore: number
  signals: string[]
  advice: string[]
}

interface MarketOverviewResponse {
  diagnosis: MarketDiagnosis
  indices: MarketOverview
  topSectors: SectorScore[]
  nextSectors: SectorScore[]
  regimeLabel: string
  fetchedAt: string
}

type MarketCacheEntry = {
  expiresAt: number
  payload: MarketOverviewResponse
}

const marketCache = new Map<string, MarketCacheEntry>()

function diagnoseMarket(data: MarketOverview): MarketDiagnosis {
  const signals: string[] = []
  const advice: string[] = []
  let riskScore = 50

  // VIX
  if (data.vix) {
    if (data.vix.price >= 35) {
      riskScore += 20
      signals.push('🔴 VIX 극단적 공포 구간 (35↑)')
      advice.push('현금 비중 50% 이상 유지')
      advice.push('추가 매수 자제, 보유 종목 손절 기준 엄수')
    } else if (data.vix.price >= 25) {
      riskScore += 10
      signals.push('🟡 VIX 경계 구간 (25~35)')
      advice.push('신규 매수 비중 축소 (30% 이하)')
    } else if (data.vix.price < 15) {
      riskScore -= 5
      signals.push('🟢 VIX 안정 (15 미만)')
    }
  }

  // Fear & Greed
  if (data.fearGreed) {
    if (data.fearGreed.score <= 20) {
      riskScore += 5
      signals.push('🔴 극단적 공포 — 역발상 매수 기회 가능')
      advice.push('우량주 분할 매수 시작 고려')
    } else if (data.fearGreed.score >= 80) {
      riskScore += 15
      signals.push('🟡 극단적 탐욕 — 차익실현 고려')
      advice.push('보유 종목 일부 익절, 현금화 추천')
    }
  }

  // 환율
  if (data.usdkrw) {
    if (data.usdkrw.price >= 1450) {
      riskScore += 10
      signals.push('🔴 원화 급약세 (1,450↑) — 외국인 이탈 가능')
      advice.push('외국인 순매도 종목 주의')
    } else if (data.usdkrw.price >= 1350) {
      riskScore += 5
      signals.push('🟡 원화 약세 (1,350↑)')
    }
  }

  // 미국 금리
  if (data.us10y) {
    if (data.us10y.price >= 5.0) {
      riskScore += 10
      signals.push('🔴 미국 10년물 5%↑ — 긴축 우려 극대')
    } else if (data.us10y.price >= 4.5) {
      riskScore += 5
      signals.push('🟡 미국 10년물 4.5%↑ — 고금리 지속')
    }
  }

  // KOSPI 등락
  if (data.kospi) {
    if (data.kospi.changeRate <= -2) {
      riskScore += 10
      signals.push('🔴 KOSPI 급락 (-2%↑)')
    } else if (data.kospi.changeRate >= 1.5) {
      riskScore -= 5
      signals.push('🟢 KOSPI 강세 (+1.5%↑)')
    }
  }

  const usChanges = [data.sp500?.changeRate, data.nasdaq?.changeRate, data.dow?.changeRate]
    .filter((value): value is number => Number.isFinite(value))
  if (usChanges.length >= 2) {
    const usAvg = usChanges.reduce((sum, value) => sum + value, 0) / usChanges.length
    if (usAvg <= -1.2) {
      riskScore += 8
      signals.push('🔴 미국 3대 지수 동반 약세 — 리스크오프 가능성')
      advice.push('개장 직후 추격 진입보다 1차 변동성 소화 후 분할 진입')
    } else if (usAvg >= 1.2) {
      riskScore -= 4
      signals.push('🟢 미국 3대 지수 동반 강세 — 위험선호 확산')
      advice.push('주도 섹터 대표주 중심으로 단계적 비중 확대')
    }
  }

  riskScore = Math.max(0, Math.min(100, riskScore))

  let regime: MarketRegime
  if (riskScore <= 20) regime = 'strong_bull'
  else if (riskScore <= 40) regime = 'bull'
  else if (riskScore <= 60) regime = 'neutral'
  else if (riskScore <= 80) regime = 'bear'
  else regime = 'strong_bear'

  return { regime, riskScore, signals, advice }
}

const regimeLabel: Record<MarketRegime, string> = {
  strong_bull: '강세장 — 적극 매수',
  bull: '상승 추세 — 선별 매수',
  neutral: '중립 — 관망 위주',
  bear: '약세 — 방어 전략',
  strong_bear: '하락장 — 현금 확보 우선',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || process.env.UI_CORS_ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key,x-user-chat-id')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Cache-Control', 'private, max-age=10, stale-while-revalidate=30')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const expectedReadKey = process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  const readKey = req.headers['x-ui-key'] || req.query.ui_key
  const trustedOrigins = String(
    process.env.UI_TRUSTED_WEB_ORIGINS ||
    'https://signal-scanner-web.vercel.app,http://localhost:5173',
  )
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
  const isTrustedOrigin = !!origin && trustedOrigins.includes(origin)
  if (expectedReadKey && !isTrustedOrigin && String(readKey || '') !== expectedReadKey) {
    return res.status(401).json({ error: 'Unauthorized', detail: 'Invalid UI read key' })
  }

  try {
    const bypassCache = String((req.query as any)?.cacheMs || '') === '0'
    const cacheKey = 'market-overview'

    // 캐시 확인
    if (!bypassCache && marketCache.has(cacheKey)) {
      const cached = marketCache.get(cacheKey)!
      if (Date.now() < cached.expiresAt) {
        return res.status(200).json({
          data: cached.payload,
          cached: true,
        })
      }
    }

    // 시장 데이터 조회
    const todayStr = new Date().toISOString().slice(0, 10)
    const [marketData, sectorScores] = await Promise.all([
      Promise.race([
        fetchAllMarketData(),
        new Promise<MarketOverview>((_, reject) =>
          setTimeout(() => reject(new Error('Market data fetch timeout')), MARKET_QUERY_TIMEOUT_MS)
        ),
      ]),
      Promise.race([
        scoreSectors(todayStr).catch(() => [] as SectorScore[]),
        new Promise<SectorScore[]>((_, reject) =>
          setTimeout(() => reject(new Error('Sector scoring timeout')), MARKET_QUERY_TIMEOUT_MS)
        ),
      ]),
    ])

    const diagnosis = diagnoseMarket(marketData)
    const topSectors = getTopSectors(sectorScores).slice(0, 5)
    const nextSectors = getNextSectorCandidates(sectorScores, 3e9).slice(0, 5)

    const payload: MarketOverviewResponse = {
      diagnosis,
      indices: marketData,
      topSectors,
      nextSectors,
      regimeLabel: regimeLabel[diagnosis.regime],
      fetchedAt: new Date().toISOString(),
    }

    // 캐시 저장
    marketCache.set(cacheKey, {
      expiresAt: Date.now() + MARKET_CACHE_TTL_MS,
      payload,
    })

    return res.status(200).json({ data: payload, cached: false })
  } catch (error: any) {
    console.error('[market-overview] Error:', error)
    return res.status(500).json({
      error: 'Failed to fetch market overview',
      detail: error?.message || String(error),
    })
  }
}
