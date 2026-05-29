type CandidateMode = 'balanced' | 'multibagger' | 'swing'

type AutoCandidate = {
  code: string
  name: string
  source: 'highlights' | 'scan'
  score: number
  reason: string
}

function clampValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

function normalizeScoreFrom5(value: number | null | undefined): number {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return 0
  if (n > 5) return clampValue(n, 0, 100)
  return clampValue(n * 20, 0, 100)
}

function gradeToPct(grade: unknown): number {
  const value = String(grade || '').trim().toUpperCase()
  if (value === 'A') return 92
  if (value === 'B') return 78
  if (value === 'C') return 60
  if (value === 'D') return 42
  return 50
}

function pickFirstFiniteNumber(obj: any, keys: string[]): number | null {
  for (const key of keys) {
    const value = Number(obj?.[key])
    if (Number.isFinite(value)) return value
  }
  return null
}

function computeNetFlow(item: any): { net5d: number | null; net20d: number | null } {
  const foreign = pickFirstFiniteNumber(item, ['foreign_net_buy_5d', 'foreignNetBuy5d', 'foreign5d'])
  const institution = pickFirstFiniteNumber(item, ['institution_net_buy_5d', 'institutionNetBuy5d', 'institution5d'])
  const foreign20 = pickFirstFiniteNumber(item, ['foreign_net_buy_20d', 'foreignNetBuy20d', 'foreign20d'])
  const institution20 = pickFirstFiniteNumber(item, ['institution_net_buy_20d', 'institutionNetBuy20d', 'institution20d'])

  const net5d = foreign == null && institution == null ? null : (foreign ?? 0) + (institution ?? 0)
  const net20d = foreign20 == null && institution20 == null ? null : (foreign20 ?? 0) + (institution20 ?? 0)
  return { net5d, net20d }
}

function computeNetFlowScore(item: any): { score: number; net5d: number | null; net20d: number | null } {
  const flow = computeNetFlow(item)
  if (flow.net5d == null && flow.net20d == null) return { score: 50, net5d: null, net20d: null }

  const net5d = flow.net5d ?? 0
  const net20d = flow.net20d ?? 0
  const billions5d = net5d / 1_000_000_000
  const billions20d = net20d / 1_000_000_000
  const score = clampValue(50 + billions5d * 3.6 + billions20d * 1.4, 0, 100)
  return { score, net5d: flow.net5d, net20d: flow.net20d }
}

function computeFlowAccelerationScore(net5d: number | null, net20d: number | null): number {
  if (net5d == null && net20d == null) return 50
  const daily5 = (net5d ?? 0) / 5
  const daily20 = (net20d ?? 0) / 20
  const delta = daily5 - daily20
  return clampValue(50 + (delta / 200_000_000) * 18 + ((net5d ?? 0) / 1_000_000_000) * 1.2, 0, 100)
}

function scoreSignalFreshness(ageDays: number | null | undefined, liteAgeDays: number | null | undefined): number {
  const strictAge = Number(ageDays)
  const liteAge = Number(liteAgeDays)
  if (Number.isFinite(strictAge) && strictAge >= 0) {
    return strictAge <= 0 ? 100 : strictAge <= 1 ? 92 : strictAge <= 3 ? 80 : strictAge <= 5 ? 68 : strictAge <= 10 ? 52 : 36
  }
  if (Number.isFinite(liteAge) && liteAge >= 0) {
    return liteAge <= 0 ? 92 : liteAge <= 1 ? 84 : liteAge <= 3 ? 72 : liteAge <= 5 ? 60 : liteAge <= 10 ? 46 : 32
  }
  return 55
}

function computeOverheatRisk(intradayPct: number): number {
  const upRisk = Math.max(0, intradayPct - 4.2)
  const downRisk = Math.max(0, -intradayPct - 4.8)
  return clampValue(upRisk * 18 + downRisk * 10, 0, 100)
}

function formatStageLabel(stage: unknown): '리드 돌파' | '리드 축적' | '일반' {
  const value = String(stage || '').trim().toLowerCase()
  if (value === 'breakout') return '리드 돌파'
  if (value === 'lead') return '리드 축적'
  return '일반'
}

