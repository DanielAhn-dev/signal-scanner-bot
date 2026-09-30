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
  const saved = amount(body.saved)
  const ownPayday = payday(body.ownPayday)
  const partnerPayday = payday(body.partnerPayday)
  if ([ownIncome, partnerIncome, reserve, plan, saved].some((value) => value === null)) return null
  if (ownPayday === undefined || partnerPayday === undefined) return null
  if (body.household !== 'dual-income' && partnerIncome !== 0) return null
  return {
    client_id: '', month: `${body.month}-01`, household: body.household,
    own_income: ownIncome, partner_income: partnerIncome, own_payday: ownPayday,
    partner_payday: body.household === 'dual-income' ? partnerPayday : null, expenses, extra_income: extraIncome,
    reserve_amount: reserve, plan_amount: plan, saved_amount: saved,
    updated_at: new Date().toISOString(),
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setUiCorsHeaders(req, res, 'GET,PUT,OPTIONS')
  res.setHeader('Cache-Control', 'private, no-store')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET' && req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' })

  const user = await resolveUiUserContext(req)
  if (!user.authenticated || !user.clientId) return res.status(401).json({ error: 'Login required' })
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return res.status(500).json({ error: 'Server not configured' })
  const supabase = createClient(url, key, { auth: { persistSession: false } })

  if (req.method === 'GET') {
    const year = Number(req.query.year)
    if (!Number.isInteger(year) || year < 2000 || year > 2099) return res.status(400).json({ error: 'Invalid year' })
    const { data, error } = await supabase.from('seed_builder_months')
      .select('month,household,own_income,partner_income,own_payday,partner_payday,expenses,extra_income,reserve_amount,plan_amount,saved_amount')
      .eq('client_id', user.clientId).gte('month', `${year}-01-01`).lte('month', `${year}-12-01`)
      .order('month')
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ data: (data ?? []).map((row) => ({
      month: String(row.month).slice(0, 7), household: row.household,
      ownIncome: Number(row.own_income), partnerIncome: Number(row.partner_income),
      ownPayday: row.own_payday, partnerPayday: row.partner_payday,
      expenses: { ...Object.fromEntries(expenseKeys.map((expenseKey) => [expenseKey, 0])), ...row.expenses },
      extraIncome: { ...Object.fromEntries(extraIncomeKeys.map((incomeKey) => [incomeKey, 0])), ...row.extra_income },
      reserve: Number(row.reserve_amount), plan: Number(row.plan_amount), saved: Number(row.saved_amount),
    })) })
  }

  const input = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body) } catch { return null } })() : req.body
  const record = normalizeRecord(input)
  if (!record) return res.status(400).json({ error: 'Invalid monthly record' })
  const { error } = await supabase.from('seed_builder_months')
    .upsert({ ...record, client_id: user.clientId }, { onConflict: 'client_id,month' })
  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ ok: true })
}