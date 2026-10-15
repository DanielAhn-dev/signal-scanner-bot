import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { setUiCorsHeaders } from './_accessControl'
import { resolveUiUserContext } from './_userContext'
import { partnerSharing } from '../../src/services/household'
import { MAX_TOTAL_SLOTS, UNRECORDED_CATEGORY_ID, categoryById, learnKeyword, type FlowCheckInput, type FlowItem, type IrregularItem, type MonthTotal } from '../../src/lib/moneyFlow'

const maxAmount = 100_000_000_000
const maxEntriesPerPost = 50
const maxCheckItems = 80
const cutLevels = ['must', 'trim', 'drop'] as const
const payments = ['cash', 'point_regular', 'point_once', 'refund_regular', 'refund_once'] as const
const forWhoms = ['shared', 'me', 'partner'] as const
type ForWhom = (typeof forWhoms)[number]
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function amount(value: unknown, min = 0): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > maxAmount) return null
  return value
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function kstToday(now = new Date()): string {
  return now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
}

// 빠른 기록 한 건. 미래 날짜는 받지 않는다(예정 지출은 점검의 비정기 항목으로).
export function normalizeFlowEntry(body: any, now = new Date()) {
  if (!validDate(body?.date) || body.date > kstToday(now)) return null
  const value = amount(body.amount, 1)
  if (value === null) return null
  const memo = body.memo ?? ''
  if (typeof memo !== 'string' || memo.length > 100) return null
  // '세부 안 적음'은 월 합계 차액용이라 세부 기록에는 쓰지 않는다
  if (typeof body.categoryId !== 'string' || !categoryById(body.categoryId) || body.categoryId === UNRECORDED_CATEGORY_ID) return null
  const cut = body.cut ?? null
  if (cut !== null && !cutLevels.includes(cut)) return null
  const payment = body.payment ?? 'cash'
  if (!payments.includes(payment)) return null
  const mustPart = body.mustPart ?? null
  if (mustPart !== null && (amount(mustPart) === null || mustPart > value)) return null
  // 누구 몫은 보내는 사람 기준(shared/me/partner), 기본은 공용. 저장은 기록한 사람 기준 — 상대 기록을 고칠 때는 핸들러가 뒤집는다
  const forWhom = body.forWhom ?? 'shared'
  if (!forWhoms.includes(forWhom)) return null
  // 무엇으로 냈나: card(월 합계 칸 안) | cash(현금·계좌이체 — 합계에 더함). 기본은 카드
  const paidWith = body.paidWith ?? 'card'
  if (paidWith !== 'card' && paidWith !== 'cash') return null
  return { spent_on: body.date, amount: value, memo: memo.trim(), category_id: body.categoryId, cut_level: cut, must_part: mustPart, payment, for_whom: forWhom as ForWhom, paid_with: paidWith as 'card' | 'cash' }
}

function normalizeItem(raw: any): FlowItem | null {
  if (typeof raw?.categoryId !== 'string' || !categoryById(raw.categoryId)) return null
  const value = amount(raw.amount)
  if (value === null) return null
  const payment = raw.payment ?? 'cash'
  const cut = raw.cut ?? undefined
  const mustPart = raw.mustPart ?? undefined
  const label = raw.label ?? ''
  if (!payments.includes(payment) || (cut !== undefined && !cutLevels.includes(cut))) return null
  if (mustPart !== undefined && (amount(mustPart) === null || mustPart > value)) return null
  if (typeof label !== 'string' || label.length > 40) return null
  const childId = raw.childId ?? undefined
  if (childId !== undefined && (typeof childId !== 'string' || childId.length === 0 || childId.length > 40)) return null
  // 카드 밖(계좌 자동이체) 표시 — 고정지출에서만 의미가 있다
  const outsideCard = raw.outsideCard ?? false
  if (typeof outsideCard !== 'boolean') return null
  return { categoryId: raw.categoryId, amount: value, payment, cut, mustPart, label: label.trim(), ...(childId ? { childId } : {}), ...(outsideCard ? { outsideCard: true } : {}) }
}

