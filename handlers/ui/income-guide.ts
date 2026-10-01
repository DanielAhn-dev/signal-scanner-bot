import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { denyIfUnauthorizedRead } from './_accessControl'
import { resolveUiUserContext } from './_userContext'
import { kstDateKey } from '../../src/services/virtualAutoTradeTiming'
import { loadGoalFile } from '../../src/services/goalTracker'
import { fetchRealtimePriceBatch, type RealtimeStockData } from '../../src/utils/fetchRealtimePrice'
import {
  DEFAULT_INCOME_GUIDE_SETTINGS,
  buildIncomeGuideView,
  sanitizeIncomeGuideSettings,
  type GuideHolding,
  type IncomeGuideSettings,
} from '../../src/lib/incomeGuide'

const BUCKET = 'market-snapshots'
const DIR = 'income-guide'

// 실계좌 리밸런싱 가이드 (src/lib/incomeGuide.ts) — GET: 계좌 보유로 안내 계산 / POST: 가이드 설정 변경
// 계좌 보유 = virtual_positions 중 증권사·계좌명이 있는 행("계좌/보유 추가"로 입력). 봇 가상 계좌는 넣지 않는다.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || process.env.UI_CORS_ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key,x-user-chat-id,Authorization')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (denyIfUnauthorizedRead(req, res)) return

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return res.status(500).json({ error: 'Server not configured' })
  const supabase = createClient(url, key, { auth: { persistSession: false } })

  const user = await resolveUiUserContext(req)
  const chatId = user.chatId
  if (!chatId) return res.status(400).json({ error: 'chat_id required' })

  try {
    const path = `${DIR}/${chatId}.json`
    let settings = await loadSettings(supabase, path)
    if (!settings) {
      // 처음 열면 목표 트래커의 월 목표·목표 시점을 기본값으로 쓴다 (따로 두 번 입력하지 않게)
      const goal = await loadGoalFile(supabase, chatId).catch(() => null)
      settings = {
        ...DEFAULT_INCOME_GUIDE_SETTINGS,
        ...(goal?.settings.targetMonthlyProfit ? { monthlyNeed: goal.settings.targetMonthlyProfit } : {}),
      }
    }
    if (req.method === 'POST') {
      const patch = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body) ?? {}
      settings = sanitizeIncomeGuideSettings(patch, settings)
      const { error } = await supabase.storage.from(BUCKET).upload(path, JSON.stringify({ settings }), {
        upsert: true,
        contentType: 'application/json',
        cacheControl: '0',
      })
      if (error) return res.status(500).json({ error: `가이드 설정 저장 실패: ${error.message}` })
    }

    const { data, error } = await supabase
      .from('virtual_positions')
      .select('code, quantity, buy_price, status, broker_name, account_name, stock:stocks(name, close)')
      .eq('chat_id', chatId)
      .gt('quantity', 0)
      .or('broker_name.not.is.null,account_name.not.is.null')
    if (error) return res.status(500).json({ error: error.message })

    const rows = ((data ?? []) as any[]).filter((r) => String(r.status ?? 'holding') !== 'closed')
    const codes = Array.from(new Set(rows.map((r) => String(r.code || '').trim()).filter(Boolean)))
    // ETF는 stocks.close가 비어 있는 경우가 많아 실시간가를 먼저 쓴다 (없으면 종가, 그다음 매수가)
    const realtime = codes.length
      ? await fetchRealtimePriceBatch(codes).catch(() => ({} as Record<string, RealtimeStockData>))
      : {}
    let priceFallbacks = 0
    const holdings: GuideHolding[] = rows.map((r) => {
      const code = String(r.code || '').trim()
      const stock = Array.isArray(r.stock) ? r.stock[0] : r.stock
      const rt = Number(realtime[code]?.price)
      const close = Number(stock?.close)
      const buy = Number(r.buy_price)
      const price = rt > 0 ? rt : close > 0 ? close : buy > 0 ? buy : 0
      if (!(rt > 0)) priceFallbacks += 1
      const broker = String(r.broker_name ?? '').trim()
      const account = String(r.account_name ?? '').trim()
      const label = [broker, account].filter(Boolean).join(' / ')
      return {
        code,
        name: String(stock?.name ?? code),
        quantity: Math.max(0, Math.floor(Number(r.quantity ?? 0))),
        price,
        accountKey: `${broker}|${account}`,
        accountLabel: label || '계좌',
      }
    })

    const view = buildIncomeGuideView({ holdings, settings, today: kstDateKey() })
    return res.status(200).json({ ok: true, data: { ...view, priceFallbacks } })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}

async function loadSettings(supabase: any, path: string): Promise<IncomeGuideSettings | null> {
  // Storage CDN이 옛 내용을 돌려주지 않게 매번 캐시를 우회한다 (goalTracker와 같은 이유)
  const { data, error } = await supabase.storage.from(BUCKET).download(path, { cacheNonce: String(Date.now()) })
  if (error || !data) return null
  try {
    const parsed = JSON.parse(await data.text()) as { settings?: Partial<IncomeGuideSettings> }
    return parsed.settings ? sanitizeIncomeGuideSettings(parsed.settings, DEFAULT_INCOME_GUIDE_SETTINGS) : null
  } catch {
    return null
  }
}
