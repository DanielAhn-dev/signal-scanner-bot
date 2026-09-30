import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { setUiCorsHeaders } from './_accessControl'
import { resolveUiUserContext } from './_userContext'

const expenseKeys = ['food', 'housing', 'vehicle', 'education', 'tax', 'subscriptions', 'other', 'card', 'water', 'gas', 'residentTax', 'propertyTax', 'vehicleTax', 'taxAdjustment'] as const
const extraIncomeKeys = ['incentive', 'vacation', 'taxRefund', 'other'] as const
const households = ['solo', 'single-income', 'dual-income'] as const
const maxAmount = 100_000_000_000

function amount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maxAmount) return null
  return value
}

function payday(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 31) return undefined
  return value
}

function validMonth(value: unknown): value is string {
  return typeof value === 'string' && /^20\d{2}-(0[1-9]|1[0-2])$/.test(value)
}

export function normalizeRecord(body: any) {
  if (!validMonth(body?.month) || !households.includes(body?.household)) return null
  if (!body?.expenses || typeof body.expenses !== 'object' || Array.isArray(body.expenses)) return null
  if (Object.keys(body.expenses).some((key) => !expenseKeys.includes(key as typeof expenseKeys[number]))) return null
  const inputExtraIncome = body?.extraIncome ?? {}
  if (!inputExtraIncome || typeof inputExtraIncome !== 'object' || Array.isArray(inputExtraIncome)) return null
  if (Object.keys(inputExtraIncome).some((key) => !extraIncomeKeys.includes(key as typeof extraIncomeKeys[number]))) return null
  const expenses: Record<string, number> = {}
  for (const key of expenseKeys) {
    const value = amount(body.expenses[key] ?? 0)
    if (value === null) return null
    expenses[key] = value
  }
  const extraIncome: Record<string, number> = {}
  for (const key of extraIncomeKeys) {
    const value = amount(inputExtraIncome[key] ?? 0)
    if (value === null) return null
    extraIncome[key] = value
  }
  const ownIncome = amount(body.ownIncome)
  const partnerIncome = amount(body.partnerIncome)
  const reserve = amount(body.reserve)
  const plan = amount(body.plan)
  const ownPayday = payday(body.ownPayday)
  const partnerPayday = payday(body.partnerPayday)
  if ([ownIncome, partnerIncome, reserve, plan].some((value) => value === null)) return null
  if (ownPayday === undefined || partnerPayday === undefined) return null
  if (body.household !== 'dual-income' && partnerIncome !== 0) return null
  const status = body.status ?? 'recorded'
  if (status !== 'recorded' && status !== 'skipped') return null
  return {
    client_id: '', month: `${body.month}-01`, household: body.household,
    own_income: ownIncome, partner_income: partnerIncome, own_payday: ownPayday,
    partner_payday: body.household === 'dual-income' ? partnerPayday : null, expenses, extra_income: extraIncome,
    reserve_amount: reserve, plan_amount: plan, record_status: status,
    updated_at: new Date().toISOString(),
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isDeleteAllConfirmed(body: any): boolean {
  return body?.confirm === 'delete-all'
}

export function kstMonth(now = new Date()): string {
  return now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).slice(0, 7)
}

// 확보 내역 추가 입력. 미래 달에는 확보를 기록할 수 없다(계획만 허용).
export function normalizeEntry(body: any, now = new Date()) {
  if (!validMonth(body?.month) || body.month > kstMonth(now)) return null
  if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) || !body.date.startsWith(`${body.month}-`)) return null
  if (Number.isNaN(Date.parse(`${body.date}T00:00:00Z`)) || new Date(`${body.date}T00:00:00Z`).toISOString().slice(0, 10) !== body.date) return null
  const value = amount(body.amount)
  const deposited = amount(body.deposited ?? 0)
  const memo = body.memo ?? ''
  if (value === null || value < 1 || deposited === null || deposited > value) return null
  if (typeof memo !== 'string' || memo.length > 100) return null
  return { month: `${body.month}-01`, entry_date: body.date, amount: value, deposited_amount: deposited, memo }
}

