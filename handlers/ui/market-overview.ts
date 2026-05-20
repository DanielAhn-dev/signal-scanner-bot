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

interface EconomicPhase {
  phase: 'normal' | 'high_inflation' | 'deflation' | 'stagflation' | 'unknown'
  label: string
  description: string
  severity: number // 0-100, higher = more concerning
  indicators: {
    us10y: number | null
    cpiYoy: number | null
    goldTrend: 'up' | 'down' | 'neutral' | null
    oilTrend: 'up' | 'down' | 'neutral' | null
    usdkrwTrend: 'up' | 'down' | 'neutral' | null
    riskSentiment: 'risk_on' | 'risk_off' | 'neutral'
  }
}

interface CpiIndicator {
  yoy: number | null
  source: 'env' | 'unavailable'
  fetchedAt: string
}

interface GlobalCorrelation {
  kospiToSp500Correlation: number | null // -1 to 1
  kospiSp500Spread: number | null // KOSPI% - SP500%
  americanFuturesSignal: 'bullish' | 'bearish' | 'neutral'
  usdStrength: 'strengthening' | 'weakening' | 'neutral'
  emergingMarketsPressure: 'high' | 'moderate' | 'low'
}

interface TradingSignal {
  shouldTrade: boolean // 현재 매매 권장 여부
  confidence: number // 0-100
  recommendation: string
  restrictions: string[] // 해야 할 제약사항
}

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
  fetchedAt: string
}

type MarketCacheEntry = {
  expiresAt: number
  payload: MarketOverviewResponse
}

const marketCache = new Map<string, MarketCacheEntry>()

