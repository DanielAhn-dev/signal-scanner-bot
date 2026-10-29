import test from 'node:test'
import assert from 'node:assert/strict'
import { bypassGateRestriction } from '../src/services/virtualAutoTradeGateBypass'

const before = { requestedSlots: 2, baseMinBuyScore: 72 }

test('일반 계정은 결과를 그대로 둔다', () => {
  const r = { requestedSlots: 0, baseMinBuyScore: 77, note: '저장 게이트(중단 후보): 신규·추가 매수 차단' }
  assert.equal(bypassGateRestriction(before, r, false), r)
})

test('실험 계정은 슬롯 감소·점수 상향·매수 차단을 건너뛰고 이유를 남긴다', () => {
  const stop = bypassGateRestriction(before, { requestedSlots: 0, baseMinBuyScore: 77, note: '저장 게이트(중단 후보): 신규·추가 매수 차단' }, true)
  assert.deepEqual([stop.requestedSlots, stop.baseMinBuyScore], [2, 72])
  assert.match(stop.note!, /\[실험 모드\] 저장 게이트\(중단 후보\) 건너뜀/)

  const slot = bypassGateRestriction(before, { requestedSlots: 1, baseMinBuyScore: 72, note: '성과게이트(보수): 슬롯 -1' }, true)
  assert.equal(slot.requestedSlots, 2)

  const score = bypassGateRestriction(before, { requestedSlots: 2, baseMinBuyScore: 75 }, true)
  assert.equal(score.baseMinBuyScore, 72)
})

test('완화 방향이거나 변화가 없으면 그대로 둔다', () => {
  const loosen = { requestedSlots: 2, baseMinBuyScore: 70, note: '성과게이트(완화): 최소점수 -2' }
  assert.equal(bypassGateRestriction(before, loosen, true), loosen)
  const same = { requestedSlots: 2, baseMinBuyScore: 72 }
  assert.equal(bypassGateRestriction(before, same, true), same)
})
