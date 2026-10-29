import test from 'node:test'
import assert from 'node:assert/strict'
import { buildQualityAlert, findStaleFundamentals } from '../src/services/dataQualityTrend'

const now = new Date('2026-10-29T03:00:00Z')

test('값 채워진 마지막 수집이 3일 이내면 정상', () => {
  assert.equal(findStaleFundamentals('2026-10-28T20:54:00Z', now), null)
  assert.equal(findStaleFundamentals('2026-10-26T03:00:00Z', now), null)
})

test('3일을 넘기면 며칠 전인지 알린다', () => {
  assert.deepEqual(findStaleFundamentals('2026-10-15T20:00:00Z', now), { ageDays: 13 })
})

test('값 있는 수집이 한 번도 없거나 날짜가 깨졌으면 없음으로 알린다', () => {
  assert.deepEqual(findStaleFundamentals(null, now), { ageDays: null })
  assert.deepEqual(findStaleFundamentals('not-a-date', now), { ageDays: null })
})

test('알림 본문에 재무 수집 줄이 들어가고, 정상이면 알릴 것이 없다', () => {
  const base = { trend: { drops: [], chronic: [] }, limitBreaches: [], newlyMissing: [], badNames: [] }
  assert.equal(buildQualityAlert({ ...base, staleFundamentals: null }), null)
  const msg = buildQualityAlert({ ...base, staleFundamentals: { ageDays: 13 } })!
  assert.match(msg, /재무 수집/)
  assert.match(msg, /13일 전/)
})
