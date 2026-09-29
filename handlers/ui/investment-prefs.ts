import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { resolveUiUserContext } from './_userContext'
import { INDEX_HOLD_MODE, normalizeStrategyMode } from '../../src/services/indexHoldStrategy'
import {
  nextDepositDate,
  normalizeDepositDay,
  normalizeMonthlyDeposit,
  readDepositLog,
  readDepositSettings,
  resolveLastDepositMonthOnSave,
} from '../../src/services/monthlyDeposit'
import { toKstDateKey } from '../../src/lib/krxCalendar'

function toPositiveInt(raw: unknown): number | null {
  const num = Number(String(raw ?? '').trim())
  if (!Number.isFinite(num) || num <= 0) return null
  return Math.trunc(num)
}

function resolveTargetChatId(req: VercelRequest, userChatId: number | null): number | null {
  const body = (req.body || {}) as any
  return (
    userChatId
    || toPositiveInt(req.headers['x-user-chat-id'])
    || toPositiveInt(req.query.chat_id)
    || toPositiveInt(req.query.chatId)
    || toPositiveInt(body.chat_id)
    || toPositiveInt(body.chatId)
    || null
  )
}

/** 설정 화면에 보여 줄 월 입금 정보 */
function depositView(prefs: Record<string, unknown>) {
  const settings = readDepositSettings(prefs)
  const seed = Number(prefs.virtual_seed_capital)
  const total = Number(prefs.virtual_total_deposited)
  return {
    monthly_deposit: settings.monthlyDeposit,
    deposit_day: settings.depositDay,
    next_deposit_date: nextDepositDate(settings, toKstDateKey()),
    // 예전 계정은 총 원금 기록이 없다 — 시드를 원금으로 보여 준다
    total_deposited: Number.isFinite(total) && total > 0 ? total : Number.isFinite(seed) && seed > 0 ? seed : null,
    deposit_log: readDepositLog(prefs).slice(-12).reverse(),
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || process.env.UI_CORS_ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key,x-user-chat-id,x-user-client-id,Authorization')
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
    const targetChatId = resolveTargetChatId(req, user.chatId)

    if (req.method === 'GET') {
      if (!targetChatId) return res.status(200).json({ data: null })

      const { data, error } = await supabase
        .from('users')
        .select('prefs')
        .eq('tg_id', targetChatId)
        .maybeSingle()

      if (error) return res.status(500).json({ error: error.message })

      const prefs = (data?.prefs || {}) as Record<string, unknown>
      const virtualSeedCapital = Number(prefs.virtual_seed_capital)
      const rawCash = prefs.virtual_cash
      const virtualCash = rawCash != null ? Number(rawCash) : null
      const capitalKrw = Number(prefs.capital_krw)

      return res.status(200).json({
        data: {
          virtual_seed_capital: Number.isFinite(virtualSeedCapital) && virtualSeedCapital > 0 ? virtualSeedCapital : null,
          virtual_cash: virtualCash != null && Number.isFinite(virtualCash) && virtualCash >= 0 ? virtualCash : null,
          capital_krw: Number.isFinite(capitalKrw) && capitalKrw > 0 ? capitalKrw : null,
          strategy_mode: normalizeStrategyMode(prefs.virtual_strategy_mode),
          ...depositView(prefs),
        }
      })
    }

    if (req.method === 'POST') {
      if (!targetChatId) return res.status(400).json({ error: 'chat_id required' })

      const body = req.body || {}

      // 월 자동 입금 설정만 바꾸는 요청 (src/services/monthlyDeposit.ts)
      if (body.monthly_deposit !== undefined && body.virtual_seed_capital === undefined) {
        const amount = normalizeMonthlyDeposit(body.monthly_deposit)
        if (amount === null) return res.status(400).json({ error: '월 입금액은 0(적립 안 함) 또는 1만원 이상이어야 합니다' })
        const depositDay = normalizeDepositDay(body.deposit_day)
        const { data: depRow } = await supabase.from('users').select('prefs').eq('tg_id', targetChatId).maybeSingle()
        const current = ((depRow?.prefs as Record<string, unknown>) || {}) as Record<string, unknown>
        const next: Record<string, unknown> = {
          ...current,
          virtual_monthly_deposit: amount,
          virtual_deposit_day: depositDay,
          virtual_last_deposit_month: resolveLastDepositMonthOnSave({
            depositDay,
            previousLastDepositMonth: readDepositSettings(current).lastDepositMonth,
            todayKey: toKstDateKey(),
          }),
        }
        const { error: depError } = await supabase.from('users').upsert({ tg_id: targetChatId, prefs: next }, { onConflict: 'tg_id' })
        if (depError) return res.status(500).json({ error: depError.message })
        return res.status(200).json({ data: depositView(next) })
      }

      // 자동매매 방식만 바꾸는 요청 (종목 봇 ↔ 지수 보유, src/services/indexHoldStrategy.ts)
      if (body.strategy_mode !== undefined && body.virtual_seed_capital === undefined) {
        const mode = body.strategy_mode === INDEX_HOLD_MODE ? INDEX_HOLD_MODE : body.strategy_mode === 'stock' ? 'stock' : null
        if (!mode) return res.status(400).json({ error: 'strategy_mode must be stock or index_hold' })
        const { data: modeRow } = await supabase
          .from('users')
          .select('prefs')
          .eq('tg_id', targetChatId)
          .maybeSingle()
        const modePrefs = { ...((modeRow?.prefs as Record<string, unknown>) || {}), virtual_strategy_mode: mode }
        const { error: modeError } = await supabase
          .from('users')
          .upsert({ tg_id: targetChatId, prefs: modePrefs }, { onConflict: 'tg_id' })
        if (modeError) return res.status(500).json({ error: modeError.message })
        return res.status(200).json({ data: { strategy_mode: mode } })
      }

      const newSeedCapital = toPositiveInt(body.virtual_seed_capital)
      const resetCash = body.reset_cash === true || body.reset_cash === 'true'

      if (newSeedCapital === null) {
        return res.status(400).json({ error: 'virtual_seed_capital must be a positive integer' })
      }

      // Merge into existing prefs
      const { data: userRow } = await supabase
        .from('users')
        .select('prefs')
        .eq('tg_id', targetChatId)
        .maybeSingle()

      const currentPrefs = ((userRow?.prefs as Record<string, unknown>) || {}) as Record<string, unknown>
      const updatedPrefs: Record<string, unknown> = {
        ...currentPrefs,
        virtual_seed_capital: newSeedCapital,
      }

      // 처음 시드를 정하는 계정은 현금도 시드로 시작한다 — 비어 있으면 계좌로 인식되지 않는다
      // 새로 시작하는 것이므로 넣은 원금·입금 내역도 시드부터 다시 센다
      if (resetCash || currentPrefs.virtual_cash == null) {
        updatedPrefs.virtual_cash = newSeedCapital
        updatedPrefs.virtual_total_deposited = newSeedCapital
        updatedPrefs.virtual_deposit_log = []
      }

      // update는 행이 없으면 0건 갱신으로 조용히 끝난다 — 웹 전용 계정처럼 행이 아직 없을 수 있어 upsert
      const { error: upsertError } = await supabase
        .from('users')
        .upsert({ tg_id: targetChatId, prefs: updatedPrefs }, { onConflict: 'tg_id' })

      if (upsertError) return res.status(500).json({ error: upsertError.message })

      const virtualCashFinal = Number(updatedPrefs.virtual_cash)
      return res.status(200).json({
        data: {
          virtual_seed_capital: newSeedCapital,
          virtual_cash: Number.isFinite(virtualCashFinal) && virtualCashFinal >= 0 ? virtualCashFinal : null,
        }
      })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e: any) {
    return res.status(500).json({ error: String(e) })
  }
}
