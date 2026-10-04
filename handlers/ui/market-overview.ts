import { toKstDateKey } from '../../src/lib/krxCalendar'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  fetchAllMarketData,
  type MarketOverview,
} from '../../src/utils/fetchMarketData'
import { denyIfUnauthorizedRead } from './_accessControl'
import {
  scoreSectors,
  getTopSectors,
  getNextSectorCandidates,
  type SectorScore,
} from '../../src/lib/sectors'

const MARKET_CACHE_TTL_MS = Math.max(0, Number(process.env.UI_MARKET_CACHE_TTL_MS || 30_000))
const MARKET_QUERY_TIMEOUT_MS = Math.max(1_000, Number(process.env.UI_MARKET_QUERY_TIMEOUT_MS || 15_000))

import {
  analyzeGlobalCorrelation,
  describeBotBuyGate,
  diagnoseEconomicPhase,
  diagnoseMarket,
  generateTradingSignal,
  regimeLabel,
  resolveCpiIndicator,
  type BotBuyGate,
  type CpiIndicator,
  type EconomicPhase,
  type GlobalCorrelation,
  type MarketDiagnosis,
  type TradingSignal,
} from '../../src/services/marketDiagnosis'
import { withIndexTrendRatios } from '../../src/services/indexTrendRatios'
import { detectAutoTradeMarketPolicy } from '../../src/services/virtualAutoTradeSelection'
import { createClient } from '@supabase/supabase-js'
import { fetchMarketFlowCaution, MARKET_FLOW_EVIDENCE, type MarketFlowCaution } from '../../src/services/marketFlowCaution'

interface MarketOverviewResponse {
  diagnosis: MarketDiagnosis
  indices: MarketOverview
  cpi: CpiIndicator
  topSectors: SectorScore[]
  nextSectors: SectorScore[]
  regimeLabel: string
  economicPhase: EconomicPhase
  globalCorrelation: GlobalCorrelation
  tradingSignal: TradingSignal
  botBuyGate: BotBuyGate | null
  /** 신고가 부근 + 외국인 1년 최대 순매도 경고(안내용). 시장 수급 데이터가 310거래일 미만이면 null */
  marketFlowCaution: (MarketFlowCaution & { evidence: typeof MARKET_FLOW_EVIDENCE }) | null
  fetchedAt: string
}

type MarketCacheEntry = {
  expiresAt: number
  payload: MarketOverviewResponse
}

const marketCache = new Map<string, MarketCacheEntry>()

async function resolveMarketFlowCaution(): Promise<MarketOverviewResponse['marketFlowCaution']> {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } })
    const caution = await fetchMarketFlowCaution(supabase)
    return caution ? { ...caution, evidence: MARKET_FLOW_EVIDENCE } : null
  } catch {
    return null
  }
}

/** 자동매매와 같은 시장 정책(코스피 50일선·200일선)으로 봇의 신규 매수 여부를 알려준다. 실패하면 null */
async function resolveBotBuyGate(marketData: MarketOverview): Promise<BotBuyGate | null> {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } })
    const overview = await withIndexTrendRatios(supabase, { ...marketData })
    return describeBotBuyGate(detectAutoTradeMarketPolicy({ overview: overview as any }))
  } catch {
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || process.env.UI_CORS_ORIGIN || '*'
  const requestedHeaders = String(req.headers['access-control-request-headers'] || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
  const allowHeaders = new Set([
    'Content-Type',
    'x-ui-key',
    'x-user-chat-id',
    'Authorization',
    ...requestedHeaders,
  ])
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', Array.from(allowHeaders).join(','))
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Cache-Control', 'private, max-age=10, stale-while-revalidate=30')
  res.setHeader('Vary', 'Origin,Access-Control-Request-Headers')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  if (denyIfUnauthorizedRead(req, res)) return

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
    const todayStr = toKstDateKey()
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
    const cpi = resolveCpiIndicator()
    const economicPhase = diagnoseEconomicPhase(marketData, cpi.yoy)
    const globalCorrelation = analyzeGlobalCorrelation(marketData)
    const tradingSignal = generateTradingSignal(diagnosis, economicPhase, globalCorrelation)
    const [botBuyGate, marketFlowCaution] = await Promise.all([
      resolveBotBuyGate(marketData),
      resolveMarketFlowCaution(),
    ])

    const payload: MarketOverviewResponse = {
      diagnosis,
      indices: marketData,
      cpi,
      topSectors,
      nextSectors,
      regimeLabel: regimeLabel[diagnosis.regime],
      economicPhase,
      globalCorrelation,
      tradingSignal,
      botBuyGate,
      marketFlowCaution,
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
