import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { buildInvestmentPlan } from '../../src/lib/investPlan'
import { fetchLatestScoresByCodes } from '../../src/services/scoreSourceService'
import { scaleScoreFactorsToReferencePrice } from '../../src/lib/priceScale'
import { getFundamentalSnapshot } from '../../src/services/fundamentalService'
import { fetchCreditShortSnapshot } from '../../src/utils/fetchCreditShortData'
import { fetchRealtimeStockData } from '../../src/utils/fetchRealtimePrice'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'

type LatestRow = {
  date: string | null
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  volume: number | null
  value: number | null
}

type InvestorFlowRow = {
  date: string | null
  metric: 'volume' | 'amount'
  personal: number | null
  foreign: number | null
  institution: number | null
  personal_amount: number | null
  foreign_amount: number | null
  institution_amount: number | null
  personal_volume: number | null
  foreign_volume: number | null
  institution_volume: number | null
}

type IndicatorSnapshot = {
  trade_date: string | null
  sma20: number | null
  sma50: number | null
  sma200: number | null
  rsi14: number | null
}

type CreditShortDailySnapshot = {
  date: string | null
  credit_ratio: number | null
  short_ratio: number | null
  short_balance: number | null
}

type CreditShortProxy = {
  riskScore: number
  level: 'low' | 'moderate' | 'high'
  reasons: string[]
}

type PerShareMetrics = {
  eps: number | null
  bps: number | null
  peg: number | null
  pegMeta: {
    source: 'stored' | 'derived' | 'unavailable'
    confidence: 'high' | 'medium' | 'low'
    growthPct: number | null
    growthBasis: 'net_income_forward' | 'net_income' | 'op_income' | 'sales' | null
    label: string
  }
}

type AdvisorSignalStatus = 'strong_buy' | 'buy' | 'watch' | 'partial_sell' | 'sell'

type AdvisorRegimeStage = 'risk_off' | 'hold' | 'risk_on'
type AdvisorExecutionAction = 'aggressive_buy' | 'pilot_buy' | 'hold' | 'reduce' | 'exit'

function resolveAdvisorSignal(input: {
  currentPrice: number | null
  finalScore: number | null
  technicalScore: number | null
  statusFromPlan: string | null | undefined
  entryLow: number | null
  entryHigh: number | null
  stopPrice: number | null
  target1: number | null
  riskReward: number | null
  conviction: number | null
}): { status: AdvisorSignalStatus; statusLabel: string; reason: string } {
  const {
    currentPrice,
    finalScore,
    technicalScore,
    statusFromPlan,
    entryLow,
    entryHigh,
    stopPrice,
    target1,
    riskReward,
    conviction,
  } = input

  const s = String(statusFromPlan || '').toLowerCase()
  const score = Number.isFinite(Number(finalScore)) ? Number(finalScore) : Number(technicalScore)
  const hasScore = Number.isFinite(score)
  const tech = Number.isFinite(Number(technicalScore)) ? Number(technicalScore) : null
  const hasTech = tech != null
  const rr = Number.isFinite(Number(riskReward)) ? Number(riskReward) : null
  const cv = Number.isFinite(Number(conviction)) ? Number(conviction) : null
  const price = Number.isFinite(Number(currentPrice)) ? Number(currentPrice) : null
  const entryMid =
    entryLow != null && entryHigh != null
      ? (Number(entryLow) + Number(entryHigh)) / 2
      : null
  const entryDistPct =
    price != null && entryMid != null && entryMid > 0
      ? Math.abs(((price - entryMid) / entryMid) * 100)
      : null

  const inEntryBand =
    price != null && entryLow != null && entryHigh != null
      ? price >= Number(entryLow) && price <= Number(entryHigh)
      : false

  // 매수 조건은 보수적으로 유지하되, 진입 밴드 인근(소폭 이탈)까지 허용해 신호 누락을 줄인다.
  const nearEntryBand =
    price != null && entryLow != null && entryHigh != null
      ? price >= Number(entryLow) * 0.985 && price <= Number(entryHigh) * 1.015
      : false

  if (price != null && stopPrice != null && price <= Number(stopPrice)) {
    return { status: 'sell', statusLabel: '손절/매도', reason: '현재가가 손절 기준 이하로 이탈' }
  }

  if (price != null && target1 != null && price >= Number(target1)) {
    return { status: 'partial_sell', statusLabel: '익절', reason: '현재가가 1차 목표가 도달/상회' }
  }

  if (s === 'wait') {
    return { status: 'watch', statusLabel: '관망', reason: '플랜 상태가 관망(wait) 구간' }
  }

  if (!hasScore || !hasTech) {
    return {
      status: 'watch',
      statusLabel: '관망',
      reason: '점수 데이터 불충분(보수적 관망)',
    }
  }

  // buy-now는 곧바로 강력매수로 두지 않고, 점수+진입구간을 동시에 만족할 때만 강력매수로 본다.
  const strongBuyOk =
    s === 'buy-now' &&
    inEntryBand &&
    score >= 76 &&
    tech >= 68 &&
    (rr == null || rr >= 1.35) &&
    (cv == null || cv >= 66)

  if (strongBuyOk) {
    return {
      status: 'strong_buy',
      statusLabel: '강력매수',
      reason: `진입구간 내 + 고점수(${score.toFixed(1)}/${tech.toFixed(1)}) + 손익비/확신도 충족`,
    }
  }

  const entryTightEnough = entryDistPct == null || entryDistPct <= 1.0
  const rrOk = rr == null || rr >= 1.15
  const cvOk = cv == null || cv >= 55
  const buyNowScoreOk = score >= 66 && tech >= 62
  const pullbackScoreOk = score >= 62 && tech >= 58

  if (
    nearEntryBand &&
    entryTightEnough &&
    rrOk &&
    cvOk &&
    ((s === 'buy-now' && buyNowScoreOk) || (s === 'buy-on-pullback' && pullbackScoreOk))
  ) {
    return {
      status: 'buy',
      statusLabel: '매수',
      reason: `진입 인근 + 점수(${score.toFixed(1)}/${tech.toFixed(1)}) + 손익비/확신도 조건 충족`,
    }
  }

  if (nearEntryBand && (s === 'buy-now' || s === 'buy-on-pullback')) {
    return {
      status: 'watch',
      statusLabel: '관망',
      reason: `진입 인근이지만 필터 미충족(점수 ${score.toFixed(1)}/${tech.toFixed(1)}, RR ${rr?.toFixed(2) ?? '-'}, 확신 ${cv?.toFixed(1) ?? '-'})`,
    }
  }

  return {
    status: 'watch',
    statusLabel: '관망',
    reason: '진입/익절/손절 트리거 조건 미충족',
  }
}