function normalizeIrregular(raw: any): IrregularItem | null {
  const item = normalizeItem({ ...raw, amount: raw?.yearlyAmount })
  if (!item) return null
  if (!Array.isArray(raw.months) || raw.months.length > 12 || raw.months.some((m: unknown) => typeof m !== 'number' || !Number.isInteger(m) || m < 1 || m > 12)) return null
  return { categoryId: item.categoryId, label: item.label ?? '', yearlyAmount: item.amount, months: [...new Set<number>(raw.months)].sort((a, b) => a - b), payment: item.payment, cut: item.cut, mustPart: item.mustPart }
}

// 지금 상태 점검 저장. 입력만 저장하고 결과는 화면이 moneyFlow.evaluateFlowCheck로 다시 계산한다.
export function normalizeFlowCheck(body: any, now = new Date()): { checked_on: string; label: string; input: FlowCheckInput } | null {
  const date = body?.date ?? kstToday(now)
  if (!validDate(date) || date > kstToday(now)) return null
  const label = body?.label ?? ''
  if (typeof label !== 'string' || label.length > 40) return null
  const raw = body?.input
  const income = amount(raw?.monthlyIncome)
  const reserve = amount(raw?.reserveMonthly ?? 0)
  if (income === null || reserve === null) return null
  const lists = [raw?.fixed ?? [], raw?.variable ?? [], raw?.irregular ?? []]
  if (lists.some((list) => !Array.isArray(list)) || lists.reduce((sum, list) => sum + list.length, 0) > maxCheckItems) return null
  const fixed = lists[0].map(normalizeItem)
  const variable = lists[1].map(normalizeItem)
  const irregular = lists[2].map(normalizeIrregular)
  if ([...fixed, ...variable, ...irregular].some((item) => item === null)) return null
  return {
    checked_on: date, label: label.trim(),
    input: { monthlyIncome: income, reserveMonthly: reserve, fixed: fixed as FlowItem[], variable: variable as FlowItem[], irregular: irregular as IrregularItem[] },
  }
}

/**
 * 월 합계 저장 요청. 이용월 기준(YYYY-MM)이고 이번 달 이후는 받지 않는다.
 * 칸 이름은 겹치지 않아야 하고, 빈 목록이면 그 달 합계를 지운다는 뜻이다.
 */
export function normalizeMonthTotals(body: any, now = new Date()): { month: string; totals: MonthTotal[] } | null {
  const month = body?.month
  if (typeof month !== 'string' || !validDate(`${month}-01`) || month > kstToday(now).slice(0, 7)) return null
  if (!Array.isArray(body.totals) || body.totals.length > MAX_TOTAL_SLOTS) return null
  const totals: MonthTotal[] = []
  for (const raw of body.totals) {
    const label = typeof raw?.label === 'string' ? raw.label.trim() : ''
    const value = amount(raw?.amount)
    if (!label || label.length > 20 || value === null || (raw.kind !== 'cash' && raw.kind !== 'point')) return null
    if (totals.some((t) => t.label === label)) return null
    totals.push({ label, kind: raw.kind, amount: value })
  }
  return { month, totals }
}

/** 마이그레이션 전: PostgREST가 테이블을 모를 때(PGRST205) 또는 Postgres 42P01 */
export function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === 'PGRST205' || error?.code === '42P01'
}

export function toMonthTotal(row: any, viewer: string) {
  return { month: String(row.month).slice(0, 7), label: row.label, kind: row.kind, amount: Number(row.amount), mine: row.client_id === viewer }
}

const entryColumns = 'id,client_id,spent_on,amount,memo,category_id,cut_level,must_part,payment,for_whom,paid_with,updated_by_client_id,deleted_at,deleted_by_client_id'

