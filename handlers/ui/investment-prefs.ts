import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { isStrictIdentity, resolveUiUserContext } from './_userContext'
import { normalizeStrategyMode } from '../../src/services/indexHoldStrategy'
import { logUserDecision } from './_userDecisionLog'
import {
  applyManualDeposit,
  nextDepositDate,
  normalizeManualDeposit,
  readDepositLog,
  readDepositSettings,
} from '../../src/services/monthlyDeposit'
import { ADMIN_ONLY_SATELLITE, investPlanPrefsPatch, mergeInvestPlan, readInvestPlan } from '../../src/services/userPlan'
import { evaluateAdvancedAccess, resolveRequesterIdentity } from './_accessControl'
import { toKstDateKey } from '../../src/lib/krxCalendar'
import { normalizeNotifyChannel } from '../../src/services/notifyChannel'
import { readLifeProfile, sanitizeLifeInput } from '../../src/services/goalTracker'

function toPositiveInt(raw: unknown): number | null {
  const num = Number(String(raw ?? '').trim())
  if (!Number.isFinite(num) || num <= 0) return null
  return Math.trunc(num)
}

function resolveTargetChatId(req: VercelRequest, userChatId: number | null): number | null {
  if (isStrictIdentity()) return userChatId
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
          // 내 계획 — 방향을 바꾸는 유일한 저장 경로 (src/services/userPlan.ts)
          plan: readInvestPlan(prefs),
          notify_channel: normalizeNotifyChannel(prefs.notify_channel),
          // 프로필의 나이·은퇴 시점 (목표 트래커가 은퇴 나이에 맞춰 계산한다)
          life: readLifeProfile(prefs),
          ...depositView(prefs),
        }
      })
    }

    if (req.method === 'POST') {
      if (!targetChatId) return res.status(400).json({ error: 'chat_id required' })

      const body = req.body || {}

      // 알림 받을 곳만 바꾸는 요청 (src/services/notifyChannel.ts)
      if (body.notify_channel !== undefined && body.virtual_seed_capital === undefined) {
        if (body.notify_channel !== 'telegram' && body.notify_channel !== 'push') {
          return res.status(400).json({ error: 'notify_channel must be telegram or push' })
        }
        const { data: chRow } = await supabase.from('users').select('prefs').eq('tg_id', targetChatId).maybeSingle()
        const chPrefs = { ...((chRow?.prefs as Record<string, unknown>) || {}), notify_channel: body.notify_channel }
        const { error: chError } = await supabase.from('users').upsert({ tg_id: targetChatId, prefs: chPrefs }, { onConflict: 'tg_id' })
        if (chError) return res.status(500).json({ error: chError.message })
        return res.status(200).json({ data: { notify_channel: body.notify_channel } })
      }

      // 나이·은퇴 시점만 바꾸는 요청 — 출생 연월(YYYY-MM)과 은퇴 나이. 출생 연월을 비우면 지운다 (src/services/goalTracker.ts)
      if (body.life_profile !== undefined && body.virtual_seed_capital === undefined) {
        const lp = (body.life_profile ?? {}) as { birthMonth?: unknown; retireAge?: unknown }
        const parsed = sanitizeLifeInput(lp, toKstDateKey())
        if (!parsed.ok) return res.status(400).json({ error: parsed.error })
        const { data: lifeRow } = await supabase.from('users').select('prefs').eq('tg_id', targetChatId).maybeSingle()
        const lifePrefs: Record<string, unknown> = { ...((lifeRow?.prefs as Record<string, unknown>) || {}) }
        if (parsed.value) {
          lifePrefs.life_birth_month = parsed.value.birthMonth
          lifePrefs.life_retire_age = parsed.value.retireAge
        } else {
          delete lifePrefs.life_birth_month
          delete lifePrefs.life_retire_age
        }
        const { error: lifeError } = await supabase.from('users').upsert({ tg_id: targetChatId, prefs: lifePrefs }, { onConflict: 'tg_id' })
        if (lifeError) return res.status(500).json({ error: lifeError.message })
        return res.status(200).json({ data: { life: parsed.value } })
      }

      // 직접 입금: 금액이 들쭉날쭉한 추가 입금을 그때그때 가상 현금·시드에 더한다 (src/services/monthlyDeposit.ts)
      if (body.manual_deposit !== undefined && body.virtual_seed_capital === undefined) {
        const amount = normalizeManualDeposit(body.manual_deposit)
        if (amount === null) return res.status(400).json({ error: '입금액은 1만원 이상 10억원 이하로 입력하세요' })
        const { data: manRow } = await supabase.from('users').select('prefs').eq('tg_id', targetChatId).maybeSingle()
        const current = ((manRow?.prefs as Record<string, unknown>) || {}) as Record<string, unknown>
        // 시드가 없으면 입금할 계좌가 없다 — 입금이 시드를 새로 만들어 버리지 않게 막는다
        if (!(Number(current.virtual_seed_capital) > 0) || current.virtual_cash == null) {
          return res.status(400).json({ error: '가상 계좌(시드)가 아직 없습니다. 먼저 시드를 설정하세요' })
        }
        const next: Record<string, unknown> = { ...current, ...applyManualDeposit({ prefs: current, amount, todayKey: toKstDateKey() }) }
        const { error: manError } = await supabase.from('users').upsert({ tg_id: targetChatId, prefs: next }, { onConflict: 'tg_id' })
        if (manError) return res.status(500).json({ error: manError.message })
        return res.status(200).json({ data: { ...depositView(next), virtual_cash: Number(next.virtual_cash), virtual_seed_capital: Number(next.virtual_seed_capital) } })
      }

      // 내 계획: 매달 투자할 돈·급여일·넣는 날·버틸 하락폭·개별주 몫 중 바꿀 칸만 받는다 (src/services/userPlan.ts).
      // 실험 계좌의 월 입금·자동매매 방식은 여기서만 바뀐다 — 예전엔 설정·시작하기·목표 트래커·시드 만들기가 따로 썼다.
      if (body.plan !== undefined && body.virtual_seed_capital === undefined) {
        if (!body.plan || typeof body.plan !== 'object') return res.status(400).json({ error: 'plan must be an object' })
        const { data: planRow, error: planReadError } = await supabase.from('users').select('prefs').eq('tg_id', targetChatId).maybeSingle()
        if (planReadError) return res.status(500).json({ error: planReadError.message })
        const current = ((planRow?.prefs as Record<string, unknown>) || {}) as Record<string, unknown>
        const before = readInvestPlan(current)
        const merged = mergeInvestPlan(before, body.plan)
        if (!merged.ok) return res.status(400).json({ error: merged.error })
        // 실험(종목 봇 전체)은 관리자만 새로 고를 수 있다 — 데이터를 쌓아 규칙을 고치는 쪽이고, 일반 사용자는 검증된 쪽을 따른다
        if (merged.value.satellitePct === ADMIN_ONLY_SATELLITE && before.satellitePct !== ADMIN_ONLY_SATELLITE) {
          const access = await evaluateAdvancedAccess(await resolveRequesterIdentity(req))
          if (!access.isAdmin) return res.status(403).json({ error: '실험 선택지는 관리자만 고를 수 있습니다' })
        }
        const next: Record<string, unknown> = { ...current, ...investPlanPrefsPatch(merged.value, current, toKstDateKey()) }
        const { error: planError } = await supabase.from('users').upsert({ tg_id: targetChatId, prefs: next }, { onConflict: 'tg_id' })
        if (planError) return res.status(500).json({ error: planError.message })
        const prevMode = normalizeStrategyMode(current.virtual_strategy_mode)
        const nextMode = normalizeStrategyMode(next.virtual_strategy_mode)
        if (prevMode !== nextMode) await logUserDecision(supabase, targetChatId, 'mode-switch', { from: prevMode, to: nextMode })
        return res.status(200).json({ data: { plan: readInvestPlan(next), strategy_mode: nextMode, ...depositView(next) } })
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