function resolveTwoStageAction(input: {
  signalStatus: AdvisorSignalStatus
  finalScore: number | null
  technicalScore: number | null
  currentPrice: number | null
  entryLow: number | null
  entryHigh: number | null
  riskReward: number | null
  conviction: number | null
  sma20: number | null
  sma50: number | null
}): {
  regime: AdvisorRegimeStage
  action: AdvisorExecutionAction
  actionLabel: string
  allocationPct: number
  reason: string
} {
  const score = Number.isFinite(Number(input.finalScore)) ? Number(input.finalScore) : null
  const tech = Number.isFinite(Number(input.technicalScore)) ? Number(input.technicalScore) : null
  const price = Number.isFinite(Number(input.currentPrice)) ? Number(input.currentPrice) : null
  const s20 = Number.isFinite(Number(input.sma20)) ? Number(input.sma20) : null
  const s50 = Number.isFinite(Number(input.sma50)) ? Number(input.sma50) : null
  const rr = Number.isFinite(Number(input.riskReward)) ? Number(input.riskReward) : null
  const cv = Number.isFinite(Number(input.conviction)) ? Number(input.conviction) : null

  const trendUp = s20 != null && s50 != null ? s20 >= s50 : (tech != null ? tech >= 62 : false)
  const trendDown = s20 != null && s50 != null ? s20 < s50 : (tech != null ? tech < 45 : false)
  const inEntry =
    price != null && input.entryLow != null && input.entryHigh != null
      ? price >= Number(input.entryLow) && price <= Number(input.entryHigh)
      : false

  let regime: AdvisorRegimeStage = 'hold'
  if (trendDown || (score != null && score < 45)) {
    regime = 'risk_off'
  } else if (trendUp && score != null && score >= 64) {
    regime = 'risk_on'
  }

  if (input.signalStatus === 'sell') {
    return {
      regime: 'risk_off',
      action: 'exit',
      actionLabel: '청산',
      allocationPct: 0,
      reason: '2단계 신호가 손절/매도 조건을 충족',
    }
  }

  if (input.signalStatus === 'partial_sell') {
    return {
      regime,
      action: 'reduce',
      actionLabel: '비중축소',
      allocationPct: 25,
      reason: '목표가 도달 구간으로 분할 익절 우선',
    }
  }

  if (regime === 'risk_on' && input.signalStatus === 'strong_buy') {
    return {
      regime,
      action: 'aggressive_buy',
      actionLabel: '공격매수',
      allocationPct: 100,
      reason: '1단계 레짐 우호 + 2단계 강력매수 동시 충족',
    }
  }

  if (regime === 'risk_on' && input.signalStatus === 'buy') {
    return {
      regime,
      action: 'aggressive_buy',
      actionLabel: '매수',
      allocationPct: 70,
      reason: '상승 레짐에서 진입 신호가 확인됨',
    }
  }

  if ((input.signalStatus === 'strong_buy' || input.signalStatus === 'buy') && (regime === 'hold' || regime === 'risk_off')) {
    const qualityOk = (rr == null || rr >= 1.2) && (cv == null || cv >= 58)
    return {
      regime,
      action: qualityOk && inEntry ? 'pilot_buy' : 'hold',
      actionLabel: qualityOk && inEntry ? '시험진입' : '관망',
      allocationPct: qualityOk && inEntry ? (regime === 'hold' ? 40 : 30) : 0,
      reason: qualityOk && inEntry
        ? '레짐 보수 구간이므로 축소 비중으로만 진입'
        : '레짐/진입 품질 필터 미충족으로 관망',
    }
  }

  return {
    regime,
    action: 'hold',
    actionLabel: '관망',
    allocationPct: 0,
    reason: '레짐/트리거 합성 결과 대기 구간',
  }
}

function isKrxIntradaySession(base = new Date()): boolean {
  const kst = new Date(base.getTime() + 9 * 60 * 60 * 1000)
  const day = kst.getUTCDay()
  if (day === 0 || day === 6) return false
  const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes()
  return minutes >= 9 * 60 && minutes < 15 * 60 + 30
}

function asNum(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'string') {
    const normalized = v.replace(/,/g, '').trim()
    if (!normalized) return null
    const n = Number(normalized)
    return Number.isFinite(n) ? n : null
  }
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function toIsoDate(v: unknown): string | null {
  if (!v) return null
  const s = String(v)
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toISOString()
}

function normalizeSeriesRow(raw: any): LatestRow {
  return {
    date: toIsoDate(raw?.date ?? raw?.traded_at ?? raw?.created_at ?? null),
    open: asNum(raw?.open ?? raw?.o ?? null),
    high: asNum(raw?.high ?? raw?.h ?? null),
    low: asNum(raw?.low ?? raw?.l ?? null),
    close: asNum(raw?.close ?? raw?.c ?? null),
    volume: asNum(raw?.volume ?? raw?.v ?? null),
    value: asNum(raw?.value ?? raw?.amount ?? raw?.trading_value ?? null),
  }
}

function sanitizeTimeSeries(series: LatestRow[]): LatestRow[] {
  if (!Array.isArray(series) || !series.length) return []

  const sortedDesc = [...series]
    .filter((row) => !!row?.date)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))

  const dedupByDate = new Map<string, LatestRow>()
  for (const row of sortedDesc) {
    const date = String(row.date || '').trim()
    if (!date) continue

    const open = asNum(row.open)
    const high = asNum(row.high)
    const low = asNum(row.low)
    const close = asNum(row.close)
    const volume = asNum(row.volume)
    const value = asNum(row.value)

    if (open == null || high == null || low == null || close == null) continue
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0) continue

    dedupByDate.set(date, {
      date,
      open,
      high: Math.max(high, open, close, low),
      low: Math.min(low, open, close, high),
      close,
      volume: volume != null && volume > 0 ? volume : 0,
      value: value != null && value >= 0 ? value : null,
    })
  }

  const dedupedDesc = [...dedupByDate.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)))
  if (dedupedDesc.length <= 1) return dedupedDesc

  const filtered: LatestRow[] = []
  let prevClose: number | null = null

  for (const row of dedupedDesc) {
    const close = asNum(row.close)
    const high = asNum(row.high)
    const low = asNum(row.low)
    if (close == null || high == null || low == null) continue

    if (prevClose != null && prevClose > 0) {
      const minRatio = low / prevClose
      const maxRatio = high / prevClose

      // 분할 미보정/오입력으로 보이는 비정상 급변 봉을 제외한다.
      if (minRatio < 0.35 || maxRatio > 2.2) {
        continue
      }
    }

    filtered.push(row)
    prevClose = close
  }

  return filtered
}

function computeSmaFromSeries(series: LatestRow[], period: number): number | null {
  if (!Number.isFinite(period) || period <= 0) return null
  const closes = series
    .map((row) => asNum(row.close))
    .filter((v): v is number => v != null)
  if (closes.length < period) return null
  const subset = closes.slice(0, period)
  const avg = subset.reduce((acc, v) => acc + v, 0) / period
  return Number(avg.toFixed(2))
}

function computeEmaFromSeries(series: LatestRow[], period: number): number | null {
  if (!Number.isFinite(period) || period <= 0) return null
  const closesDesc = series
    .map((row) => asNum(row.close))
    .filter((v): v is number => v != null)
  if (closesDesc.length < period) return null

  const closesAsc = [...closesDesc].reverse()
  let ema =
    closesAsc.slice(0, period).reduce((acc, v) => acc + v, 0) /
    period
  const k = 2 / (period + 1)

  for (let i = period; i < closesAsc.length; i += 1) {
    ema = closesAsc[i] * k + ema * (1 - k)
  }

  return Number(ema.toFixed(2))
}