/**
 * 보는 사람 기준으로 바꾼다. client_id는 내보내지 않고 '나/배우자'로만 알린다. 기록한 사람이 아닌 쪽이 고쳤을 때만 editedBy를 준다.
 * forWhom(누구 몫)도 보는 사람 기준: 배우자가 자기 것으로 적은 건 내 화면에서 '배우자', 나를 위해 적은 건 '나'. 공용은 그대로
 */
export function toEntry(row: any, viewer: string) {
  const who = (id: string | null) => (id ? (id === viewer ? 'me' : 'partner') : null)
  const mine = row.client_id === viewer
  return {
    id: row.id, mine, forWhom: flipForWhom(row.for_whom ?? 'shared', mine), date: String(row.spent_on).slice(0, 10), amount: Number(row.amount), memo: row.memo, categoryId: row.category_id,
    cut: row.cut_level ?? null, mustPart: row.must_part == null ? null : Number(row.must_part), payment: row.payment, paidWith: row.paid_with === 'cash' ? 'cash' : 'card',
    editedBy: row.updated_by_client_id && row.updated_by_client_id !== row.client_id ? who(row.updated_by_client_id) : null,
    deletedBy: row.deleted_at ? who(row.deleted_by_client_id ?? row.client_id) : null,
  }
}

/** 기록한 사람 기준 ↔ 보는 사람 기준. 남의 기록이면 나/배우자를 맞바꾸고 공용은 그대로 둔다(자기 자신이 역함수) */
function flipForWhom(value: ForWhom, sameSide: boolean): ForWhom {
  if (sameSide || value === 'shared') return value
  return value === 'me' ? 'partner' : 'me'
}

/** 보는 사람이 고른 '누구 몫'을 기록한 사람 기준으로 바꾼다 — 배우자 기록을 고칠 때 뒤집힌다(toEntry의 반대) */
export function storedForWhom(viewerPick: ForWhom, ownerClientId: string, viewer: string): ForWhom {
  return flipForWhom(viewerPick, ownerClientId === viewer)
}

/** 고치거나 지울 수 있는 기록의 주인: 나, 그리고 지출을 공유한 배우자 */
async function editableOwners(supabase: any, clientId: string): Promise<string[]> {
  const partner = await partnerSharing(supabase, clientId, 'spending')
  return partner ? [clientId, partner] : [clientId]
}

async function learn(supabase: any, clientId: string, memo: string, categoryId: string) {
  const keyword = learnKeyword(memo)
  if (!keyword) return null
  const { error } = await supabase.from('money_flow_rules')
    .upsert({ client_id: clientId, keyword, category_id: categoryId, updated_at: new Date().toISOString() }, { onConflict: 'client_id,keyword' })
  return error
}

