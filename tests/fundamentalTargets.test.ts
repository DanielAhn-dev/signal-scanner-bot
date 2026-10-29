import test from 'node:test'
import assert from 'node:assert/strict'
import { fillRatio, pickFundamentalTargets } from '../src/lib/fundamentalTargets'

test('우선순위 순서대로, 이미 채워진 종목은 건너뛰고 limit개를 고른다', () => {
  const got = pickFundamentalTargets({
    ranked: ['A', 'B', 'C', 'D'],
    all: ['Z', 'A', 'B', 'C', 'D', 'Y'],
    fresh: new Set(['A', 'C']),
    limit: 3,
  })
  assert.deepEqual(got, ['B', 'D', 'Z'])
})

test('순위에 없는 종목은 전체 목록 순서로 뒤에 붙고 중복은 없다', () => {
  const got = pickFundamentalTargets({ ranked: ['A'], all: ['A', 'B', 'B', 'C'], fresh: new Set(), limit: 10 })
  assert.deepEqual(got, ['A', 'B', 'C'])
})

test('전부 채워졌으면 빈 목록, limit 0도 빈 목록', () => {
  assert.deepEqual(pickFundamentalTargets({ ranked: ['A'], all: ['A'], fresh: new Set(['A']), limit: 5 }), [])
  assert.deepEqual(pickFundamentalTargets({ ranked: ['A'], all: ['A'], fresh: new Set(), limit: 0 }), [])
})

test('채움 비율', () => {
  assert.equal(fillRatio(0, 0), 1)
  assert.equal(fillRatio(30, 100), 0.3)
})
