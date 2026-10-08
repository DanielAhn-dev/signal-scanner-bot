import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyDisclosure } from '../src/lib/disclosureRisk'

test('희석 공시와 정정 접두어', () => {
  assert.equal(classifyDisclosure('주요사항보고서(유상증자결정)'), 'dilution')
  assert.equal(classifyDisclosure('[기재정정]주요사항보고서(전환사채권발행결정)'), 'dilution')
  assert.equal(classifyDisclosure('주요사항보고서(유상증자결정)(자회사의 주요경영사항)'), null)
  assert.equal(classifyDisclosure('유상증자결정 철회'), null)
})

test('자사주는 직접 취득만, 신탁은 제외', () => {
  assert.equal(classifyDisclosure('주요사항보고서(자기주식취득결정)'), 'buyback')
  assert.equal(classifyDisclosure('주요사항보고서(자기주식취득신탁계약체결결정)'), null)
})

test('위험 지정 공시', () => {
  assert.equal(classifyDisclosure('주권매매거래정지(관리종목지정사유발생)'), 'admin')
  assert.equal(classifyDisclosure('주권매매거래정지(관리종목지정우려)'), 'admin_warn')
  assert.equal(classifyDisclosure('기타시장안내(상장적격성 실질심사 대상 결정)'), 'review')
  assert.equal(classifyDisclosure('주권매매거래정지해제(상장적격성 실질심사 대상 제외 결정)'), null)
  assert.equal(classifyDisclosure('불성실공시법인지정예고              (공시번복)'), 'unfaithful')
  assert.equal(classifyDisclosure('불성실공시법인미지정(지정유예)'), null)
  assert.equal(classifyDisclosure('주요사항보고서(감자결정)'), 'capital_cut')
  assert.equal(classifyDisclosure('조회공시요구(풍문또는보도)(감사의견 비적정설)'), 'audit')
  assert.equal(classifyDisclosure('기업설명회(IR)개최(안내공시)'), null)
})