async function fetchTimeSeries(supabase: any, code: string): Promise<LatestRow[]> {
  const attemptSpecs: Array<{
    table: string
    select: string
    codeCol: string
    dateCol: string
  }> = [
    { table: 'stock_daily', select: 'date,open,high,low,close,volume,value', codeCol: 'ticker', dateCol: 'date' },
    { table: 'stock_daily', select: 'date,close,high,low,volume,value', codeCol: 'ticker', dateCol: 'date' },
    { table: 'stock_prices', select: 'date,open,high,low,close,volume,value', codeCol: 'code', dateCol: 'date' },
    { table: 'stock_timeseries', select: 'date,open,high,low,close,volume,value', codeCol: 'code', dateCol: 'date' },
    { table: 'stock_history', select: 'date,open,high,low,close,volume,value', codeCol: 'code', dateCol: 'date' },
    { table: 'stock_prices', select: 'date,close,high,low,volume', codeCol: 'code', dateCol: 'date' },
    { table: 'stock_timeseries', select: 'date,close,high,low,volume', codeCol: 'code', dateCol: 'date' },
    { table: 'stock_history', select: 'date,close,high,low,volume', codeCol: 'code', dateCol: 'date' },
  ]

  for (const spec of attemptSpecs) {
    try {
      const run = async (targetCode: string) => {
        return await supabase
          .from(spec.table)
          .select(spec.select)
          .eq(spec.codeCol, targetCode)
          .order(spec.dateCol, { ascending: false })
          .limit(320)
      }

      const first = await run(code)

      if (!first.error && first.data && first.data.length) {
        return first.data.map(normalizeSeriesRow)
      }

      // 일부 테이블은 ticker를 A005930 형태로 저장합니다.
      if (spec.codeCol === 'ticker') {
        const second = await run(`A${code}`)
        if (!second.error && second.data && second.data.length) {
          return second.data.map(normalizeSeriesRow)
        }
      }
    } catch {
      // Try next table/column combination.
    }
  }

  return []
}

async function fetchStockProfile(supabase: any, code: string): Promise<any | null> {
  const selectAttempts = [
    // 최신 스키마: 공매도/신용 + 기술지표 포함
    'code,name,sector_id,close,updated_at,description,market_cap,per,pbr,eps,bps,foreign_ratio,credit_ratio,short_ratio,short_balance,sma20,sma50,rsi14',
    // foreigner_ratio 컬럼명을 쓰는 스키마 + 공매도/신용 + 기술지표 포함
    'code,name,sector_id,close,updated_at,description,market_cap,per,pbr,eps,bps,foreigner_ratio,credit_ratio,short_ratio,short_balance,sma20,sma50,rsi14',
    // 일부 컬럼이 빠진 스키마 대비
    'code,name,sector_id,close,updated_at,description,market_cap,per,pbr,eps,bps,foreign_ratio,sma20,sma50,rsi14',
    'code,name,sector_id,close,updated_at,description,market_cap,per,pbr,eps,bps,foreigner_ratio,sma20,sma50,rsi14',
    // 기술지표 컬럼이 아직 없을 수 있는 과거 스키마
    'code,name,sector_id,close,updated_at,description,market_cap,per,pbr,eps,bps,foreign_ratio,credit_ratio,short_ratio,short_balance',
    'code,name,sector_id,close,updated_at,description,market_cap,per,pbr,eps,bps,foreigner_ratio,credit_ratio,short_ratio,short_balance',
    'code,name,sector_id,close,updated_at,description,market_cap,per,pbr,eps,bps,foreign_ratio',
    'code,name,sector_id,close,updated_at,description,market_cap,per,pbr,eps,bps,foreigner_ratio',
    'code,name,sector_id,close,updated_at,description,market_cap,per,pbr,eps,bps',
    'code,name,sector_id,close,updated_at,description',
    'code,name,sector_id,close,updated_at',
  ]

  for (const select of selectAttempts) {
    try {
      const { data, error } = await supabase
        .from('stocks')
        .select(select)
        .eq('code', code)
        .limit(1)

      if (!error) {
        return data?.[0] || null
      }
    } catch {
      // continue
    }
  }

  return null
}

async function fetchLatestIndicators(supabase: any, code: string): Promise<IndicatorSnapshot | null> {
  const attempts = [
    { table: 'daily_indicators', select: 'trade_date,sma20,sma50,sma200,rsi14', codeCol: 'code', dateCol: 'trade_date' },
    { table: 'daily_indicators', select: 'trade_date,sma20,sma50,sma200,rsi14', codeCol: 'ticker', dateCol: 'trade_date' },
  ]

  for (const spec of attempts) {
    try {
      const run = async (targetCode: string) => {
        return await supabase
          .from(spec.table)
          .select(spec.select)
          .eq(spec.codeCol, targetCode)
          .order(spec.dateCol, { ascending: false })
          .limit(1)
      }

      const first = await run(code)
      if (!first.error && first.data && first.data.length) {
        const row = first.data[0] as any
        return {
          trade_date: row?.trade_date ?? null,
          sma20: asNum(row?.sma20),
          sma50: asNum(row?.sma50),
          sma200: asNum(row?.sma200),
          rsi14: asNum(row?.rsi14),
        }
      }

      if (spec.codeCol === 'ticker') {
        const second = await run(`A${code}`)
        if (!second.error && second.data && second.data.length) {
          const row = second.data[0] as any
          return {
            trade_date: row?.trade_date ?? null,
            sma20: asNum(row?.sma20),
            sma50: asNum(row?.sma50),
            sma200: asNum(row?.sma200),
            rsi14: asNum(row?.rsi14),
          }
        }
      }
    } catch {
      // continue
    }
  }

  return null
}

async function fetchLatestCreditShortDaily(supabase: any, code: string): Promise<CreditShortDailySnapshot | null> {
  try {
    const { data, error } = await supabase
      .from('stock_credit_short_daily')
      .select('date,credit_ratio,short_ratio,short_balance')
      .eq('code', code)
      .order('date', { ascending: false })
      .limit(1)

    if (error || !data?.length) return null
    const row = data[0] as any
    return {
      date: row?.date ?? null,
      credit_ratio: asNum(row?.credit_ratio),
      short_ratio: asNum(row?.short_ratio),
      short_balance: asNum(row?.short_balance),
    }
  } catch {
    return null
  }
}

