import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import handler, { normalizeRecord } from '../handlers/ui/seed-builder'

const record = {
  month: '2026-09', household: 'dual-income', ownIncome: 3000000, partnerIncome: 2000000,
  expenses: { food: 500000, housing: 900000, vehicle: 100000, education: 200000, tax: 300000, subscriptions: 50000, other: 0 },
  reserve: 500000, plan: 300000, saved: 200000,
}

test('시드 월 기록은 정수 금액과 허용된 큰 카테고리만 받는다', () => {
  assert.equal(normalizeRecord(record)?.month, '2026-09-01')
  assert.equal(normalizeRecord({ ...record, saved: -1 }), null)
  assert.equal(normalizeRecord({ ...record, saved: 1.5 }), null)
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