import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMobileFinance, parseKoreanMoneyText } from '../src/services/naverFinanceMobile'
import { findLatestActualAnnualValue, forwardGrowthPctFromAnnualRow } from '../src/services/fundamentalParser'

const integration = {
  totalInfos: [
    { code: 'marketValue', value: '1,095조 81억' },
    { code: 'per', value: '6.68배' },
    { code: 'pbr', value: '4.06배' },
  ],
}
const annual = {
  financeInfo: {
    trTitleList: [
      { isConsensus: 'N', key: '202312' },
      { isConsensus: 'N', key: '202412' },
      { isConsensus: 'N', key: '202512' },
      { isConsensus: 'Y', key: '202612' },
    ],
    rowList: [
      { title: 'ROE', columns: { '202312': { value: '-15.61' }, '202412': { value: '31.06' }, '202512': { value: '44.15' }, '202612': { value: '103.54' } } },
      { title: '부채비율', columns: { '202312': { value: '87.52' }, '202412': { value: '62.15' }, '202512': { value: '45.95' }, '202612': { value: '-' } } },
      { title: '당기순이익', columns: { '202312': { value: '-91,375' }, '202412': { value: '198,000' }, '202512': { value: '429,000' }, '202612': { value: '2,600,000' } } },
    ],
  },
}

test('현재 PER·PBR·시가총액을 읽는다', () => {
  const d = buildMobileFinance(integration, annual)
  assert.equal(d.currentPer, 6.68)
  assert.equal(d.currentPbr, 4.06)
  assert.equal(d.marketCap, 1_095_0081_0000_0000)
})

test('연간 행을 실적 3칸 + 컨센서스 1칸으로 바꿔 옛 계산 함수가 그대로 읽는다', () => {
  const d = buildMobileFinance(integration, annual)
  assert.deepEqual(d.rows['ROE'], ['-15.61', '31.06', '44.15', '103.54'])
  assert.equal(findLatestActualAnnualValue(d.rows['ROE']), 44.15)
  assert.equal(findLatestActualAnnualValue(d.rows['부채비율']), 45.95)
  assert.ok((forwardGrowthPctFromAnnualRow(d.rows['당기순이익']) ?? 0) > 0)
})

test('실적이 3칸보다 적으면 앞을 채워 위치를 유지한다', () => {
  const d = buildMobileFinance(integration, {
    financeInfo: {
      trTitleList: [{ isConsensus: 'N', key: '202512' }, { isConsensus: 'Y', key: '202612' }],
      rowList: [{ title: 'ROE', columns: { '202512': { value: '9.5' }, '202612': { value: '11' } } }],
    },
  })
  assert.deepEqual(d.rows['ROE'], ['-', '-', '9.5', '11'])
  assert.equal(findLatestActualAnnualValue(d.rows['ROE']), 9.5)
})

test('응답이 비어도 던지지 않고 빈 값을 돌려준다', () => {
  const d = buildMobileFinance(null, undefined)
  assert.deepEqual(d.rows, {})
  assert.equal(d.currentPer, undefined)
})

test('금액 문장 파싱', () => {
  assert.equal(parseKoreanMoneyText('7조 3,605억'), 7_3605_0000_0000)
  assert.equal(parseKoreanMoneyText(''), undefined)
})