async function fetchInvestorFlow(supabase: any, code: string): Promise<InvestorFlowRow | null> {
  const attempts = [
    {
      table: 'investor_daily',
      select: 'date,personal,foreign,institution,personal_amount,foreign_amount,institution_amount,personal_volume,foreign_volume,institution_volume',
      codeCol: 'ticker',
      dateCol: 'date',
    },
    {
      table: 'investor_daily',
      select: 'date,personal,foreign,institution,personal_amount,foreign_amount,institution_amount,personal_volume,foreign_volume,institution_volume',
      codeCol: 'code',
      dateCol: 'date',
    },
    {
      table: 'investor_daily',
      select: 'date,retail_net,foreign_net,institution_net,retail_volume,foreign_volume,institution_volume',
      codeCol: 'ticker',
      dateCol: 'date',
    },
    {
      table: 'investor_daily',
      select: 'date,retail_net,foreign_net,institution_net,retail_volume,foreign_volume,institution_volume',
      codeCol: 'code',
      dateCol: 'date',
    },
    { table: 'investor_daily', select: 'date,foreign,institution', codeCol: 'ticker', dateCol: 'date' },
    { table: 'investor_daily', select: 'date,foreign,institution', codeCol: 'code', dateCol: 'date' },
    { table: 'investor_daily', select: 'date,foreign_net,institution_net', codeCol: 'ticker', dateCol: 'date' },
    { table: 'investor_daily', select: 'date,foreign_net,institution_net', codeCol: 'code', dateCol: 'date' },
  ]

  for (const spec of attempts) {
    try {
      const { data, error } = await supabase
        .from(spec.table)
        .select(spec.select)
        .eq(spec.codeCol, code)
        .order(spec.dateCol, { ascending: false })
        .limit(1)

      if (!error && data && data.length) {
        const row = data[0] as any
        const personalVolume = asNum(row?.personal_volume ?? row?.retail_volume)
        const foreignVolume = asNum(row?.foreign_volume)
        const institutionVolume = asNum(row?.institution_volume)

        const personalAmount = asNum(row?.personal_amount ?? row?.personal ?? row?.retail_net)
        const foreignAmount = asNum(row?.foreign_amount ?? row?.foreign ?? row?.foreign_net)
        const institutionAmount = asNum(row?.institution_amount ?? row?.institution ?? row?.institution_net)

        const hasVolume =
          personalVolume != null ||
          foreignVolume != null ||
          institutionVolume != null

        return {
          date: row?.date ?? null,
          metric: hasVolume ? 'volume' : 'amount',
          personal: hasVolume ? personalVolume : personalAmount,
          foreign: hasVolume ? foreignVolume : foreignAmount,
          institution: hasVolume ? institutionVolume : institutionAmount,
          personal_amount: personalAmount,
          foreign_amount: foreignAmount,
          institution_amount: institutionAmount,
          personal_volume: personalVolume,
          foreign_volume: foreignVolume,
          institution_volume: institutionVolume,
        }
      }
    } catch {
      // continue
    }
  }

  return null
}

