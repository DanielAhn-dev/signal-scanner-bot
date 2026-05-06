import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

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
  foreign: number | null
  institution: number | null
}

function asNum(v: unknown): number | null {
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
          .limit(60)
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
    'code,name,sector_id,close,updated_at,description,market_cap,per,pbr,eps,bps,foreign_ratio',
    'code,name,sector_id,close,updated_at,description,market_cap,per,pbr,eps,bps,foreigner_ratio',
    'code,name,sector_id,close,updated_at,description,market_cap,per,pbr,eps,bps',
    'code,name,sector_id,close,updated_at,description',
    'code,name,sector_id,close,updated_at',
    'code,name,sector_id,close,updated_at,description,market_cap,per,pbr,eps,bps,foreign_ratio,sma20,sma50,rsi14',
    'code,name,sector_id,close,updated_at,description,market_cap,per,pbr,eps,bps,foreigner_ratio,sma20,sma50,rsi14',
    'code,name,sector_id,close,updated_at,description,market_cap,per,pbr,eps,bps,foreign_ratio',
    'code,name,sector_id,close,updated_at,description,market_cap,per,pbr,eps,bps,foreigner_ratio',
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

async function fetchInvestorFlow(supabase: any, code: string): Promise<InvestorFlowRow | null> {
  const attempts = [
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
        return {
          date: row?.date ?? null,
          foreign: asNum(row?.foreign ?? row?.foreign_net),
          institution: asNum(row?.institution ?? row?.institution_net),
        }
      }
    } catch {
      // continue
    }
  }

  return null
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
  const code = String(req.query.code || '').trim()
  if (!code) return res.status(400).json({ error: 'Missing code parameter' })

  try {
    const [series, stock, fundamentalsResp, flow] = await Promise.all([
      fetchTimeSeries(supabase, code),
      fetchStockProfile(supabase, code),
      supabase
        .from('fundamentals')
        .select('as_of,per,pbr,eps,bps,roe,debt_ratio')
        .eq('code', code)
        .order('as_of', { ascending: false })
        .limit(1),
      fetchInvestorFlow(supabase, code),
    ])

    const fund = fundamentalsResp.data?.[0] || null

    const normalizedSeries = [...series]
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

    const latest = normalizedSeries[0] || null

    return res.status(200).json({
      data: normalizedSeries,
      latest,
      profile: stock
        ? {
            code: stock.code,
            name: stock.name,
            sector_id: stock.sector_id,
            description: stock.description,
            close: asNum(stock.close),
            updated_at: toIsoDate(stock.updated_at),
            market_cap: asNum((stock as any).market_cap),
            per: asNum((stock as any).per) ?? asNum(fund?.per),
            pbr: asNum((stock as any).pbr) ?? asNum(fund?.pbr),
            eps: asNum((stock as any).eps) ?? asNum(fund?.eps),
            bps: asNum((stock as any).bps) ?? asNum(fund?.bps),
            foreign_ratio: asNum((stock as any).foreign_ratio ?? (stock as any).foreigner_ratio),
            fundamentals_as_of: fund?.as_of ?? null,
            roe: asNum(fund?.roe),
            debt_ratio: asNum(fund?.debt_ratio),
            sma20: asNum((stock as any).sma20),
            sma50: asNum((stock as any).sma50),
            rsi14: asNum((stock as any).rsi14),
          }
        : null,
      flow: flow
        ? {
            date: flow.date,
            foreign: asNum(flow.foreign),
            institution: asNum(flow.institution),
          }
        : null,
    })
  } catch (e: any) {
    return res.status(500).json({ error: String(e) })
  }
}
