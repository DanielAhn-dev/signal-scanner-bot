import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { denyIfUnauthorizedRead } from './_accessControl'
import { resolveUiUserContext } from './_userContext'
import { kstDateKey } from '../../src/services/virtualAutoTradeTiming'
import { loadGoalFile } from '../../src/services/goalTracker'
import { fetchRealtimePriceBatch, type RealtimeStockData } from '../../src/utils/fetchRealtimePrice'
import {
  DEFAULT_INCOME_GUIDE_SETTINGS,
  appendHistory,
  buildIncomeGuideView,
  compareWithHistory,
  healthTrend,
  sanitizeIncomeGuideSettings,
  toHistoryEntry,
  type GuideHistoryEntry,
  type GuideHolding,
  type IncomeGuideSettings,
} from '../../src/lib/incomeGuide'

const BUCKET = 'market-snapshots'
const DIR = 'income-guide'

type GuideFile = { settings: IncomeGuideSettings; history: GuideHistoryEntry[] }

// 실계좌 리밸런싱 가이드 (src/lib/incomeGuide.ts)
//   GET  ?contribution=원 — 계좌 보유로 안내 계산 (넣을 돈이 있으면 모자란 바구니부터 채우는 안도)
//   POST { ...설정 } — 가이드 설정 변경 / POST { action: 'record', note } — 오늘 비중을 점검 기록에 남김
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
    let file = await loadFile(supabase, path)
    if (!file) {
      // 처음 열면 목표 트래커의 월 목표를 기본값으로 쓴다 (따로 두 번 입력하지 않게)
      const goal = await loadGoalFile(supabase, chatId).catch(() => null)
      file = {
        settings: {
          ...DEFAULT_INCOME_GUIDE_SETTINGS,
          ...(goal?.settings.targetMonthlyProfit ? { monthlyNeed: goal.settings.targetMonthlyProfit } : {}),
        },
        history: [],
      }
    }
    const body = req.method === 'POST' ? ((typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body) ?? {}) : {}
    const isRecord = req.method === 'POST' && body.action === 'record'
    if (req.method === 'POST' && !isRecord) {
      file.settings = sanitizeIncomeGuideSettings(body, file.settings)
      const saveErr = await saveFile(supabase, path, file)
      if (saveErr) return res.status(500).json({ error: `가이드 설정 저장 실패: ${saveErr}` })
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
        avgPrice: buy > 0 ? buy : null,
        accountKey: `${broker}|${account}`,
        accountLabel: label || '계좌',
      }
    })

    const contribution = Number((req.query?.contribution as string) ?? body.contribution ?? 0)
    const view = buildIncomeGuideView({ holdings, settings: file.settings, today: kstDateKey(), contribution })
    if (isRecord) {
      if (view.total <= 0) return res.status(400).json({ error: '기록할 계좌 보유가 없습니다.' })
      file.history = appendHistory(file.history ?? [], toHistoryEntry(view, typeof body.note === 'string' ? body.note : undefined))
      const saveErr = await saveFile(supabase, path, file)
      if (saveErr) return res.status(500).json({ error: `점검 기록 저장 실패: ${saveErr}` })
    }
    const history = file.history ?? []
    return res.status(200).json({
      ok: true,
      data: { ...view, priceFallbacks, history, comparison: compareWithHistory(view, history), health: healthTrend(view, history) },
    })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}

async function loadFile(supabase: any, path: string): Promise<GuideFile | null> {
  // Storage CDN이 옛 내용을 돌려주지 않게 매번 캐시를 우회한다 (goalTracker와 같은 이유)
  const { data, error } = await supabase.storage.from(BUCKET).download(path, { cacheNonce: String(Date.now()) })
  if (error || !data) return null
  try {
    const parsed = JSON.parse(await data.text()) as { settings?: Partial<IncomeGuideSettings>; history?: GuideHistoryEntry[] }
    if (!parsed.settings) return null
    return {
      settings: sanitizeIncomeGuideSettings(parsed.settings, DEFAULT_INCOME_GUIDE_SETTINGS),
      history: Array.isArray(parsed.history) ? parsed.history : [],
    }
  } catch {
    return null
  }
}

async function saveFile(supabase: any, path: string, file: GuideFile): Promise<string | null> {
  const { error } = await supabase.storage.from(BUCKET).upload(path, JSON.stringify(file), {
    upsert: true,
    contentType: 'application/json',
    cacheControl: '0',
  })
  return error ? String(error.message) : null
}