function parseOptionalNumber(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function resolveCpiIndicator(): CpiIndicator {
  const yoy = parseOptionalNumber(process.env.MARKET_CPI_YOY)
  return {
    yoy,
    source: yoy == null ? 'unavailable' : 'env',
    fetchedAt: new Date().toISOString(),
  }
}

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

function diagnoseEconomicPhase(data: MarketOverview, cpiYoy: number | null): EconomicPhase {
  // 단일 임계치 기반 분기 대신, 다중 신호를 점수화해 국면을 판정한다.
  // 목표: 특정 지표 하나로 "스태그플레이션"이 과도하게 트리거되는 오탐을 줄이기.

  let severity = 50
  let phase: EconomicPhase['phase'] = 'unknown'
  const indicators: EconomicPhase['indicators'] = {
    us10y: data.us10y?.price ?? null,
    cpiYoy,
    goldTrend: null,
    oilTrend: null,
    usdkrwTrend: null,
    riskSentiment: 'neutral',
  }

  // 금 추세 (역사적 평균 ~1800달러, 최근 2000~2100달러 범위)
  const goldPrice = data.gold?.price ?? 0
  const goldHigh = 2100
  const goldLow = 1800
  if (goldPrice > goldHigh) {
    indicators.goldTrend = 'up'
  } else if (goldPrice < goldLow) {
    indicators.goldTrend = 'down'
  } else {
    indicators.goldTrend = 'neutral'
  }

  // 유가 추세 (역사적 평균 ~80달러, 최근 70~100달러 범위)
  const oilPrice = data.wtiOil?.price ?? 0
  const oilHigh = 100
  const oilLow = 70
  if (oilPrice > oilHigh) {
    indicators.oilTrend = 'up'
  } else if (oilPrice < oilLow) {
    indicators.oilTrend = 'down'
  } else {
    indicators.oilTrend = 'neutral'
  }

  // 환율 추세 (1200~1450원 범위)
  const usdkrwPrice = data.usdkrw?.price ?? 1300
  const usdkrwHigh = 1400
  const usdkrwLow = 1250
  if (usdkrwPrice > usdkrwHigh) {
    indicators.usdkrwTrend = 'up' // 달러 강세
  } else if (usdkrwPrice < usdkrwLow) {
    indicators.usdkrwTrend = 'down'
  } else {
    indicators.usdkrwTrend = 'neutral'
  }

  // 위험 심리도
  if (data.fearGreed && data.vix) {
    if (data.fearGreed.score >= 70 || data.vix.price <= 15) {
      indicators.riskSentiment = 'risk_on'
    } else if (data.fearGreed.score <= 30 || data.vix.price >= 25) {
      indicators.riskSentiment = 'risk_off'
    }
  }

  // 경제 국면 다중 신호 점수화
  // inflationPressure: 인플레 압력, growthStress: 성장 둔화 압력,
  // policyTightness: 금융여건 경직, riskOffBias: 위험회피 심리
  let inflationPressure = 0
  let growthStress = 0
  let policyTightness = 0
  let riskOffBias = 0
  let evidenceCount = 0

  if (cpiYoy != null) {
    evidenceCount += 1
    if (cpiYoy >= 4.0) inflationPressure += 40
    else if (cpiYoy >= 3.0) inflationPressure += 25
    else if (cpiYoy <= 1.5) growthStress += 18
  }

  if (data.us10y && Number.isFinite(data.us10y.price)) {
    evidenceCount += 1
    if (data.us10y.price >= 4.8) {
      policyTightness += 35
      growthStress += 10
    } else if (data.us10y.price >= 4.3) {
      policyTightness += 22
      growthStress += 6
    } else if (data.us10y.price <= 3.8) {
      policyTightness -= 8
    }
  }

  if (data.wtiOil && Number.isFinite(data.wtiOil.price)) {
    evidenceCount += 1
    if (data.wtiOil.price >= 95) inflationPressure += 22
    else if (data.wtiOil.price <= 70) growthStress += 16
  }

  if (data.gold && Number.isFinite(data.gold.price)) {
    evidenceCount += 1
    if (data.gold.price >= 2100) {
      inflationPressure += 10
      riskOffBias += 8
    } else if (data.gold.price <= 1850) {
      inflationPressure -= 4
    }
  }

  if (data.usdkrw && Number.isFinite(data.usdkrw.price)) {
    evidenceCount += 1
    if (data.usdkrw.price >= 1400) {
      growthStress += 16
      riskOffBias += 14
    } else if (data.usdkrw.price >= 1350) {
      growthStress += 10
      riskOffBias += 8
    } else if (data.usdkrw.price <= 1250) {
      riskOffBias -= 6
    }
  }

  if (data.vix && Number.isFinite(data.vix.price)) {
    evidenceCount += 1
    if (data.vix.price >= 30) {
      riskOffBias += 26
      growthStress += 12
    } else if (data.vix.price >= 22) {
      riskOffBias += 14
      growthStress += 6
    } else if (data.vix.price <= 16) {
      riskOffBias -= 6
    }
  }

  if (data.sp500 && Number.isFinite(data.sp500.changeRate)) {
    evidenceCount += 1
    if (data.sp500.changeRate <= -1.5) growthStress += 14
    else if (data.sp500.changeRate >= 1.2) growthStress -= 8
  }

  if (data.nasdaq && Number.isFinite(data.nasdaq.changeRate)) {
    evidenceCount += 1
    if (data.nasdaq.changeRate <= -2.0) growthStress += 14
    else if (data.nasdaq.changeRate >= 1.5) growthStress -= 8
  }

  if (data.kospi && Number.isFinite(data.kospi.changeRate)) {
    evidenceCount += 1
    if (data.kospi.changeRate <= -1.8) growthStress += 12
    else if (data.kospi.changeRate >= 1.2) growthStress -= 6
  }

  if (data.fearGreed && Number.isFinite(data.fearGreed.score)) {
    evidenceCount += 1
    if (data.fearGreed.score <= 30) riskOffBias += 18
    else if (data.fearGreed.score >= 70) riskOffBias -= 8
  }

  inflationPressure = Math.max(0, Math.min(100, inflationPressure))
  growthStress = Math.max(0, Math.min(100, growthStress))
  policyTightness = Math.max(0, Math.min(100, policyTightness))
  riskOffBias = Math.max(0, Math.min(100, riskOffBias))

  const stagflationScore = inflationPressure * 0.42 + growthStress * 0.32 + policyTightness * 0.2 + riskOffBias * 0.06
  const inflationScore = inflationPressure * 0.55 + policyTightness * 0.2 + riskOffBias * 0.1 - growthStress * 0.15
  const deflationScore = growthStress * 0.5 + riskOffBias * 0.3 + (100 - inflationPressure) * 0.2
  const normalScore = (100 - inflationPressure) * 0.35 + (100 - growthStress) * 0.35 + (100 - riskOffBias) * 0.3

  // 증거 개수가 적으면 "판단 어려움"을 유지하여 오탐 방지.
  if (evidenceCount < 4) {
    phase = 'unknown'
    severity = 55
  } else if (stagflationScore >= 62 && inflationPressure >= 45 && growthStress >= 35) {
    phase = 'stagflation'
    severity = Math.round(Math.min(95, Math.max(70, stagflationScore)))
  } else if (inflationScore >= 55 && inflationPressure >= 40) {
    phase = 'high_inflation'
    severity = Math.round(Math.min(88, Math.max(58, inflationScore)))
  } else if (deflationScore >= 58 && growthStress >= 40) {
    phase = 'deflation'
    severity = Math.round(Math.min(90, Math.max(60, deflationScore)))
  } else if (normalScore >= 55) {
    phase = 'normal'
    severity = Math.round(Math.min(58, Math.max(35, 100 - normalScore)))
  } else {
    phase = 'unknown'
    severity = 52
  }

  const phaseLabels: Record<EconomicPhase['phase'], { label: string; description: string }> = {
    stagflation: {
      label: '스태그플레이션 ⚠️',
      description: '고인플레 + 고금리 + 약세장. 매우 어려운 시장. 현금/방어주 우선.',
    },
    high_inflation: {
      label: '고인플레이션',
      description: '인플레 우려. 금/원자재 강세. 금리 인상 압박. 신중한 진입 필요.',
    },
    deflation: {
      label: '디플레이션 우려',
      description: '수요 부족 신호. 안전자산 선호. 경기 둔화 가능성.',
    },
    normal: {
      label: '정상 국면',
      description: '인플레/금리 안정적. 성장주 진입 기회.',
    },
    unknown: {
      label: '판단 어려움',
      description: '신호가 혼재. 추가 정보 필요.',
    },
  }

  return {
    phase,
    label: phaseLabels[phase].label,
    description: phaseLabels[phase].description,
    severity,
    indicators,
  }
}

function analyzeGlobalCorrelation(data: MarketOverview): GlobalCorrelation {
  // 미국 증시 신호
  const sp500Change = data.sp500?.changeRate ?? 0
  const nasdaqChange = data.nasdaq?.changeRate ?? 0
  const dowChange = data.dow?.changeRate ?? 0
  const americanAvg = (sp500Change + nasdaqChange + dowChange) / 3

  // 한국 증시 신호
  const kospiChange = data.kospi?.changeRate ?? 0
  const kosdaqChange = data.kosdaq?.changeRate ?? 0

  // 상관도 추정 (간단한 휴리스틱)
  const correlation = kospiChange > 0 && americanAvg > 0 ? 0.8 : kospiChange < 0 && americanAvg < 0 ? 0.7 : 0.3

  // 스프레드 (미국이 더 강한지 약한지)
  const spread = kospiChange - americanAvg

  // 미국 선물 신호
  let americanFuturesSignal: 'bullish' | 'bearish' | 'neutral' = 'neutral'
  if (americanAvg >= 1.0) americanFuturesSignal = 'bullish'
  else if (americanAvg <= -1.0) americanFuturesSignal = 'bearish'

  // 달러 강도
  let usdStrength: 'strengthening' | 'weakening' | 'neutral' = 'neutral'
  if (data.usdkrw && data.usdkrw.changeRate >= 0.5) usdStrength = 'strengthening'
  else if (data.usdkrw && data.usdkrw.changeRate <= -0.5) usdStrength = 'weakening'

  // 신흥시장 압박도 (강달러 + 고금리 = 신흥시장 피매도)
  let emergingMarketsPressure: 'high' | 'moderate' | 'low' = 'moderate'
  if (usdStrength === 'strengthening' && data.us10y && data.us10y.price >= 4.5) {
    emergingMarketsPressure = 'high'
  } else if (usdStrength === 'weakening' || (data.us10y && data.us10y.price < 4.0)) {
    emergingMarketsPressure = 'low'
  }

  return {
    kospiToSp500Correlation: correlation,
    kospiSp500Spread: spread,
    americanFuturesSignal,
    usdStrength,
    emergingMarketsPressure,
  }
}

function generateTradingSignal(
  diagnosis: MarketDiagnosis,
  economicPhase: EconomicPhase,
  correlation: GlobalCorrelation
): TradingSignal {
  const restrictions: string[] = []
  let shouldTrade = true
  let confidence = 70

  // 경제 국면별 제약
  if (economicPhase.phase === 'stagflation') {
    shouldTrade = false
    confidence = 20
    restrictions.push('스태그플레이션: 매매 제한 권고 (현금 확보 우선)')
  } else if (economicPhase.phase === 'high_inflation') {
    confidence -= 20
    restrictions.push('고인플레: 방어주/금리민감주 회피')
  } else if (economicPhase.phase === 'deflation') {
    confidence -= 15
    restrictions.push('디플레이션 우려: 신중한 매매, 현금 비중 확대')
  }

  // 시장 체제별 제약
  if (diagnosis.regime === 'strong_bear' || diagnosis.regime === 'bear') {
    confidence -= 15
    restrictions.push('약세장: 분할 진입 필수, 손절 -5% 이상 엄수')
  } else if (diagnosis.regime === 'strong_bull') {
    confidence += 10
  }

  // 글로벌 상관도별 제약
  if (correlation.americanFuturesSignal === 'bearish') {
    confidence -= 10
    restrictions.push('미국 선물 약세: 한국 증시 동반 약세 가능성')
  }

  if (correlation.emergingMarketsPressure === 'high') {
    confidence -= 15
    restrictions.push('신흥시장 압박: 달러 강세로 외국인 이탈 위험')
  }

  // VIX/Fear&Greed 신호
  if (diagnosis.riskScore >= 75) {
    shouldTrade = false
    confidence = 30
    restrictions.push('극단적 공포: 매매 중단, 손절 기준 엄수')
  } else if (diagnosis.riskScore >= 60) {
    confidence -= 10
    restrictions.push('높은 위험 수준: 비중 축소, 분할 진입만')
  }

  confidence = Math.max(0, Math.min(100, confidence))

  const recommendation =
    shouldTrade && confidence >= 60
      ? `매매 진행 가능 (신뢰도 ${confidence}%) — ${restrictions.length > 0 ? '다만 제약사항 확인 필요' : '양호한 진입 환경'}`
      : shouldTrade && confidence >= 40
        ? `제한적 매매 (신뢰도 ${confidence}%) — ${restrictions.length > 0 ? restrictions.slice(0, 2).join(', ') : '보수적 접근 권고'}`
        : `매매 제한 권고 (신뢰도 ${confidence}%) — ${restrictions[0] || '현금 비중 확대 우선'}`

  return {
    shouldTrade: shouldTrade && confidence >= 50,
    confidence,
    recommendation,
    restrictions,
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
    const cpi = resolveCpiIndicator()
    const economicPhase = diagnoseEconomicPhase(marketData, cpi.yoy)
    const globalCorrelation = analyzeGlobalCorrelation(marketData)
    const tradingSignal = generateTradingSignal(diagnosis, economicPhase, globalCorrelation)

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
