import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'

function asNum(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || ORIGIN
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key')
  res.setHeader('Access-Control-Allow-Credentials', 'true')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const code = String(req.query.code || '').trim()
  if (!code) return res.status(400).json({ error: 'code 파라미터가 필요합니다.' })

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  if (!url || !key) return res.status(500).json({ error: 'Server not configured' })

  const supabase = createClient(url, key)

  try {
    // 병렬 조회
    const [stockRes, scoreRes, indicatorRes, pullbackRes] = await Promise.all([
      supabase
        .from('stocks')
        .select('code,name,market,sector_id,close')
        .eq('code', code)
        .maybeSingle(),

      supabase
        .from('scores')
        .select('code,asof,total_score,signal,factors')
        .eq('code', code)
        .order('asof', { ascending: false })
        .limit(1)
        .maybeSingle(),

      supabase
        .from('daily_indicators')
        .select('code,trade_date,close,rsi14,sma20,sma50,sma200,roc21,atr14')
        .eq('code', code)
        .order('trade_date', { ascending: false })
        .limit(1)
        .maybeSingle(),

      supabase
        .from('pullback_signals')
        .select('code,trade_date,entry_grade,entry_score,warn_grade,warn_score,dist_pct,ma21,ma50')
        .eq('code', code)
        .order('trade_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const stock = stockRes.data
    const score = scoreRes.data
    const ind = indicatorRes.data
    const pb = pullbackRes.data

    if (!stock && !score && !ind) {
      return res.status(404).json({ error: '해당 종목 데이터를 찾을 수 없습니다.' })
    }

    // rsi14: daily_indicators 우선, 없으면 scores.factors 에서
    const rsi14 =
      asNum(ind?.rsi14) ??
      asNum((score?.factors as Record<string, unknown> | null | undefined)?.rsi14)

    return res.status(200).json({
      ok: true,
      data: {
        code,
        name: stock?.name ?? null,
        market: stock?.market ?? null,
        sector_id: stock?.sector_id ?? null,
        close: asNum(stock?.close ?? ind?.close),

        // 점수 / 시그널
        score_date: score?.asof ?? null,
        total_score: asNum(score?.total_score),
        signal: score?.signal ? String(score.signal).toUpperCase() : null,

        // 기술 지표
        indicator_date: ind?.trade_date ?? null,
        rsi14,
        sma20: asNum(ind?.sma20),
        sma50: asNum(ind?.sma50),
        sma200: asNum(ind?.sma200),
        roc21: asNum(ind?.roc21),
        atr14: asNum(ind?.atr14),

        // 눌림목 신호
        pullback_date: pb?.trade_date ?? null,
        entry_grade: pb?.entry_grade ?? null,
        entry_score: asNum(pb?.entry_score),
        warn_grade: pb?.warn_grade ?? null,
        warn_score: asNum(pb?.warn_score),
        dist_pct: asNum(pb?.dist_pct),
      },
    })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
