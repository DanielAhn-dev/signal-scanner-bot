import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  denyIfUnauthorizedRead,
  evaluateAdvancedAccess,
  getSupabaseAdminForUi,
  resolveRequesterIdentity,
  setUiCorsHeaders,
} from './_accessControl'
import { buildCohortReport, type CohortTrade, type CohortUser } from '../../src/services/cohortAnalysis'

const PAGE = 1000
const MAX_PAGES = 30

/** 관리자 전용 — 사용자별 조건(시드·성향·전략 방식·체결 시간대)에 따른 가상 매매 성과 비교 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  setUiCorsHeaders(req, res, 'GET,OPTIONS')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (denyIfUnauthorizedRead(req, res)) return

  const identity = await resolveRequesterIdentity(req)
  const access = await evaluateAdvancedAccess(identity)
  if (!access.isAdmin) return res.status(403).json({ error: 'Admin only' })

  const supabase = getSupabaseAdminForUi()
  if (!supabase) return res.status(500).json({ error: 'Server not configured' })

  const windowDays = Math.max(14, Math.min(365, Number(req.query.windowDays || 120) || 120))
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString()

  try {
    const trades: CohortTrade[] = []
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const { data, error } = await supabase
        .from('virtual_trades')
        .select('chat_id, side, pnl_amount, gross_amount, traded_at, account_name, broker_name')
        .eq('side', 'SELL')
        .gte('traded_at', since)
        .order('traded_at', { ascending: true })
        .range(page * PAGE, page * PAGE + PAGE - 1)
      if (error) return res.status(500).json({ error: error.message })
      for (const row of data ?? []) {
        // 실계좌에 직접 입력한 거래는 가상 매매 비교에서 뺀다
        if (row.account_name === '실계좌' || row.broker_name === '직접 입력') continue
        trades.push({
          chatId: Number(row.chat_id),
          side: 'SELL',
          pnlAmount: row.pnl_amount === null ? null : Number(row.pnl_amount),
          grossAmount: row.gross_amount === null ? null : Number(row.gross_amount),
          tradedAt: String(row.traded_at),
        })
      }
      if (!data || data.length < PAGE) break
    }

    const chatIds = Array.from(new Set(trades.map((t) => t.chatId).filter((id) => Number.isFinite(id) && id > 0)))
    const users: CohortUser[] = []
    for (let i = 0; i < chatIds.length; i += 200) {
      const { data, error } = await supabase
        .from('users')
        .select('tg_id, prefs')
        .in('tg_id', chatIds.slice(i, i + 200))
      if (error) return res.status(500).json({ error: error.message })
      for (const row of data ?? []) {
        const prefs = (row.prefs ?? {}) as Record<string, unknown>
        const seed = Number(prefs.virtual_seed_capital ?? prefs.capital_krw ?? 0)
        users.push({
          chatId: Number(row.tg_id),
          seedCapital: Number.isFinite(seed) && seed > 0 ? seed : 0,
          riskProfile: typeof prefs.risk_profile === 'string' ? prefs.risk_profile : null,
          strategyMode: typeof prefs.virtual_strategy_mode === 'string' ? prefs.virtual_strategy_mode : null,
        })
      }
    }

    return res.status(200).json({ data: buildCohortReport({ users, trades, windowDays }) })
  } catch (e: unknown) {
    return res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  }
}