function rankScanCandidate(item: any, mode: CandidateMode): AutoCandidate {
  const entryPct = normalizeScoreFrom5(item?.entry_score)
  const trendPct = gradeToPct(item?.trend_grade)
  const quickPct = clampValue(Number(item?.quick_trade_score ?? 0), 0, 100)
  const adaptivePct = clampValue(Number(item?.adaptive_score ?? 0), 0, 100)
  const leadPct = clampValue(Number(item?.lead_accumulation_score ?? 0), 0, 100)
  const warnPct = normalizeScoreFrom5(item?.warn_score)
  const liquidity = Number(item?.liquidity ?? 0)
  const liquidityPct =
    liquidity >= 100_000_000_000 ? 100 :
    liquidity >= 30_000_000_000 ? 85 :
    liquidity >= 10_000_000_000 ? 70 :
    liquidity >= 3_000_000_000 ? 55 :
    liquidity >= 1_000_000_000 ? 40 : 20
  const intraday = Number(item?.intraday_change_pct ?? 0)
  const intradayFit = mode === 'swing'
    ? clampValue(100 - Math.max(0, intraday - 1.5) * 18 - Math.max(0, -intraday - 3.0) * 5, 0, 100)
    : clampValue(100 - Math.abs(intraday - 2.8) * 12, 0, 100)
  const leadStage = formatStageLabel(item?.lead_accumulation_stage)
  const stageBoost = mode === 'swing'
    ? (leadStage === '리드 축적' ? 9 : (leadStage === '리드 돌파' ? 3 : 0))
    : (leadStage === '리드 돌파' ? 5 : (leadStage === '리드 축적' ? 2.5 : 0))

  const flow = computeNetFlowScore(item)
  const flowAcceleration = computeFlowAccelerationScore(flow.net5d, flow.net20d)
  const signalFresh = scoreSignalFreshness(item?.quick_signal_age_days, item?.quick_lite_signal_age_days)
  const overheatRisk = computeOverheatRisk(intraday)
  const earlyStageFit = clampValue(
    leadStage === '리드 축적' ? 100 - Math.max(0, intraday - 3.0) * 12 : leadStage === '리드 돌파' ? 70 - Math.max(0, intraday - 5.0) * 10 : 52,
    0,
    100,
  )

  const upsideSignal = clampValue(
    leadPct * 0.24 + trendPct * 0.17 + entryPct * 0.14 + adaptivePct * 0.1 + quickPct * 0.08 + flow.score * 0.1 + flowAcceleration * 0.08 + signalFresh * 0.05 + earlyStageFit * 0.04,
    0,
    100,
  )
  const riskSignal = clampValue(
    warnPct * 0.46 + (100 - liquidityPct) * 0.24 + overheatRisk * 0.2 + (100 - intradayFit) * 0.1,
    0,
    100,
  )
  const v2Base = clampValue(upsideSignal * 0.74 + (100 - riskSignal) * 0.26, 0, 100)

  const baseScore = mode === 'multibagger'
    ? (v2Base * 0.7 + leadPct * 0.12 + flow.score * 0.08 + flowAcceleration * 0.1)
    : mode === 'swing'
    ? (v2Base * 0.68 + signalFresh * 0.14 + earlyStageFit * 0.12 + (100 - overheatRisk) * 0.06)
    : (v2Base * 0.78 + quickPct * 0.1 + flowAcceleration * 0.12)

  const longFlowBonus = flow.net20d != null && (mode === 'multibagger' || mode === 'swing')
    ? clampValue((flow.net20d / 1_000_000_000) * (mode === 'swing' ? 0.9 : 0.5), -8, 14)
    : 0
  const swingPenalty = mode === 'swing' ? clampValue((intraday - 3.5) * 3.0, 0, 24) : 0
  const finalScore = clampValue(baseScore + stageBoost + longFlowBonus - swingPenalty - overheatRisk * 0.06, 0, 100)

  return {
    code: String(item?.code || ''),
    name: String(item?.name || item?.code || ''),
    source: 'scan',
    score: finalScore,
    reason: `상승잠재 ${upsideSignal.toFixed(1)} / 리스크 ${riskSignal.toFixed(1)} / 리드 ${leadStage} / 당일 ${intraday.toFixed(2)}%`,
  }
}

