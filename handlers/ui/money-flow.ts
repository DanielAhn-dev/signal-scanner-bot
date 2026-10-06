import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { setUiCorsHeaders } from './_accessControl'
import { resolveUiUserContext } from './_userContext'
import { categoryById, learnKeyword, type FlowCheckInput, type FlowItem, type IrregularItem } from '../../src/lib/moneyFlow'

const maxAmount = 100_000_000_000
const maxEntriesPerPost = 50
const maxCheckItems = 80
const cutLevels = ['must', 'trim', 'drop'] as const
const payments = ['cash', 'point_regular', 'point_once'] as const
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
  if (typeof body.categoryId !== 'string' || !categoryById(body.categoryId)) return null
  const cut = body.cut ?? null
  if (cut !== null && !cutLevels.includes(cut)) return null
  const payment = body.payment ?? 'cash'
  if (!payments.includes(payment)) return null
  const mustPart = body.mustPart ?? null
  if (mustPart !== null && (amount(mustPart) === null || mustPart > value)) return null
  return { spent_on: body.date, amount: value, memo: memo.trim(), category_id: body.categoryId, cut_level: cut, must_part: mustPart, payment }
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
  return { categoryId: raw.categoryId, amount: value, payment, cut, mustPart, label: label.trim() }
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

const entryColumns = 'id,spent_on,amount,memo,category_id,cut_level,must_part,payment'
const toEntry = (row: any) => ({
  id: row.id, date: String(row.spent_on).slice(0, 10), amount: Number(row.amount), memo: row.memo, categoryId: row.category_id,
  cut: row.cut_level ?? null, mustPart: row.must_part === null ? null : Number(row.must_part), payment: row.payment,
})

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
    return res.status(200).json({ ok: true, data: (data ?? []).map(toEntry) })
  }
  if (action === 'save-check') {
    const check = normalizeFlowCheck(body)
    if (!check) return res.status(400).json({ error: 'Invalid check' })
    const { data, error } = await supabase.from('money_flow_checks').insert({ ...check, client_id: clientId }).select('id').single()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true, id: data.id })
  }
  if (typeof body?.id !== 'string' || !uuidPattern.test(body.id)) return res.status(400).json({ error: 'Invalid id' })
  if (action === 'update-entry') {
    const row = normalizeFlowEntry(body)
    if (!row) return res.status(400).json({ error: 'Invalid entry' })
    const { data, error } = await supabase.from('money_flow_entries').update(row).eq('client_id', clientId).eq('id', body.id).select(entryColumns).maybeSingle()
    if (error) return res.status(500).json({ error: error.message })
    if (!data) return res.status(404).json({ error: 'Entry not found' })
    if (body.learn === true) {
      const learnError = await learn(supabase, clientId, row.memo, row.category_id)
      if (learnError) return res.status(500).json({ error: learnError.message })
    }
    return res.status(200).json({ ok: true, data: toEntry(data) })
  }
  if (action === 'delete-entry' || action === 'delete-check') {
    const table = action === 'delete-entry' ? 'money_flow_entries' : 'money_flow_checks'
    const { error } = await supabase.from(table).delete().eq('client_id', clientId).eq('id', body.id)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true })
  }
  return res.status(400).json({ error: 'Unknown action' })
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
    const [entries, rules, checks] = await Promise.all([
      supabase.from('money_flow_entries').select(entryColumns).eq('client_id', user.clientId)
        .gte('spent_on', from).lte('spent_on', to).order('spent_on', { ascending: false }).order('created_at', { ascending: false }).limit(2000),
      supabase.from('money_flow_rules').select('keyword,category_id').eq('client_id', user.clientId).limit(1000),
      supabase.from('money_flow_checks').select('id,checked_on,label,input').eq('client_id', user.clientId)
        .order('checked_on', { ascending: false }).order('created_at', { ascending: false }).limit(24),
    ])
    const failed = [entries, rules, checks].find((result) => result.error)
    if (failed) return res.status(500).json({ error: failed.error!.message })
    return res.status(200).json({
      entries: (entries.data ?? []).map(toEntry),
      rules: (rules.data ?? []).map((row: any) => ({ keyword: row.keyword, categoryId: row.category_id })),
      checks: (checks.data ?? []).map((row: any) => ({ id: row.id, date: String(row.checked_on).slice(0, 10), label: row.label, input: row.input })),
    })
  }

  const input = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body) } catch { return null } })() : req.body
  return handlePost(supabase, user.clientId, input, res)
}