async function handlePost(supabase: any, clientId: string, body: any, res: VercelResponse) {
  const action = body?.action
  if (action === 'add-entries') {
    // 여러 줄 붙여넣기도 한 번에. 하나라도 틀리면 전부 거절해 반쯤 저장되지 않게 한다.
    if (!Array.isArray(body.entries) || body.entries.length === 0 || body.entries.length > maxEntriesPerPost) return res.status(400).json({ error: 'Invalid entries' })
    const rows = body.entries.map((entry: any) => normalizeFlowEntry(entry))
    if (rows.some((row: unknown) => row === null)) return res.status(400).json({ error: 'Invalid entry' })
    const { data, error } = await supabase.from('money_flow_entries').insert(rows.map((row: any) => ({ ...row, client_id: clientId }))).select(entryColumns)
    if (error) return res.status(500).json({ error: error.message })
    // 사용자가 자동 분류를 고친 건(learn: true)만 학습한다.
    for (const [i, entry] of body.entries.entries()) {
      if (entry.learn === true) {
        const learnError = await learn(supabase, clientId, rows[i].memo, rows[i].category_id)
        if (learnError) return res.status(500).json({ error: learnError.message })
      }
    }
    return res.status(200).json({ ok: true, data: (data ?? []).map((row: any) => toEntry(row, clientId)) })
  }
  if (action === 'save-check') {
    const check = normalizeFlowCheck(body)
    if (!check) return res.status(400).json({ error: 'Invalid check' })
    const { data, error } = await supabase.from('money_flow_checks').insert({ ...check, client_id: clientId }).select('id').single()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true, id: data.id })
  }
  if (action === 'save-month-totals') {
    // 자기 칸만 저장한다(배우자 합계는 배우자가 적는다). 새 값을 먼저 upsert하고, 목록에서 빠진 칸만 지워 중간 실패 때 기존 값이 사라지지 않게 한다
    const parsed = normalizeMonthTotals(body)
    if (!parsed) return res.status(400).json({ error: 'Invalid totals' })
    const month = `${parsed.month}-01`
    const now = new Date().toISOString()
    if (parsed.totals.length > 0) {
      const { error } = await supabase.from('money_flow_month_totals')
        .upsert(parsed.totals.map((t, position) => ({ client_id: clientId, month, label: t.label, kind: t.kind, amount: t.amount, position, updated_at: now })), { onConflict: 'client_id,month,label' })
      if (error) return res.status(500).json({ error: error.message })
    }
    const { data: existing, error: readError } = await supabase.from('money_flow_month_totals').select('label').eq('client_id', clientId).eq('month', month)
    if (readError) return res.status(500).json({ error: readError.message })
    const removed = (existing ?? []).map((row: any) => row.label).filter((label: string) => !parsed.totals.some((t) => t.label === label))
    if (removed.length > 0) {
      const { error } = await supabase.from('money_flow_month_totals').delete().eq('client_id', clientId).eq('month', month).in('label', removed)
      if (error) return res.status(500).json({ error: error.message })
    }
    return res.status(200).json({ ok: true })
  }
  if (typeof body?.id !== 'string' || !uuidPattern.test(body.id)) return res.status(400).json({ error: 'Invalid id' })
  if (action === 'update-entry') {
    const row = normalizeFlowEntry(body)
    if (!row) return res.status(400).json({ error: 'Invalid entry' })
    const owners = await editableOwners(supabase, clientId)
    const { data: owner, error: ownerError } = await supabase.from('money_flow_entries').select('client_id').in('client_id', owners).eq('id', body.id).maybeSingle()
    if (ownerError) return res.status(500).json({ error: ownerError.message })
    if (!owner) return res.status(404).json({ error: 'Entry not found' })
    row.for_whom = storedForWhom(row.for_whom, owner.client_id, clientId)
    const { data, error } = await supabase.from('money_flow_entries')
      .update({ ...row, updated_at: new Date().toISOString(), updated_by_client_id: clientId })
      .in('client_id', owners).eq('id', body.id).is('deleted_at', null).select(entryColumns).maybeSingle()
    if (error) return res.status(500).json({ error: error.message })
    if (!data) return res.status(404).json({ error: 'Entry not found' })
    if (body.learn === true) {
      const learnError = await learn(supabase, clientId, row.memo, row.category_id)
      if (learnError) return res.status(500).json({ error: learnError.message })
    }
    return res.status(200).json({ ok: true, data: toEntry(data, clientId) })
  }
  if (action === 'delete-entry' || action === 'restore-entry') {
    // 지우기는 표시만 — 합계에서 빠지고, 둘 다 '지운 기록'에서 되돌릴 수 있다
    const patch = action === 'delete-entry'
      ? { deleted_at: new Date().toISOString(), deleted_by_client_id: clientId }
      : { deleted_at: null, deleted_by_client_id: null, updated_at: new Date().toISOString(), updated_by_client_id: clientId }
    const { data, error } = await supabase.from('money_flow_entries').update(patch)
      .in('client_id', await editableOwners(supabase, clientId)).eq('id', body.id).select('id').maybeSingle()
    if (error) return res.status(500).json({ error: error.message })
    if (!data) return res.status(404).json({ error: 'Entry not found' })
    return res.status(200).json({ ok: true })
  }
  if (action === 'delete-check') {
    const { error } = await supabase.from('money_flow_checks').delete().eq('client_id', clientId).eq('id', body.id)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true })
  }
  return res.status(400).json({ error: 'Unknown action' })
}

