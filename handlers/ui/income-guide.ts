import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { denyIfUnauthorizedRead } from './_accessControl'
import { resolveUiUserContext } from './_userContext'
import { kstDateKey } from '../../src/services/virtualAutoTradeTiming'
import { loadGoalFile } from '../../src/services/goalTracker'
import {
  fetchGuidePrices,
  fetchYieldPctByCode,
  loadAccountPositionRows,
  loadGuideFile,
  saveGuideFile,
  toGuideHoldings,
} from '../../src/services/incomeGuideStore'
import {
  DEFAULT_INCOME_GUIDE_SETTINGS,
  appendHistory,
  buildIncomeGuideView,
  compareWithHistory,
  healthTrend,
  sanitizeIncomeGuideSettings,
  toHistoryEntry,
  withMonthlyEntry,
} from '../../src/lib/incomeGuide'
import { buildGuidePlanSnapshot } from '../../src/services/guidePlanSnapshot'
import { buildAdherence } from '../../src/lib/guideAdherence'
import { readOwnUserState } from './user-state'
import { MAX_RECEIPTS, estimateReinvest, monthSummary, sanitizeReceipt } from '../../src/lib/distributionReceipts'

// 실계좌 리밸런싱 가이드 (src/lib/incomeGuide.ts, 저장은 src/services/incomeGuideStore.ts)
//   GET  ?contribution=원 — 계좌 보유로 안내 계산 (넣을 돈이 있으면 모자란 바구니부터 채우는 안도)
//   GET  ?summary=1 — 보유 수·직접 남긴 점검 기록 수만 (홈 길잡이용, 시세 조회 없음)
//   POST { ...설정 } — 가이드 설정 변경 / POST { action: 'record', note } — 오늘 비중을 점검 기록에 남김
//   POST { action: 'receipt-add', receipt: { month, code, name, quantity, perShare, net? } } / { action: 'receipt-delete', id } — 분배금 받은 기록
//   POST { action: 'adherence-exclude', key, exclude } — 가이드 따름 판정에서 빼기/되돌리기
// 이번 달 기록이 없으면 열 때 자동 기록을 하나 남긴다(매월 배치 scripts/income_guide_monthly.ts와 같은 규칙).
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
    let file = await loadGuideFile(supabase, chatId)
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
    // 홈 '다음 할 일' 판정용 가벼운 조회 — 시세를 받지 않고 보유 수와 직접 남긴 점검 기록 수만 준다(자동 기록은 세지 않음)
    if (req.method === 'GET' && req.query?.summary === '1') {
      const rows = await loadAccountPositionRows(supabase, chatId)
      const manualRecords = (file.history ?? []).filter((h) => !h.auto).length
      return res.status(200).json({ ok: true, data: { holdingCount: rows.length, manualRecords } })
    }
    const body = req.method === 'POST' ? ((typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body) ?? {}) : {}
    const isRecord = req.method === 'POST' && body.action === 'record'
    const isReceipt = req.method === 'POST' && (body.action === 'receipt-add' || body.action === 'receipt-delete')
    const isExclude = req.method === 'POST' && body.action === 'adherence-exclude'
    if (isExclude) {
      // 가이드 따름 판정에서 빼기/되돌리기 (입력 실수·다른 이유) — 기록 자체는 지우지 않는다
      const k = String(body.key ?? '').slice(0, 80)
      if (!/^\d{4}-\d{2}-\d{2}\|[\w.-]+$/.test(k)) return res.status(400).json({ error: '판정 키가 올바르지 않습니다.' })
      const set = new Set(file.adherenceExcluded ?? [])
      if (body.exclude === false) set.delete(k)
      else set.add(k)
      file = { ...file, adherenceExcluded: [...set].slice(-500) }
      const saveErr = await saveGuideFile(supabase, chatId, file)
      if (saveErr) return res.status(500).json({ error: `판정 저장 실패: ${saveErr}` })
    } else if (isReceipt) {
      const receipts = [...(file.receipts ?? [])]
      if (body.action === 'receipt-add') {
        const r = sanitizeReceipt(body.receipt, new Date().toISOString(), () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`)
        if (typeof r === 'string') return res.status(400).json({ error: r })
        // 같은 달·같은 종목을 다시 적으면 고친 것으로 본다(두 번 눌러 쌓이지 않게)
        const i = receipts.findIndex((x) => x.month === r.month && x.code === r.code)
        if (i >= 0) receipts[i] = { ...r, id: receipts[i].id }
        else receipts.push(r)
      } else {
        const i = receipts.findIndex((x) => x.id === String(body.id ?? ''))
        if (i < 0) return res.status(404).json({ error: '지울 기록이 없습니다.' })
        receipts.splice(i, 1)
      }
      file = { ...file, receipts: receipts.slice(-MAX_RECEIPTS) }
      const saveErr = await saveGuideFile(supabase, chatId, file)
      if (saveErr) return res.status(500).json({ error: `분배금 기록 저장 실패: ${saveErr}` })
    } else if (req.method === 'POST' && !isRecord && !isExclude) {
      file.settings = sanitizeIncomeGuideSettings(body, file.settings)
      // 예수금 칸을 저장한 날 — 값이 같아도 '지금 확인한 숫자'로 본다(분배금 재투자 추정이 최신 예수금인지 판단)
      if ('cashByAccount' in body || 'cashBalance' in body) file.settings = { ...file.settings, cashUpdatedAt: kstDateKey() }
      const saveErr = await saveGuideFile(supabase, chatId, file)
      if (saveErr) return res.status(500).json({ error: `가이드 설정 저장 실패: ${saveErr}` })
    }

    const rows = await loadAccountPositionRows(supabase, chatId)
    // 지난 기록의 종목(지금은 판 종목 포함)과 지난 안내 상품도 시세를 받아 "가만히 뒀다면"·"안내대로였다면"을 계산한다
    const pastCodes = (file.history ?? []).flatMap((h) => [...(h.holdings ?? []).map((x) => x.code), ...(h.advice?.buy ?? []).map((x) => x.code)])
    const { prices, realtimeHits } = await fetchGuidePrices(supabase, [...rows.map((r) => r.code), ...pastCodes])
    const { holdings, priceFallbacks } = toGuideHoldings(rows, prices, realtimeHits)

    const today = kstDateKey()
    const contribution = Number((req.query?.contribution as string) ?? body.contribution ?? 0)
    const pastCashPcts = (file.history ?? []).map((h) => h.groups?.find((g) => g.group === 'cash')?.actualPct ?? 0)
    const yieldPctByCode = await fetchYieldPctByCode(holdings)
    const view = buildIncomeGuideView({ holdings, settings: file.settings, today, contribution, pastCashPcts, yieldPctByCode })
    // 계획(같은 지수 상품 비교 포함)과 그달 안내 — 기록에 안내·가격을 같이 남긴다(월 배치와 같은 계산)
    const { plan, projection, advice, entryPrices } = await buildGuidePlanSnapshot({ supabase, file, view, yieldPctByCode, today, prices, alternativesTimeoutMs: 6_000 })
    let history = file.history ?? []
    if (isRecord) {
      if (view.total <= 0) return res.status(400).json({ error: '기록할 계좌 보유가 없습니다.' })
      history = appendHistory(history, toHistoryEntry(view, typeof body.note === 'string' ? body.note : undefined, { holdings, advice, prices: entryPrices }))
      const saveErr = await saveGuideFile(supabase, chatId, { ...file, history })
      if (saveErr) return res.status(500).json({ error: `점검 기록 저장 실패: ${saveErr}` })
    } else {
      const next = withMonthlyEntry(history, view, holdings, { advice, prices: entryPrices })
      // 자동 기록 저장이 실패해도 화면은 그대로 보여 준다 (다음에 열 때 다시 시도)
      if (next && !(await saveGuideFile(supabase, chatId, { ...file, history: next }))) history = next
    }
    // 분배금 받은 기록 → 이번 달 합계와 다음 달 예상(기록 없는 종목은 분배율 추정, 일반 계좌는 15.4% 뗌)
    const receipts = file.receipts ?? []
    const month = today.slice(0, 7)
    const prevMonth = (() => { const [y, m] = month.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}` })()
    const yearAgoMonth = (() => { const [y, m] = month.split('-').map(Number); return m === 12 ? `${y}-01` : `${y - 1}-${String(m + 1).padStart(2, '0')}` })()
    const ctx = { settings: file.settings, today, priceOf: (code: string) => prices.get(code) }
    // 이번 달 월입금 — 모아가기 '이번 달 넣었어요' 체크인(user-state 'accumulate'.deposits). 받은 분배금이 있을 때만 읽는다
    let deposit: number | null = 0
    if (monthSummary(receipts, month).net > 0) {
      const state = await readOwnUserState(supabase, user).catch(() => null)
      const deposits = (state?.accumulate?.value as { deposits?: Array<[string, number]> } | null | undefined)?.deposits
      deposit = state == null ? null : Number((Array.isArray(deposits) ? deposits : []).find((d) => Array.isArray(d) && d[0] === month)?.[1]) || 0
    }
    return res.status(200).json({
      ok: true,
      data: {
        ...view,
        plan,
        // 'distributions'(금융소득 상한)는 view에 이미 있다 — 이름을 따로 둔다
        distributionReceipts: {
          thisMonth: monthSummary(receipts, month),
          lastMonth: monthSummary(receipts, prevMonth),
          projection,
          // 최근 12개월 — 화면이 달별로 묶어 지난달 대비 증감을 보여 준다
          recent: receipts.filter((r) => r.month >= yearAgoMonth).sort((a, b) => b.month.localeCompare(a.month) || b.createdAt.localeCompare(a.createdAt)),
          // 받은 분배금 중 매수에 쓰인 몫 — 예수금 변화로 거꾸로 추정(따로 적지 않아도 되게)
          reinvest: estimateReinvest({ receipts, history, cashNow: view.cashPlan.balance, cashUpdatedAt: file.settings.cashUpdatedAt, deposit, today }),
        },
        // 가이드 따름 기록 — 안내와 다음 기록의 보유 변화 비교 (내 선택 돌아보기)
        adherence: buildAdherence({ history, today, priceOf: (code) => prices.get(code), receipts, excluded: file.adherenceExcluded }),
        priceFallbacks,
        history, comparison: compareWithHistory(view, history, ctx), health: healthTrend(view, history, ctx) },
    })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
