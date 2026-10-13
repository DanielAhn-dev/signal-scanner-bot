import test from 'node:test'
import assert from 'node:assert/strict'
import { trimmedSinceLastBuy } from '../src/lib/trimSinceBuy'

test('매수만 있으면 덜어내지 않은 것', () => {
  assert.equal(trimmedSinceLastBuy([{ side: 'BUY', traded_at: '2026-10-01T06:30:00Z' }]), false)
  assert.equal(trimmedSinceLastBuy([]), false)
})

test('마지막 매수 뒤 매도가 있으면 덜어낸 것', () => {
  assert.equal(trimmedSinceLastBuy([
    { side: 'BUY', traded_at: '2026-10-01T06:30:00Z' },
    { side: 'SELL', traded_at: '2026-10-10T02:00:00Z' },
  ]), true)
})

test('매도 뒤 다시 사면 새로 시작', () => {
  assert.equal(trimmedSinceLastBuy([
    { side: 'BUY', traded_at: '2026-09-01T06:30:00Z' },
    { side: 'SELL', traded_at: '2026-09-20T02:00:00Z' },
    { side: 'BUY', traded_at: '2026-10-05T02:00:00Z' },
  ]), false)
})

test('보유 수정으로 수량을 줄이면 매도, 늘리면 매수로 본다', () => {
  assert.equal(trimmedSinceLastBuy([
    { side: 'BUY', traded_at: '2026-10-01T06:30:00Z' },
    { side: 'ADJUST', created_at: '2026-10-08T01:00:00Z', memo: 'web-edit: 10@50000원 → 5@50000원' },
  ]), true)
  assert.equal(trimmedSinceLastBuy([
    { side: 'SELL', traded_at: '2026-10-02T06:30:00Z' },
    { side: 'ADJUST', created_at: '2026-10-08T01:00:00Z', memo: 'web-edit: 5@50000원 → 8@48000원' },
  ]), false)
})

test('단가만 고친 ADJUST와 시각 없는 행은 무시', () => {
  assert.equal(trimmedSinceLastBuy([
    { side: 'BUY', traded_at: '2026-10-01T06:30:00Z' },
    { side: 'ADJUST', created_at: '2026-10-08T01:00:00Z', memo: 'web-edit: 10@50000원 → 10@51000원' },
    { side: 'SELL' },
  ]), false)
})