/** 지운 기록은 합계에 넣지 않고 따로 준다 */
export function splitDeleted<T extends { deletedBy: string | null }>(list: T[]): { entries: T[]; deleted: T[] } {
  return { entries: list.filter((e) => !e.deletedBy), deleted: list.filter((e) => e.deletedBy) }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setUiCorsHeaders(req, res, 'GET,POST,OPTIONS')
  res.setHeader('Cache-Control', 'private, no-store')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (!['GET', 'POST'].includes(req.method ?? '')) return res.status(405).json({ error: 'Method not allowed' })

  const user = await resolveUiUserContext(req)
  if (!user.authenticated || !user.clientId) return res.status(401).json({ error: 'Login required' })
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return res.status(500).json({ error: 'Server not configured' })
  const supabase = createClient(url, key, { auth: { persistSession: false } })

  if (req.method === 'GET') {
    const from = req.query.from
    const to = req.query.to
    if (!validDate(from) || !validDate(to) || from > to) return res.status(400).json({ error: 'Invalid range' })
    // 부부 연결: 상대가 지출을 공유하면 상대 기록도 함께 준다(읽기만, mine: false). 고치기·지우기는 client_id로 묶여 자기 것만 된다
    const partnerClientId = await partnerSharing(supabase, user.clientId, 'spending')
    const totalOwners = partnerClientId ? [user.clientId, partnerClientId] : [user.clientId]
    const [entries, rules, checks, partnerEntries, totals] = await Promise.all([
      supabase.from('money_flow_entries').select(entryColumns).eq('client_id', user.clientId)
        .gte('spent_on', from).lte('spent_on', to).order('spent_on', { ascending: false }).order('created_at', { ascending: false }).limit(2000),
      supabase.from('money_flow_rules').select('keyword,category_id').eq('client_id', user.clientId).limit(1000),
      supabase.from('money_flow_checks').select('id,checked_on,label,input').eq('client_id', user.clientId)
        .order('checked_on', { ascending: false }).order('created_at', { ascending: false }).limit(24),
      partnerClientId
        ? supabase.from('money_flow_entries').select(entryColumns).eq('client_id', partnerClientId)
          .gte('spent_on', from).lte('spent_on', to).order('spent_on', { ascending: false }).order('created_at', { ascending: false }).limit(2000)
        : Promise.resolve({ data: [], error: null }),
      supabase.from('money_flow_month_totals').select('client_id,month,label,kind,amount,position').in('client_id', totalOwners)
        .gte('month', `${from.slice(0, 7)}-01`).lte('month', to).order('month', { ascending: false }).order('position', { ascending: true }).limit(1000),
    ])
    // 월 합계 테이블(033)이 아직 없으면 그 기능만 끄고 나머지는 그대로 보여 준다. 다른 오류는 숨기지 않는다
    const totalsMissing = isMissingTable(totals.error)
    const failed = [entries, rules, checks, partnerEntries, ...(totalsMissing ? [] : [totals])].find((result) => result.error)
    if (failed) return res.status(500).json({ error: failed.error!.message })
    return res.status(200).json({
      ...splitDeleted([...(entries.data ?? []), ...(partnerEntries.data ?? [])].map((row: any) => toEntry(row, user.clientId!))
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))),
      partnerShared: !!partnerClientId,
      totalsReady: !totalsMissing,
      totals: totalsMissing ? [] : (totals.data ?? []).map((row: any) => toMonthTotal(row, user.clientId!)),
      rules: (rules.data ?? []).map((row: any) => ({ keyword: row.keyword, categoryId: row.category_id })),
      checks: (checks.data ?? []).map((row: any) => ({ id: row.id, date: String(row.checked_on).slice(0, 10), label: row.label, input: row.input })),
    })
  }

  const input = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body) } catch { return null } })() : req.body
  return handlePost(supabase, user.clientId, input, res)
}