function rankHighlightCandidate(item: any, mode: CandidateMode): AutoCandidate {
  const confidence = Number(item?.confidence_pct ?? 0)
  const confidencePct = clampValue(Number.isFinite(confidence) ? confidence : 0, 0, 100)
  const upsidePct = clampValue(Number(item?.expected_upside_pct ?? 0), -100, 200)
  const drawdownPct = clampValue(Number(item?.expected_drawdown_pct ?? 0), -100, 100)
  const edgePct = clampValue(50 + (upsidePct - Math.abs(drawdownPct)) * 4, 0, 100)
  const momentumPct = clampValue(Number(item?.score_momentum ?? 0), 0, 100)
  const safetyPct = clampValue(Number(item?.score_safety ?? 0), 0, 100)
  const leadPct = clampValue(Number(item?.lead_accumulation_score ?? 0), 0, 100)
  const leadStage = formatStageLabel(item?.lead_accumulation_stage)
  const stageBoost = mode === 'swing'
    ? (leadStage === '리드 축적' ? 7 : (leadStage === '리드 돌파' ? 2 : 0))
    : (leadStage === '리드 돌파' ? 4 : (leadStage === '리드 축적' ? 2 : 0))
  const flow = computeNetFlowScore(item)
  const flowAcceleration = computeFlowAccelerationScore(flow.net5d, flow.net20d)

  const drawdownAbs = Math.abs(drawdownPct)
  const drawdownRisk = clampValue(drawdownAbs * 11.5, 0, 100)
  const confidenceRisk = clampValue((70 - confidencePct) * 1.25, 0, 100)
  const upsideSignal = clampValue(
    confidencePct * 0.23 + edgePct * 0.28 + momentumPct * 0.12 + safetyPct * 0.11 + leadPct * 0.1 + flow.score * 0.08 + flowAcceleration * 0.08,
    0,
    100,
  )
  const riskSignal = clampValue((100 - safetyPct) * 0.45 + drawdownRisk * 0.35 + confidenceRisk * 0.2, 0, 100)
  const v2Base = clampValue(upsideSignal * 0.76 + (100 - riskSignal) * 0.24, 0, 100)

  const baseScore = mode === 'multibagger'
    ? (v2Base * 0.72 + momentumPct * 0.1 + leadPct * 0.1 + flowAcceleration * 0.08)
    : mode === 'swing'
    ? (v2Base * 0.67 + edgePct * 0.14 + safetyPct * 0.1 + (leadStage === '리드 축적' ? 9 : 0))
    : (v2Base * 0.8 + confidencePct * 0.1 + flowAcceleration * 0.1)

  const longFlowBonus = flow.net20d != null && (mode === 'multibagger' || mode === 'swing')
    ? clampValue((flow.net20d / 1_000_000_000) * (mode === 'swing' ? 0.85 : 0.45), -8, 12)
    : 0
  const weakEdgePenalty = upsidePct < drawdownAbs * 1.4 ? clampValue((drawdownAbs * 1.4 - upsidePct) * 1.6, 0, 18) : 0
  const finalScore = clampValue(baseScore + stageBoost + longFlowBonus - weakEdgePenalty, 0, 100)

  return {
    code: String(item?.code || ''),
    name: String(item?.name || item?.code || ''),
    source: 'highlights',
    score: finalScore,
    reason: `상승잠재 ${upsideSignal.toFixed(1)} / 리스크 ${riskSignal.toFixed(1)} / 기대상승 ${upsidePct.toFixed(1)}%`,
  }
}

async function fetchJson(baseUrl: string, path: string, readKey: string): Promise<any> {
  const url = new URL(path, baseUrl)
  if (readKey) url.searchParams.set('ui_key', readKey)
  const res = await fetch(url, {
    headers: {
      ...(readKey ? { 'x-ui-key': readKey } : {}),
      Origin: 'http://localhost:5173',
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${path} ${res.status} ${text}`.trim())
  }
  return res.json()
}

async function main() {
  const modeArg = String(process.argv[2] || 'swing').toLowerCase()
  const mode: CandidateMode = modeArg === 'balanced' || modeArg === 'multibagger' || modeArg === 'swing' ? modeArg : 'swing'
  const baseUrl = process.env.BASE_URL || 'http://localhost:3003'
  const readKey = process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY || ''

  const [highlightsRes, scanRes] = await Promise.all([
    fetchJson(baseUrl, '/api/ui/scan-highlights', readKey).catch((e) => ({ data: [], __error: String(e?.message || e) })),
    fetchJson(baseUrl, '/api/ui/scan-candidates?limit=120&cacheMs=0', readKey).catch((e) => ({ data: [], __error: String(e?.message || e) })),
  ])

  const highlights = Array.isArray(highlightsRes?.data) ? highlightsRes.data : []
  const scan = Array.isArray(scanRes?.data) ? scanRes.data : []

  if (highlightsRes?.__error) {
    console.log(`[warn] highlights fetch error: ${highlightsRes.__error}`)
  }
  if (scanRes?.__error) {
    console.log(`[warn] scan fetch error: ${scanRes.__error}`)
  }

  const ranked = [
    ...highlights.map((row: any) => rankHighlightCandidate(row, mode)),
    ...scan.map((row: any) => rankScanCandidate(row, mode)),
  ].filter((item) => item.code)

  const bestByCode = new Map<string, AutoCandidate>()
  for (const row of ranked) {
    const prev = bestByCode.get(row.code)
    if (!prev || row.score > prev.score) bestByCode.set(row.code, row)
  }

  const top = [...bestByCode.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 15)

  console.log('')
  console.log(`=== execution-guide v2 preview (${mode}) ===`)
  console.log(`baseUrl=${baseUrl}`)
  console.log(`highlights=${highlights.length}, scan=${scan.length}, merged=${bestByCode.size}`)
  console.log('')

  if (top.length === 0) {
    console.log('후보가 없습니다.')
    return
  }

  for (const [idx, row] of top.entries()) {
    const rank = String(idx + 1).padStart(2, '0')
    console.log(`${rank}. ${row.name}(${row.code}) [${row.source}] score=${row.score.toFixed(2)}`)
    console.log(`    ${row.reason}`)
  }
}

main().catch((err) => {
  console.error('[fatal]', err?.message || err)
  process.exit(1)
})
