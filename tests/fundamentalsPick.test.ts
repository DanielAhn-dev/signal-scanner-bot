import test from 'node:test'
import assert from 'node:assert/strict'
import { hasFundamentalValues, pickUsableFundamentals } from '../src/lib/fundamentalsPick'

test('핵심 값이 모두 비면 값 없는 행으로 본다', () => {
  assert.equal(hasFundamentalValues({ per: null, pbr: null, roe: null, debt_ratio: null }), false)
  assert.equal(hasFundamentalValues(null), false)
  assert.equal(hasFundamentalValues({ per: '' as unknown }), false)
  assert.equal(hasFundamentalValues({ per: 'abc' as unknown }), false)
})

test('하나라도 숫자가 있으면 값 있는 행이다(0 포함)', () => {
  assert.equal(hasFundamentalValues({ per: 12.3 }), true)
  assert.equal(hasFundamentalValues({ roe: '8.5' as unknown }), true)
  assert.equal(hasFundamentalValues({ debt_ratio: 0 }), true)
})

test('값이 빈 최신 행을 건너뛰고 예전의 정상 행을 고른다', () => {
  const rows = [
    { as_of: '2026-10-29', per: null, pbr: null, roe: null, debt_ratio: null },
    { as_of: '2026-10-28', per: null, pbr: null, roe: null, debt_ratio: null },
    { as_of: '2026-10-20', per: 9.1, pbr: 1.2, roe: 14, debt_ratio: 40 },
  ]
  assert.equal(pickUsableFundamentals(rows)?.as_of, '2026-10-20')
})

test('최신 행에 값이 있으면 그 행이다. 전부 비면 null', () => {
  const good = [{ as_of: 'b', per: 5 }, { as_of: 'a', per: 6 }]
  assert.equal(pickUsableFundamentals(good)?.as_of, 'b')
  assert.equal(pickUsableFundamentals([{ per: null }]), null)
  assert.equal(pickUsableFundamentals([]), null)
  assert.equal(pickUsableFundamentals(undefined), null)
})
