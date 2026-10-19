import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { denyIfUnauthorizedRead } from './_accessControl'
import { fetchEtfKeyIndicators } from '../../src/services/etfKeyIndicator'
import { fetchEtfMarketSums } from '../../src/services/etfMarketList'
import { summarizeIndexEtfMetrics, TRADING_VALUE_WINDOW, type DailyValueBar } from '../../src/lib/indexEtfMetrics'

/** 모아가기 후보 ETF 지표 — GET ?codes=069500,102110,... (최대 30개). 공개 시장 데이터라 신원은 받지 않는다 */
const MAX_CODES = 30

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (denyIfUnauthorizedRead(req, res)) return

  const codes = [...new Set(String(req.query.codes || '').split(',').map((c) => c.trim()).filter((c) => /^[0-9A-Z]{6}$/.test(c)))]
  if (!codes.length) return res.status(400).json({ error: 'Missing codes' })
  if (codes.length > MAX_CODES) return res.status(400).json({ error: `Too many codes (max ${MAX_CODES})` })

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  if (!url || !key) return res.status(500).json({ error: 'Server not configured' })
  const supabase = createClient(url, key)

  try {
    // 거래일 20개 ≒ 달력 45일. 종목 30개 × 30여 행이라 1000행 상한을 넘을 수 있어 끝까지 읽는다
    const since = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10)
    const bars: DailyValueBar[] = []
    for (let off = 0; ; off += 1000) {
      const { data, error } = await supabase
        .from('stock_daily')
        .select('ticker, date, value, volume, close')
        .in('ticker', codes)
        .gte('date', since)
        .order('ticker')
        .order('date')
        .range(off, off + 999)
      // 조회 실패를 "거래 없음"으로 내보내지 않는다 — 웹은 실패 시 고정 스냅샷을 쓴다
      if (error) return res.status(503).json({ error: `stock_daily 조회 실패: ${error.message}` })
      bars.push(...((data ?? []) as DailyValueBar[]))
      if (!data || data.length < 1000) break
    }
    const [indicators, marketSums] = await Promise.all([fetchEtfKeyIndicators(codes), fetchEtfMarketSums()])
    const out = summarizeIndexEtfMetrics(codes, indicators, bars, marketSums)
    res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=3600')
    return res.status(200).json({ data: { ...out, window: TRADING_VALUE_WINDOW } })
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  }
}
