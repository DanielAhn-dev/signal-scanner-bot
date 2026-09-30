import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import handler, { normalizeEntry, normalizeRecord } from '../handlers/ui/seed-builder'

const record = {
  month: '2026-09', household: 'dual-income', ownIncome: 3000000, partnerIncome: 2000000,
  expenses: { food: 500000, housing: 900000, vehicle: 100000, education: 200000, tax: 300000, subscriptions: 50000, other: 0 },
  reserve: 500000, plan: 300000,
}

test('시드 월 기록은 정수 금액과 허용된 큰 카테고리만 받는다', () => {
  assert.equal(normalizeRecord(record)?.month, '2026-09-01')
  assert.equal(normalizeRecord({ ...record, plan: -1 }), null)
  assert.equal(normalizeRecord({ ...record, plan: 1.5 }), null)
  assert.equal(normalizeRecord(record)?.record_status, 'recorded')
  assert.equal(normalizeRecord({ ...record, status: 'skipped' })?.record_status, 'skipped')
  assert.equal(normalizeRecord({ ...record, status: 'done' }), null)
  assert.equal('saved_amount' in (normalizeRecord(record) ?? {}), false)
  assert.equal(normalizeRecord({ ...record, expenses: { ...record.expenses, secret: 10 } }), null)
  assert.equal(normalizeRecord({ ...record, household: 'solo', partnerIncome: 2000000 }), null)
  assert.equal(normalizeRecord({ ...record, month: '2026-13' }), null)
  assert.equal(normalizeRecord(record)?.expenses.card, 0)
  assert.equal(normalizeRecord({ ...record, expenses: { ...record.expenses, card: 250000 } })?.expenses.card, 250000)
  assert.equal(normalizeRecord({ ...record, ownPayday: 25, partnerPayday: 5 })?.partner_payday, 5)
  assert.equal(normalizeRecord({ ...record, ownPayday: 32 }), null)
  assert.equal(normalizeRecord({ ...record, partnerPayday: 0 }), null)
  assert.equal(normalizeRecord({ ...record, extraIncome: { incentive: 300000 }, expenses: { ...record.expenses, water: 80000, gas: 120000 } })?.extra_income.incentive, 300000)
  assert.equal(normalizeRecord({ ...record, extraIncome: { incentive: -1 } }), null)
  assert.equal(normalizeRecord({ ...record, extraIncome: { unknown: 1 } }), null)
  assert.equal(normalizeRecord({ ...record, expenses: { ...record.expenses, propertyTax: -1 } }), null)
})

test('로그인 없는 가계 재무 조회는 차단한다', async () => {
  let statusCode = 0
  let responseBody: any
  const response = {
    setHeader: () => response,
    status: (code: number) => { statusCode = code; return response },
    json: (body: unknown) => { responseBody = body; return response },
  }
  await handler({ method: 'GET', headers: {}, query: { year: '2026' } } as unknown as VercelRequest, response as unknown as VercelResponse)
  assert.equal(statusCode, 401)
  assert.equal(responseBody.error, 'Login required')
})
test('확보 내역은 이번 달 이하, 양수 금액, 월 안의 날짜, 금액 이하 입금만 받는다', () => {
  const now = new Date('2026-09-15T03:00:00Z')
  const entry = { month: '2026-09', date: '2026-09-10', amount: 30000, deposited: 10000, memo: '월급 후' }
  assert.equal(normalizeEntry(entry, now)?.entry_date, '2026-09-10')
  assert.equal(normalizeEntry({ ...entry, month: '2026-10', date: '2026-10-01' }, now), null)
  assert.equal(normalizeEntry({ ...entry, amount: 0 }, now), null)
  assert.equal(normalizeEntry({ ...entry, amount: 1.5 }, now), null)
  assert.equal(normalizeEntry({ ...entry, deposited: 30001 }, now), null)
  assert.equal(normalizeEntry({ ...entry, date: '2026-08-31' }, now), null)
  assert.equal(normalizeEntry({ ...entry, date: '2026-09-31' }, now), null)
  assert.equal(normalizeEntry({ ...entry, memo: 'a'.repeat(101) }, now), null)
  assert.equal(normalizeEntry({ month: '2026-09', date: '2026-09-01', amount: 1000 }, now)?.deposited_amount, 0)
})
