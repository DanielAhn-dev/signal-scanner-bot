import test from 'node:test'
import assert from 'node:assert/strict'
import { dropColumn, parseMissingColumn } from '../src/lib/missingColumn'

test('없는 컬럼명을 오류 메시지에서 뽑는다', () => {
  assert.equal(parseMissingColumn('column stocks.eps does not exist'), 'eps')
  assert.equal(parseMissingColumn('column "bps" does not exist'), 'bps')
  assert.equal(parseMissingColumn('column public.stocks.foreigner_ratio does not exist'), 'foreigner_ratio')
})

test('다른 오류나 빈 값은 null', () => {
  assert.equal(parseMissingColumn('permission denied for table stocks'), null)
  assert.equal(parseMissingColumn(undefined), null)
})

test('컬럼 목록에서 해당 컬럼만 뺀다. 목록에 없으면 null', () => {
  assert.deepEqual(dropColumn(['code', 'per', 'eps'], 'eps'), ['code', 'per'])
  assert.equal(dropColumn(['code', 'per'], 'eps'), null)
})