async function handleEntryAction(supabase: any, clientId: string, body: any, res: VercelResponse) {
  const action = body?.action
  if (action === 'add-entry') {
    const entry = normalizeEntry(body)
    if (!entry) return res.status(400).json({ error: 'Invalid entry' })
    const { data, error } = await supabase.from('seed_builder_entries').insert({ ...entry, client_id: clientId }).select('id').single()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true, id: data.id })
  }
  if (typeof body?.id !== 'string' || !uuidPattern.test(body.id)) return res.status(400).json({ error: 'Invalid entry id' })
  if (action === 'cancel-entry' || action === 'restore-entry') {
    const { error } = await supabase.from('seed_builder_entries')
      .update({ cancelled_at: action === 'cancel-entry' ? new Date().toISOString() : null })
      .eq('client_id', clientId).eq('id', body.id)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true })
  }
  if (action === 'set-deposit') {
    const deposited = amount(body.deposited)
    if (deposited === null) return res.status(400).json({ error: 'Invalid deposit' })
    const { data, error } = await supabase.from('seed_builder_entries').select('amount,cancelled_at')
      .eq('client_id', clientId).eq('id', body.id).maybeSingle()
    if (error) return res.status(500).json({ error: error.message })
    if (!data) return res.status(404).json({ error: 'Entry not found' })
    if (data.cancelled_at || deposited > Number(data.amount)) return res.status(400).json({ error: 'Deposit exceeds entry amount' })
    const { error: updateError } = await supabase.from('seed_builder_entries').update({ deposited_amount: deposited })
      .eq('client_id', clientId).eq('id', body.id)
    if (updateError) return res.status(500).json({ error: updateError.message })
    return res.status(200).json({ ok: true })
  }
  return res.status(400).json({ error: 'Unknown action' })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setUiCorsHeaders(req, res, 'GET,PUT,POST,DELETE,OPTIONS')
  res.setHeader('Cache-Control', 'private, no-store')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (!['GET', 'PUT', 'POST', 'DELETE'].includes(req.method ?? '')) return res.status(405).json({ error: 'Method not allowed' })

  const user = await resolveUiUserContext(req)
  if (!user.authenticated || !user.clientId) return res.status(401).json({ error: 'Login required' })
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return res.status(500).json({ error: 'Server not configured' })
  const supabase = createClient(url, key, { auth: { persistSession: false } })

  if (req.method === 'GET') {
    const year = Number(req.query.year)
    if (!Number.isInteger(year) || year < 2000 || year > 2099) return res.status(400).json({ error: 'Invalid year' })
    const range = { from: `${year}-01-01`, to: `${year}-12-01` }
    const { data, error } = await supabase.from('seed_builder_months')
      .select('month,household,own_income,partner_income,own_payday,partner_payday,expenses,extra_income,reserve_amount,plan_amount,record_status')
      .eq('client_id', user.clientId).gte('month', range.from).lte('month', range.to)
      .order('month')
    if (error) return res.status(500).json({ error: error.message })
    const { data: entryRows, error: entryError } = await supabase.from('seed_builder_entries')
      .select('id,month,entry_date,amount,deposited_amount,memo,cancelled_at')
      .eq('client_id', user.clientId).gte('month', range.from).lte('month', range.to)
      .order('entry_date').order('created_at')
    if (entryError) return res.status(500).json({ error: entryError.message })
    const entriesByMonth = new Map<string, Array<Record<string, unknown>>>()
    for (const row of entryRows ?? []) {
      const key = String(row.month).slice(0, 7)
      entriesByMonth.set(key, [...(entriesByMonth.get(key) ?? []), {
        id: row.id, date: String(row.entry_date).slice(0, 10), amount: Number(row.amount),
        deposited: Number(row.deposited_amount), memo: row.memo, cancelled: !!row.cancelled_at,
      }])
    }
    const monthRows = new Map((data ?? []).map((row) => [String(row.month).slice(0, 7), row]))
    const months = [...new Set([...monthRows.keys(), ...entriesByMonth.keys()])].sort()
    return res.status(200).json({ data: months.map((month) => {
      const row = monthRows.get(month)
      return {
        month, status: row?.record_status ?? 'recorded', household: row?.household ?? 'solo',
        ownIncome: Number(row?.own_income ?? 0), partnerIncome: Number(row?.partner_income ?? 0),
        ownPayday: row?.own_payday ?? null, partnerPayday: row?.partner_payday ?? null,
        expenses: { ...Object.fromEntries(expenseKeys.map((expenseKey) => [expenseKey, 0])), ...row?.expenses },
        extraIncome: { ...Object.fromEntries(extraIncomeKeys.map((incomeKey) => [incomeKey, 0])), ...row?.extra_income },
        reserve: Number(row?.reserve_amount ?? 0), plan: Number(row?.plan_amount ?? 0),
        entries: entriesByMonth.get(month) ?? [],
      }
    }) })
  }

  const input = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body) } catch { return null } })() : req.body
  if (req.method === 'DELETE') {
    // 가이드 기록만 지운다. 가상 계좌·자동 입금·매매 데이터는 다른 테이블이라 건드리지 않는다.
    if (!isDeleteAllConfirmed(input)) return res.status(400).json({ error: 'Confirmation required' })
    const { error: entryDeleteError } = await supabase.from('seed_builder_entries').delete().eq('client_id', user.clientId)
    if (entryDeleteError) return res.status(500).json({ error: entryDeleteError.message })
    const { error: monthDeleteError } = await supabase.from('seed_builder_months').delete().eq('client_id', user.clientId)
    if (monthDeleteError) return res.status(500).json({ error: monthDeleteError.message })
    return res.status(200).json({ ok: true })
  }
  if (req.method === 'POST') return handleEntryAction(supabase, user.clientId, input, res)
  const record = normalizeRecord(input)
  if (!record) return res.status(400).json({ error: 'Invalid monthly record' })
  const { error } = await supabase.from('seed_builder_months')
    .upsert({ ...record, client_id: user.clientId }, { onConflict: 'client_id,month' })
  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ ok: true })
}