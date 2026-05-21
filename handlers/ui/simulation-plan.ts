import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { resolveUiUserContext } from './_userContext'
import { buildAudienceKey, getKstDateKey, REPORT_SNAPSHOT_TABLE } from '../../src/services/reportSnapshotService'

const TOPIC = '시뮬레이션계획'

type PlanItem = {
  code: string
  name: string
  sector_id?: string | null
  amount: number
  targetPct: number
  stopPct: number
  winProb: number
  split1: number
  split2: number
  split3: number
}

type PlanPayload = {
  createdAt: number
  totalCapital: number
  notes?: string
  items: PlanItem[]
}

function sanitizeNumber(value: unknown, fallback = 0): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return n
}

function normalizePlan(raw: any): PlanPayload {
  const itemsRaw = Array.isArray(raw?.items) ? raw.items : []
  const items = itemsRaw.slice(0, 20).map((it: any) => ({
    code: String(it?.code || '').trim().slice(0, 20),
    name: String(it?.name || '').trim().slice(0, 80),
    sector_id: it?.sector_id != null ? String(it.sector_id).slice(0, 80) : null,
    amount: Math.max(0, sanitizeNumber(it?.amount, 0)),
    targetPct: sanitizeNumber(it?.targetPct, 5),
    stopPct: Math.max(0, sanitizeNumber(it?.stopPct, 3)),
    winProb: Math.min(100, Math.max(0, sanitizeNumber(it?.winProb, 55))),
    split1: Math.max(0, sanitizeNumber(it?.split1, 40)),
    split2: Math.max(0, sanitizeNumber(it?.split2, 35)),
    split3: Math.max(0, sanitizeNumber(it?.split3, 25)),
  }))

  return {
    createdAt: Math.max(0, sanitizeNumber(raw?.createdAt, Date.now())),
    totalCapital: Math.max(0, sanitizeNumber(raw?.totalCapital, 0)),
    notes: String(raw?.notes || '').slice(0, 500),
    items,
  }
}

function parseBodyText(raw: unknown): PlanPayload | null {
  try {
    const parsed = JSON.parse(String(raw || '{}'))
    return normalizePlan(parsed)
  } catch {
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || process.env.UI_CORS_ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key,x-user-chat-id')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  if (req.method === 'OPTIONS') return res.status(204).end()

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
    if (!user.chatId) return res.status(400).json({ error: 'chat_id required' })

    const audienceKey = buildAudienceKey(user.chatId)

    if (req.method === 'GET') {
      const mode = String(req.query.mode || 'latest').trim().toLowerCase()
      const limit = Math.max(1, Math.min(30, Number(req.query.limit || 10)))

      if (mode === 'history') {
        const { data, error } = await supabase
          .from(REPORT_SNAPSHOT_TABLE)
          .select('topic,audience_key,report_date,body_text,source_label,updated_at,created_at')
          .eq('topic', TOPIC)
          .eq('audience_key', audienceKey)
          .order('report_date', { ascending: false })
          .order('updated_at', { ascending: false })
          .limit(limit)

        // 테이블 미존재 시 빈 배열 반환 (우아한 실패)
        if (error && error.message.includes('Could not find the table')) {
          return res.status(200).json({ ok: true, data: [] })
        }
        if (error) return res.status(500).json({ error: error.message })

        const rows = (data || []).map((row: any) => ({
          reportDate: String(row.report_date || ''),
          updatedAt: String(row.updated_at || row.created_at || ''),
          sourceLabel: String(row.source_label || ''),
          plan: parseBodyText(row.body_text),
        }))

        return res.status(200).json({ ok: true, data: rows })
      }

      const { data, error } = await supabase
        .from(REPORT_SNAPSHOT_TABLE)
        .select('report_date,body_text,source_label,updated_at,created_at')
        .eq('topic', TOPIC)
        .eq('audience_key', audienceKey)
        .order('report_date', { ascending: false })
        .order('updated_at', { ascending: false })
        .limit(1)

      // 테이블 미존재 시 null 반환 (우아한 실패)
      if (error && error.message.includes('Could not find the table')) {
        return res.status(200).json({ ok: true, data: null })
      }
      if (error) return res.status(500).json({ error: error.message })

      const first = data && data[0]
      if (!first) return res.status(200).json({ ok: true, data: null })

      return res.status(200).json({
        ok: true,
        data: {
          reportDate: String(first.report_date || ''),
          updatedAt: String(first.updated_at || first.created_at || ''),
          sourceLabel: String(first.source_label || ''),
          plan: parseBodyText(first.body_text),
        },
      })
    }

    if (req.method === 'POST') {
      const plan = normalizePlan((req.body || {}).plan || req.body || {})
      if (!plan.items.length) {
        return res.status(400).json({ error: 'at least one item is required' })
      }

      const reportDate = getKstDateKey(new Date(plan.createdAt || Date.now()))
      const bodyText = JSON.stringify(plan)

      const { error } = await supabase
        .from(REPORT_SNAPSHOT_TABLE)
        .upsert(
          {
            topic: TOPIC,
            audience_key: audienceKey,
            report_date: reportDate,
            body_text: bodyText,
            source_label: 'web-simulator',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'topic,audience_key,report_date' },
        )

      // 테이블 미존재 시에도 성공으로 처리 (향후 마이그레이션 시 저장될 수 있도록)
      if (error && error.message.includes('Could not find the table')) {
        return res.status(200).json({ ok: true, reportDate, warning: 'Snapshot table not available yet' })
      }
      if (error) return res.status(500).json({ error: error.message })

      return res.status(200).json({ ok: true, reportDate })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