function toSafeChatId(raw: unknown): number | null {
  const normalized = String(raw ?? '').trim().replace(/[^0-9]/g, '')
  if (!normalized) return null
  const n = Number(normalized)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

async function saveFundamentalSnapshot(
  supabase: any,
  code: string,
  snapshot: any,
): Promise<boolean> {
  if (!snapshot || typeof snapshot !== 'object') {
    return false
  }

  try {
    const now = new Date().toISOString()
    
    // Map snapshot fields to fundamentals table columns
    const row = {
      code,
      per: asNum(snapshot.per) ?? null,
      pbr: asNum(snapshot.pbr) ?? null,
      eps: null,  // 라이브 스크레이핑에서는 종가 불명 → ETL 배치에서 계산
      bps: null,
      roe: asNum(snapshot.roe) ?? null,
      debt_ratio: asNum(snapshot.debtRatio) ?? null,
      sales: asNum(snapshot.sales) ?? null,
      operating_income: asNum(snapshot.opIncome) ?? null,
      net_income: asNum(snapshot.netIncome) ?? null,
      cashflow_oper: null,  // Not in snapshot
      cashflow_free: null,
      as_of: now,
      period_type: 'snapshot',
      period_end: null,
      computed: {
        netIncomeForwardGrowthPct: asNum(snapshot.netIncomeForwardGrowthPct) ?? null,
        salesGrowthPct: asNum(snapshot.salesGrowthPct) ?? null,
        opIncomeGrowthPct: asNum(snapshot.opIncomeGrowthPct) ?? null,
        netIncomeGrowthPct: asNum(snapshot.netIncomeGrowthPct) ?? null,
        qualityScore: asNum(snapshot.qualityScore) ?? null,
        commentary: String(snapshot.commentary || ''),
        peg: asNum(snapshot.peg) ?? null,
        pegSource: snapshot.pegSource ?? null,
        pegGrowthPct: asNum(snapshot.pegGrowthPct) ?? null,
      },
      raw_rows: null,
      source: 'live_scrape',
      created_at: now,
    }

    const { error } = await supabase
      .from('fundamentals')
      .upsert(row, { onConflict: 'code,as_of' })
      .select()

    if (error) {
      console.warn(`Failed to save fundamentals for ${code}:`, error.message)
      return false
    }

    console.log(`✓ Saved live scraped fundamentals for ${code}`)
    return true
  } catch (e: any) {
    console.warn(`Exception saving fundamentals for ${code}:`, e?.message)
    return false
  }
}

function estimateFundamentalQuality(fund: any): number {
  const roe = asNum(fund?.roe)
  const per = asNum(fund?.per)
  const pbr = asNum(fund?.pbr)
  const peg = asNum((fund as any)?.peg)
  let score = 50
  if (roe != null) score += roe >= 12 ? 12 : roe >= 8 ? 6 : -4
  if (per != null) score += per <= 12 ? 8 : per <= 18 ? 3 : -4
  if (pbr != null) score += pbr <= 1.5 ? 6 : pbr <= 2.5 ? 2 : -3
  if (peg != null) score += peg <= 1 ? 6 : peg <= 1.5 ? 3 : peg >= 3 ? -4 : 0
  return Math.max(20, Math.min(85, score))
}

function derivePerShareMetrics(input: {
  price: number | null
  per: number | null
  pbr: number | null
  eps: number | null
  bps: number | null
  peg: number | null
  netIncomeForwardGrowthPct: number | null
  salesGrowthPct: number | null
  opIncomeGrowthPct: number | null
  netIncomeGrowthPct: number | null
}): PerShareMetrics {
  const {
    price,
    per,
    pbr,
    eps,
    bps,
    peg,
    netIncomeForwardGrowthPct,
    salesGrowthPct,
    opIncomeGrowthPct,
    netIncomeGrowthPct,
  } = input

  const pegFallback =
    per != null && per > 0
      ? ((netIncomeForwardGrowthPct != null && netIncomeForwardGrowthPct > 0)
          ? { growthPct: netIncomeForwardGrowthPct, growthBasis: 'net_income_forward' as const }
          : (netIncomeGrowthPct != null && netIncomeGrowthPct > 0)
          ? { growthPct: netIncomeGrowthPct, growthBasis: 'net_income' as const }
          : (opIncomeGrowthPct != null && opIncomeGrowthPct > 0)
            ? { growthPct: opIncomeGrowthPct, growthBasis: 'op_income' as const }
            : (salesGrowthPct != null && salesGrowthPct > 0)
              ? { growthPct: salesGrowthPct, growthBasis: 'sales' as const }
              : { growthPct: null, growthBasis: null })
      : { growthPct: null, growthBasis: null }

  const resolvedEps =
    eps ?? (price != null && per != null && per > 0 ? Number((price / per).toFixed(0)) : null)
  const resolvedBps =
    bps ?? (price != null && pbr != null && pbr > 0 ? Number((price / pbr).toFixed(0)) : null)
  const resolvedPeg =
    peg ??
    (pegFallback.growthPct != null ? Number((per! / pegFallback.growthPct).toFixed(2)) : null)

  const pegMeta: PerShareMetrics['pegMeta'] =
    peg != null
      ? {
          source: 'stored',
          confidence: 'high',
          growthPct: pegFallback.growthPct,
          growthBasis: pegFallback.growthBasis,
          label: '실데이터',
        }
      : resolvedPeg != null
        ? {
            source: 'derived',
            confidence: 'medium',
            growthPct: pegFallback.growthPct,
            growthBasis: pegFallback.growthBasis,
            label:
              pegFallback.growthBasis === 'net_income_forward' || pegFallback.growthBasis === 'net_income'
                ? '실데이터'
                : '추정치',
          }
        : {
            source: 'unavailable',
            confidence: 'low',
            growthPct: pegFallback.growthPct,
            growthBasis: pegFallback.growthBasis,
            label: '데이터부족',
          }

  return {
    eps: resolvedEps,
    bps: resolvedBps,
    peg: resolvedPeg,
    pegMeta,
  }
}

function computeCreditShortProxy(input: {
  stock: any | null
  latest: LatestRow | null
  series: LatestRow[]
  flow: InvestorFlowRow | null
}): CreditShortProxy {
  const { stock, latest, series, flow } = input
  const reasons: string[] = []
  let riskScore = 50

  const current = asNum(latest?.close ?? stock?.close)
  const sma20 = asNum((stock as any)?.sma20)
  const sma50 = asNum((stock as any)?.sma50)
  const rsi14 = asNum((stock as any)?.rsi14)

  if (rsi14 != null) {
    if (rsi14 >= 70) {
      riskScore += 12
      reasons.push('RSI 과열권(70+)')
    } else if (rsi14 >= 65) {
      riskScore += 6
      reasons.push('RSI 고점권(65+)')
    } else if (rsi14 <= 35) {
      riskScore -= 4
      reasons.push('RSI 저점권(35-)')
    }
  }

  if (current != null && sma20 != null && sma20 > 0) {
    const premium20 = ((current - sma20) / sma20) * 100
    if (premium20 >= 6) {
      riskScore += 8
      reasons.push('단기 이격 과열(SMA20 대비 +6%↑)')
    } else if (premium20 >= 3) {
      riskScore += 4
      reasons.push('단기 이격 확대(SMA20 대비 +3%↑)')
    }
  }

  if (current != null && sma50 != null && sma50 > 0) {
    const premium50 = ((current - sma50) / sma50) * 100
    if (premium50 >= 12) {
      riskScore += 8
      reasons.push('중기 이격 과열(SMA50 대비 +12%↑)')
    } else if (premium50 >= 6) {
      riskScore += 4
      reasons.push('중기 이격 확대(SMA50 대비 +6%↑)')
    }
  }

  const closes = series
    .map((row) => asNum(row.close))
    .filter((v): v is number => v != null)
    .slice(0, 8)
  if (closes.length >= 5) {
    const rets: number[] = []
    for (let i = 0; i < closes.length - 1; i += 1) {
      const base = closes[i + 1]
      if (base > 0) rets.push(Math.abs((closes[i] - base) / base) * 100)
    }
    if (rets.length) {
      const mean = rets.reduce((acc, v) => acc + v, 0) / rets.length
      if (mean >= 4) {
        riskScore += 8
        reasons.push('최근 변동성 확대(일평균 4%↑)')
      } else if (mean >= 2.5) {
        riskScore += 4
        reasons.push('최근 변동성 상승(일평균 2.5%↑)')
      }
    }
  }

  const flowNet = (asNum(flow?.foreign) ?? 0) + (asNum(flow?.institution) ?? 0)
  const strongFlowThreshold = flow?.metric === 'volume' ? -100_000 : -1_000_000_000
  if (flowNet < strongFlowThreshold) {
    riskScore += 8
    reasons.push(flow?.metric === 'volume' ? '수급 약세(외인+기관 순매도 강함, 거래량 기준)' : '수급 약세(외인+기관 순매도 강함, 거래대금 기준)')
  } else if (flowNet < 0) {
    riskScore += 4
    reasons.push(flow?.metric === 'volume' ? '수급 약세(외인+기관 순매도, 거래량 기준)' : '수급 약세(외인+기관 순매도, 거래대금 기준)')
  }

  const level: CreditShortProxy['level'] =
    riskScore >= 65 ? 'high' : riskScore >= 45 ? 'moderate' : 'low'

  return {
    riskScore: Math.max(0, Math.min(100, Number(riskScore.toFixed(1)))),
    level,
    reasons: reasons.slice(0, 4),
  }
}

function computeRealCreditShortAdjustment(input: {
  creditRatio: number | null
  shortRatio: number | null
}): { scoreAdj: number; reasons: string[] } {
  // 0은 데이터 없음으로 간주 — 0.00%가 실제 0이 아니라 미집계인 경우가 대부분
  const credit = (Number.isFinite(Number(input.creditRatio)) && Number(input.creditRatio) > 0) ? Number(input.creditRatio) : null
  const short = (Number.isFinite(Number(input.shortRatio)) && Number(input.shortRatio) > 0) ? Number(input.shortRatio) : null

  let adj = 0
  const reasons: string[] = []

  if (short != null) {
    if (short >= 20) {
      adj -= 8
      reasons.push(`공매도 비율 높음(${short.toFixed(2)}%)`)
    } else if (short >= 12) {
      adj -= 5
      reasons.push(`공매도 비율 경계(${short.toFixed(2)}%)`)
    } else if (short >= 7) {
      adj -= 2
    } else if (short <= 2) {
      adj += 2
      reasons.push(`공매도 비율 낮음(${short.toFixed(2)}%)`)
    }
  }

  if (credit != null) {
    if (credit >= 12) {
      adj -= 7
      reasons.push(`신용비율 과열(${credit.toFixed(2)}%)`)
    } else if (credit >= 8) {
      adj -= 4
      reasons.push(`신용비율 높음(${credit.toFixed(2)}%)`)
    } else if (credit >= 5) {
      adj -= 2
    } else if (credit <= 1.5) {
      adj += 1
      reasons.push(`신용비율 안정(${credit.toFixed(2)}%)`)
    }
  }

  const clamped = Math.max(-12, Math.min(4, adj))
  return { scoreAdj: clamped, reasons: reasons.slice(0, 3) }
}

async function buildAdvisorPayload(input: {
  supabase: any
  code: string
  stock: any | null
  latest: LatestRow | null
  realtimePrice: number | null
  fund: any | null
  chatId: number | null
  creditShortProxy: CreditShortProxy | null
  hasRealCreditShort: boolean
  perShareMetrics: PerShareMetrics
  resolvedCreditRatio?: number | null
  resolvedShortRatio?: number | null
}) {
  const {
    supabase,
    code,
    stock,
    latest,
    realtimePrice,
    fund,
    chatId,
    creditShortProxy,
    hasRealCreditShort,
    perShareMetrics,
    resolvedCreditRatio,
    resolvedShortRatio,
  } = input
  const currentPrice = asNum(realtimePrice) ?? asNum(latest?.close ?? stock?.close)
  if (currentPrice == null) return null

  let fallbackScore: number | undefined
  let latestFactors: Record<string, any> | null = null

  try {
    const scoreResult = await fetchLatestScoresByCodes(supabase, [code])
    const latestScoreRow = scoreResult.byCode.get(code)
    latestFactors =
      latestScoreRow?.factors && typeof latestScoreRow.factors === 'object'
        ? (latestScoreRow.factors as Record<string, any>)
        : null

    const scoreNum = Number(
      latestScoreRow?.total_score ?? latestScoreRow?.momentum_score ?? NaN,
    )
    if (Number.isFinite(scoreNum)) fallbackScore = scoreNum
  } catch {
    // 점수 테이블 미존재/조회 실패 시 기술점수 없이 플랜만 계산
  }

  const fallbackFactors = scaleScoreFactorsToReferencePrice(
    {
      sma20: Number(latestFactors?.sma20 ?? stock?.sma20 ?? currentPrice),
      sma50: Number(latestFactors?.sma50 ?? stock?.sma50 ?? currentPrice),
      sma200: Number(latestFactors?.sma200 ?? currentPrice),
      rsi14: Number(latestFactors?.rsi14 ?? stock?.rsi14 ?? 50),
      roc14: Number(latestFactors?.roc14 ?? 0),
      roc21: Number(latestFactors?.roc21 ?? 0),
      avwap_support: Number(latestFactors?.avwap_support ?? 50),
      atr14: Number(latestFactors?.atr14 ?? 0),
      atr_pct: Number(latestFactors?.atr_pct ?? 0),
      vol_ratio: Number(latestFactors?.vol_ratio ?? 1),
      macd_cross:
        latestFactors?.macd_cross === 'golden' || latestFactors?.macd_cross === 'dead'
          ? latestFactors.macd_cross
          : 'none',
    },
    currentPrice,
    stock?.close,
  )

  const fundamentalScore = estimateFundamentalQuality(fund)
  const plan = buildInvestmentPlan({
    currentPrice,
    factors: fallbackFactors,
    technicalScore: fallbackScore,
    variantSeed: code,
    fundamental: {
      qualityScore: fundamentalScore,
      per: asNum(fund?.per) ?? undefined,
      pbr: asNum(fund?.pbr) ?? undefined,
      roe: asNum(fund?.roe) ?? undefined,
      peg: perShareMetrics.peg ?? undefined,
    },
  })

  const finalScore =
    fallbackScore !== undefined
      ? Number((fallbackScore * 0.8 + fundamentalScore * 0.2).toFixed(1))
      : undefined

  const proxyPenalty =
    !hasRealCreditShort && creditShortProxy
      ? creditShortProxy.level === 'high'
        ? 6
        : creditShortProxy.level === 'moderate'
          ? 3
          : 0
      : 0

  // resolvedCreditRatio/shortRatio: creditShort DB/live 값 우선, 없으면 stock 컬럼 fallback
  const realCreditShort = computeRealCreditShortAdjustment({
    creditRatio: resolvedCreditRatio !== undefined ? resolvedCreditRatio : asNum((stock as any)?.credit_ratio),
    shortRatio: resolvedShortRatio !== undefined ? resolvedShortRatio : asNum((stock as any)?.short_ratio),
  })

  const finalScoreAdjusted =
    finalScore != null
      ? Math.max(
          0,
          Math.min(
            100,
            Number((finalScore - proxyPenalty + (hasRealCreditShort ? realCreditShort.scoreAdj : 0)).toFixed(1)),
          ),
        )
      : null

  const normalizedSignal = resolveAdvisorSignal({
    currentPrice,
    finalScore: finalScoreAdjusted,
    technicalScore: fallbackScore ?? null,
    statusFromPlan: plan.status,
    entryLow: plan.entryLow,
    entryHigh: plan.entryHigh,
    stopPrice: plan.stopPrice,
    target1: plan.target1,
    riskReward: plan.riskReward,
    conviction: plan.conviction,
  })

  const twoStage = resolveTwoStageAction({
    signalStatus: normalizedSignal.status,
    finalScore: finalScoreAdjusted,
    technicalScore: fallbackScore ?? null,
    currentPrice,
    entryLow: plan.entryLow,
    entryHigh: plan.entryHigh,
    riskReward: plan.riskReward,
    conviction: plan.conviction,
    sma20: asNum(fallbackFactors?.sma20),
    sma50: asNum(fallbackFactors?.sma50),
  })

  let personalLines: string[] = []
  if (chatId) {
    personalLines = await (async () => {
      try {
        const { buildPersonalizedGuidance } = await import('../../src/services/personalizedGuidanceService.js')
        return await buildPersonalizedGuidance({
          chatId,
          focusCode: code,
          context: 'buy',
        })
      } catch {
        return []
      }
    })()
  }

  return {
    technicalScore: fallbackScore ?? null,
    fundamentalScore,
    finalScore: finalScoreAdjusted,
    status: normalizedSignal.status,
    statusLabel: normalizedSignal.statusLabel,
    signalReason: normalizedSignal.reason,
    twoStage,
    summary: plan.summary,
    entryLow: plan.entryLow,
    entryHigh: plan.entryHigh,
    stopPrice: plan.stopPrice,
    target1: plan.target1,
    target2: plan.target2,
    stopPct: plan.stopPct,
    target1Pct: plan.target1Pct,
    target2Pct: plan.target2Pct,
    holdDays: plan.holdDays,
    riskReward: plan.riskReward,
    rationale: plan.rationale,
    warnings: [
      ...(Array.isArray(plan.warnings) ? plan.warnings : []),
      ...(hasRealCreditShort
        ? realCreditShort.reasons
        : []),
      ...(!hasRealCreditShort && creditShortProxy && creditShortProxy.level !== 'low'
        ? [`신용/공매도 실데이터 부재: 프록시 과열 리스크 ${creditShortProxy.level === 'high' ? '높음' : '보통'}`]
        : []),
    ],
    personalLines,
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestOrigin = String(req.headers.origin || '').trim()
  const trustedOrigins = String(
    process.env.UI_TRUSTED_WEB_ORIGINS ||
    process.env.UI_CORS_ORIGIN ||
    'https://signal-scanner-web.vercel.app,http://localhost:5173',
  )
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
  const allowOrigin = requestOrigin && trustedOrigins.includes(requestOrigin)
    ? requestOrigin
    : (trustedOrigins[0] || ORIGIN || '*')

  res.setHeader('Access-Control-Allow-Origin', allowOrigin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const expectedReadKey = process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  const readKey = req.headers['x-ui-key'] || req.query.ui_key
  const isTrustedOrigin = !!requestOrigin && trustedOrigins.includes(requestOrigin)
  if (expectedReadKey && !isTrustedOrigin && String(readKey || '') !== expectedReadKey) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  if (!url || !key) return res.status(500).json({ error: 'Server not configured' })

  const supabase = createClient(url, key)
  const rawCode = String(req.query.code || '').trim().replace(/^A/i, '')
  const code = /^\d{1,6}$/.test(rawCode) ? rawCode.padStart(6, '0') : rawCode
  const chatId = toSafeChatId(req.query.chat_id || req.headers['x-user-chat-id'])
  if (!code) return res.status(400).json({ error: 'Missing code parameter' })

  try {
    const [series, stock, fundamentalsResp, flow, realtimeData, indicatorSnapshot, latestCreditShortDaily] = await Promise.all([
      fetchTimeSeries(supabase, code),
      fetchStockProfile(supabase, code),
      supabase
        .from('fundamentals')
        .select('as_of,per,pbr,eps,bps,roe,debt_ratio,computed')
        .eq('code', code)
        .order('as_of', { ascending: false })
        .limit(1),
      fetchInvestorFlow(supabase, code),
      fetchRealtimeStockData(code).catch(() => null),
      fetchLatestIndicators(supabase, code),
      fetchLatestCreditShortDaily(supabase, code),
    ])

    let fund: any = fundamentalsResp.data?.[0] || null

    const hasUsablePegInputs = (candidate: any): boolean => {
      const hasPer = asNum(candidate?.per) != null
      const hasStoredPeg = asNum(candidate?.peg) != null || asNum(candidate?.computed?.peg) != null
      const hasGrowth =
        asNum(candidate?.netIncomeForwardGrowthPct) != null ||
        asNum(candidate?.netIncomeGrowthPct) != null ||
        asNum(candidate?.computed?.netIncomeForwardGrowthPct) != null ||
        asNum(candidate?.computed?.netIncomeGrowthPct) != null ||
        asNum(candidate?.opIncomeGrowthPct) != null ||
        asNum(candidate?.computed?.opIncomeGrowthPct) != null ||
        asNum(candidate?.salesGrowthPct) != null ||
        asNum(candidate?.computed?.salesGrowthPct) != null
      return hasPer && (hasStoredPeg || hasGrowth)
    }

    // DB 데이터가 없거나 PEG 산출 재료가 부족하면 live 스크랩으로 보강
    if (!hasUsablePegInputs(fund)) {
      try {
        const scrapedFund = await getFundamentalSnapshot(code)
        if (scrapedFund && Object.keys(scrapedFund).length > 0) {
          const mergedComputed = {
            ...(typeof fund?.computed === 'object' && fund?.computed ? fund.computed : {}),
            netIncomeForwardGrowthPct: scrapedFund.netIncomeForwardGrowthPct ?? null,
            salesGrowthPct: scrapedFund.salesGrowthPct ?? null,
            opIncomeGrowthPct: scrapedFund.opIncomeGrowthPct ?? null,
            netIncomeGrowthPct: scrapedFund.netIncomeGrowthPct ?? null,
            qualityScore: scrapedFund.qualityScore ?? null,
            commentary: scrapedFund.commentary ?? null,
            peg: scrapedFund.peg ?? null,
            pegSource: scrapedFund.pegSource ?? null,
            pegGrowthPct: scrapedFund.pegGrowthPct ?? null,
          }

          fund = {
            ...(fund || {}),
            per: asNum(fund?.per) ?? scrapedFund.per ?? null,
            pbr: asNum(fund?.pbr) ?? scrapedFund.pbr ?? null,
            roe: asNum(fund?.roe) ?? scrapedFund.roe ?? null,
            debt_ratio: asNum(fund?.debt_ratio) ?? scrapedFund.debtRatio ?? null,
            eps: asNum(fund?.eps) ?? null,
            bps: asNum(fund?.bps) ?? null,
            as_of: fund?.as_of ?? new Date().toISOString(),
            netIncomeForwardGrowthPct:
              asNum(fund?.netIncomeForwardGrowthPct) ?? scrapedFund.netIncomeForwardGrowthPct ?? null,
            salesGrowthPct: asNum(fund?.salesGrowthPct) ?? scrapedFund.salesGrowthPct ?? null,
            opIncomeGrowthPct: asNum(fund?.opIncomeGrowthPct) ?? scrapedFund.opIncomeGrowthPct ?? null,
            netIncomeGrowthPct: asNum(fund?.netIncomeGrowthPct) ?? scrapedFund.netIncomeGrowthPct ?? null,
            peg: asNum(fund?.peg) ?? scrapedFund.peg ?? null,
            pegSource: fund?.pegSource ?? scrapedFund.pegSource ?? null,
            pegGrowthPct: asNum(fund?.pegGrowthPct) ?? scrapedFund.pegGrowthPct ?? null,
            computed: mergedComputed,
          }
          // 💾 Save scraped data to DB for future queries (non-blocking)
          void saveFundamentalSnapshot(supabase, code, scrapedFund)
        }
      } catch (e: any) {
        // Silent fallback - if scraping fails, just proceed with null
        console.warn(`Fallback scraping failed for ${code}:`, e?.message)
      }
    }

    const normalizedSeries = sanitizeTimeSeries(series)
    if (!normalizedSeries.length && stock) {
      normalizedSeries.push({
        date: toIsoDate(stock.updated_at),
        open: null,
        high: null,
        low: null,
        close: asNum(stock.close),
        volume: null,
        value: null,
      })
    }

    // 공매도/신용: DB 우선, 없으면 live 스크래핑 fallback
    const dbCreditRatio =
      asNum((stock as any)?.credit_ratio) ??
      asNum((latestCreditShortDaily as any)?.credit_ratio)
    const dbShortRatio =
      asNum((stock as any)?.short_ratio) ??
      asNum((latestCreditShortDaily as any)?.short_ratio)
    const dbShortBalance =
      asNum((stock as any)?.short_balance) ??
      asNum((latestCreditShortDaily as any)?.short_balance)
    const hasDbCreditShort = dbCreditRatio != null || dbShortRatio != null

    let creditShort: {
      creditRatio: number | null
      shortRatio: number | null
      shortBalance: number | null
      source: 'db' | 'live' | 'proxy'
      proxyRisk: CreditShortProxy | null
    } | null = null

    const proxyRisk = computeCreditShortProxy({
      stock,
      latest: normalizedSeries[0] || null,
      series: normalizedSeries,
      flow,
    })

    if (hasDbCreditShort) {
      creditShort = {
        creditRatio: dbCreditRatio,
        shortRatio: dbShortRatio,
        shortBalance: dbShortBalance,
        source: 'db',
        proxyRisk: null,
      }
    } else {
      // ETL 아직 미실행 또는 migration 미적용 → 실시간 스크래핑 fallback
      const live = await fetchCreditShortSnapshot(code).catch(() => null)
      if (live && (live.creditRatio != null || live.shortRatio != null || live.shortBalance != null)) {
        creditShort = {
          creditRatio: live.creditRatio,
          shortRatio: live.shortRatio,
          shortBalance: live.shortBalance,
          source: 'live',
          proxyRisk: null,
        }
      } else {
        creditShort = {
          creditRatio: null,
          shortRatio: null,
          shortBalance: null,
          source: 'proxy',
          proxyRisk,
        }
      }
    }

    const latest = normalizedSeries[0] || null
    const realtimePrice = asNum(realtimeData?.price)
    const fallbackClose = asNum(latest?.close ?? (stock as any)?.close)
    const hasRealtimePrice = realtimePrice != null && realtimePrice > 0
    const currentPrice = hasRealtimePrice ? realtimePrice : fallbackClose
    const priceMeta = {
      source: hasRealtimePrice ? 'realtime' : 'close',
      marketStatus: realtimeData?.marketStatus ?? null,
      fetchedAt: hasRealtimePrice ? toIsoDate(realtimeData?.fetchedAt) : null,
    }

    const resolvedPer = asNum((stock as any)?.per) ?? asNum(fund?.per)
    const resolvedPbr = asNum((stock as any)?.pbr) ?? asNum(fund?.pbr)
    const resolvedEps = asNum((stock as any)?.eps) ?? asNum(fund?.eps)
    const resolvedBps = asNum((stock as any)?.bps) ?? asNum(fund?.bps)
    const resolvedPeg =
      asNum((stock as any)?.peg) ??
      asNum((fund as any)?.peg) ??
      asNum((fund as any)?.computed?.peg)
    const netIncomeForwardGrowthPct =
      asNum((fund as any)?.netIncomeForwardGrowthPct) ??
      asNum((fund as any)?.computed?.netIncomeForwardGrowthPct)
    const salesGrowthPct =
      asNum((fund as any)?.salesGrowthPct) ??
      asNum((fund as any)?.computed?.salesGrowthPct)
    const opIncomeGrowthPct =
      asNum((fund as any)?.opIncomeGrowthPct) ??
      asNum((fund as any)?.computed?.opIncomeGrowthPct)
    const netIncomeGrowthPct =
      asNum((fund as any)?.net_income_growth_pct) ??
      asNum((fund as any)?.netIncomeGrowthPct) ??
      asNum((fund as any)?.computed?.netIncomeGrowthPct)

    const resolvedSma20 = asNum((stock as any)?.sma20) ?? asNum(indicatorSnapshot?.sma20)
    const resolvedSma50 = asNum((stock as any)?.sma50) ?? asNum(indicatorSnapshot?.sma50)
    const resolvedSma200 =
      asNum((stock as any)?.sma200) ??
      asNum(indicatorSnapshot?.sma200) ??
      computeSmaFromSeries(normalizedSeries, 200)
    const resolvedSma240 = computeSmaFromSeries(normalizedSeries, 240)
    const resolvedSma244 = computeSmaFromSeries(normalizedSeries, 244)
    const resolvedEma20 = computeEmaFromSeries(normalizedSeries, 20)
    const resolvedEma50 = computeEmaFromSeries(normalizedSeries, 50)
    const resolvedEma200 = computeEmaFromSeries(normalizedSeries, 200)
    const resolvedEma240 = computeEmaFromSeries(normalizedSeries, 240)
    const resolvedEma244 = computeEmaFromSeries(normalizedSeries, 244)
    const resolvedRsi14 = asNum((stock as any)?.rsi14) ?? asNum(indicatorSnapshot?.rsi14)
    const resolvedForeignRatio =
      asNum((stock as any)?.foreign_ratio ?? (stock as any)?.foreigner_ratio) ??
      asNum(realtimeData?.foreignRatio)

    const perShareMetrics = derivePerShareMetrics({
      price: currentPrice,
      per: resolvedPer,
      pbr: resolvedPbr,
      eps: resolvedEps,
      bps: resolvedBps,
      peg: resolvedPeg,
      netIncomeForwardGrowthPct,
      salesGrowthPct,
      opIncomeGrowthPct,
      netIncomeGrowthPct,
    })

    const mergedFundForAdvisor = {
      ...(fund || {}),
      per: resolvedPer,
      pbr: resolvedPbr,
      eps: perShareMetrics.eps,
      bps: perShareMetrics.bps,
      peg: perShareMetrics.peg,
    }

    const advisor = await buildAdvisorPayload({
      supabase,
      code,
      stock,
      latest,
      realtimePrice,
      fund: mergedFundForAdvisor,
      chatId,
      creditShortProxy: creditShort?.proxyRisk ?? null,
      hasRealCreditShort: !!creditShort && creditShort.source !== 'proxy',
      perShareMetrics,
        resolvedCreditRatio: creditShort?.creditRatio ?? null,
        resolvedShortRatio: creditShort?.shortRatio ?? null,
    })

    return res.status(200).json({
      data: normalizedSeries,
      latest: latest
        ? {
            ...latest,
            close: currentPrice,
          }
        : null,
      price_meta: priceMeta,
      profile: stock
        ? {
            code: stock.code,
            name: stock.name,
            sector_id: stock.sector_id,
            description: stock.description,
            close: currentPrice,
            updated_at: toIsoDate(stock.updated_at),
            market_cap: asNum((stock as any).market_cap),
            per: resolvedPer,
            pbr: resolvedPbr,
            eps: perShareMetrics.eps,
            bps: perShareMetrics.bps,
            peg: perShareMetrics.peg,
            peg_meta: perShareMetrics.pegMeta,
            foreign_ratio: resolvedForeignRatio,
            fundamentals_as_of: fund?.as_of ?? null,
            roe: asNum(fund?.roe),
            debt_ratio: asNum(fund?.debt_ratio),
            sma20: resolvedSma20,
            sma50: resolvedSma50,
            sma200: resolvedSma200,
            sma240: resolvedSma240,
            sma244: resolvedSma244,
            ema20: resolvedEma20,
            ema50: resolvedEma50,
            ema200: resolvedEma200,
            ema240: resolvedEma240,
            ema244: resolvedEma244,
            rsi14: resolvedRsi14,
            price_source: priceMeta.source,
            price_market_status: priceMeta.marketStatus,
            price_fetched_at: priceMeta.fetchedAt,
          }
        : null,
      flow: flow
        ? {
            date: flow.date,
            metric: flow.metric,
            personal: asNum(flow.personal),
            foreign: asNum(flow.foreign),
            institution: asNum(flow.institution),
            personal_amount: asNum(flow.personal_amount),
            foreign_amount: asNum(flow.foreign_amount),
            institution_amount: asNum(flow.institution_amount),
            personal_volume: asNum(flow.personal_volume),
            foreign_volume: asNum(flow.foreign_volume),
            institution_volume: asNum(flow.institution_volume),
          }
        : null,
      creditShort: creditShort
        ? {
            creditRatio: creditShort.creditRatio,
            shortRatio: creditShort.shortRatio,
            shortBalance: creditShort.shortBalance,
            source: creditShort.source,
            proxyRisk: creditShort.proxyRisk,
          }
        : null,
      advisor,
    })
  } catch (e: any) {
    return res.status(500).json({ error: String(e) })
  }
}
