import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isFreshSnapshotExpiry,
  isValidEconomicCalendarSnapshotPayload,
} from '../src/services/economicCalendarSnapshotService'

test('economic calendar snapshot payload: events 배열과 timeRange가 있어야 유효하다', () => {
  assert.equal(isValidEconomicCalendarSnapshotPayload(null), false)
  assert.equal(isValidEconomicCalendarSnapshotPayload({}), false)
  assert.equal(isValidEconomicCalendarSnapshotPayload({ events: [] }), false)
  assert.equal(isValidEconomicCalendarSnapshotPayload({ events: [], timeRange: {} }), true)
})

test('economic calendar snapshot expiry: allowStale=false면 만료/무효 expires_at를 거른다', () => {
  assert.equal(isFreshSnapshotExpiry(null, false), false)
  assert.equal(isFreshSnapshotExpiry('not-a-date', false), false)
  assert.equal(isFreshSnapshotExpiry('2000-01-01T00:00:00.000Z', false), false)
})

test('economic calendar snapshot expiry: allowStale=true면 expires_at 없이도 허용한다', () => {
  assert.equal(isFreshSnapshotExpiry(null, true), true)
  assert.equal(isFreshSnapshotExpiry('not-a-date', true), true)
})
