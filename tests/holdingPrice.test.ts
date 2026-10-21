import test from 'node:test'
import assert from 'node:assert/strict'
import { positivePrice, resolveHoldingPrice } from '../src/lib/holdingPrice'

test('0·음수·빈 값은 가격 없음', () => {
  for (const v of [0, '0', -1, null, undefined, '', 'abc', Number.NaN]) {
    assert.equal(positivePrice(v), null, String(v))
  }
  assert.equal(positivePrice('14825'), 14825)
})

test('실시간가가 있으면 실시간가', () => {
  assert.deepEqual(resolveHoldingPrice(15000, 14825), { price: 15000, source: 'realtime' })
})

test('실시간가가 없으면 DB 종가', () => {
  assert.deepEqual(resolveHoldingPrice(undefined, 14825), { price: 14825, source: 'close' })
  assert.deepEqual(resolveHoldingPrice(0, '14825'), { price: 14825, source: 'close' })
})

test('DB 종가가 0이면 평가액 0이 아니라 가격 없음', () => {
  // 2026-10-21: KODEX 은행 등 보유 ETF 6종이 stocks.close=0이라 −100%로 계산됐다
  assert.deepEqual(resolveHoldingPrice(undefined, 0), { price: null, source: null })
  assert.deepEqual(resolveHoldingPrice(null, null), { price: null, source: null })
})
