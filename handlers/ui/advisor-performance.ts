import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { resolveUiUserContext } from './_userContext'
import { getDecisionReliabilitySummary } from '../../src/services/decisionLogService'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || process.env.UI_CORS_ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key,x-user-chat-id')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const readKey = req.headers['x-ui-key'] || req.query.ui_key || process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  if (!readKey || String(readKey) !== (process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  if (!url || !key) return res.status(500).json({ error: 'Server not configured' })

  const supabase = createClient(url, key)

  try {
    const user = await resolveUiUserContext(req)
    const chatId = user.chatId
    if (!chatId) return res.status(200).json({ data: null })

    const windowDays = Math.max(14, Math.min(365, Number(req.query.windowDays || 90)))
    const summary = await getDecisionReliabilitySummary(Number(chatId), windowDays)

    const { data: recentLogs, error: logsError } = await supabase
      .from('virtual_decision_logs')
      .select('id, code, action, confidence, reason_summary, strategy_version, linked_trade_id, decision_at')
      .eq('chat_id', Number(chatId))
      .order('decision_at', { ascending: false })
      .limit(12)

    if (logsError) return res.status(500).json({ error: logsError.message })

    const decisionIds = Array.from(new Set((recentLogs ?? []).map((row: any) => Number(row?.id || 0)).filter((id: number) => id > 0)))
    const tradeIds = Array.from(new Set((recentLogs ?? []).map((row: any) => Number(row?.linked_trade_id || 0)).filter((id: number) => id > 0)))

    const { data: outcomes } = decisionIds.length
      ? await supabase
          .from('virtual_decision_outcomes')
          .select('decision_id, horizon_days, realized_return_pct, label, evaluated_at')
          .in('decision_id', decisionIds)
      : { data: [] as any[] }

    const { data: trades } = tradeIds.length
      ? await supabase
          .from('virtual_trades')
          .select('id, side, pnl_amount, traded_at, broker_name, account_name')
          .in('id', tradeIds)
      : { data: [] as any[] }

    const outcomesByDecision = new Map<number, any[]>()
    for (const row of outcomes ?? []) {
      const id = Number((row as any).decision_id || 0)
      if (!id) continue
      const prev = outcomesByDecision.get(id) ?? []
      prev.push(row)
      outcomesByDecision.set(id, prev)
    }

    const tradeById = new Map<number, any>()
    for (const row of trades ?? []) {
      const id = Number((row as any).id || 0)
      if (!id) continue
      tradeById.set(id, row)
    }

    const recent = (recentLogs ?? []).map((row: any) => {
      const trade = tradeById.get(Number(row?.linked_trade_id || 0))
      const linkedOutcomes = outcomesByDecision.get(Number(row?.id || 0)) ?? []
      return {
        id: row.id,
        code: row.code,
        action: row.action,
        confidence: row.confidence,
        reason_summary: row.reason_summary,
        strategy_version: row.strategy_version,
        decision_at: row.decision_at,
        trade: trade
          ? {
              side: trade.side,
              pnl_amount: trade.pnl_amount,
              traded_at: trade.traded_at,
              broker_name: trade.broker_name,
              account_name: trade.account_name,
            }
          : null,
        outcomes: linkedOutcomes,
      }
    })

    return res.status(200).json({
      data: {
        summary,
        recent,
      },
    })
  } catch (e: any) {
    return res.status(500).json({ error: String(e) })
  }
}
