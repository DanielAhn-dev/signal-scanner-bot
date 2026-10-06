import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  FLOW_CATEGORIES, categoryById, classifyMemo, compareSummaries, evaluateFlowCheck, learnKeyword, parseAmountToken,
  parseLeadingDate, parseQuickLine, parseQuickLines, splitByCut, suggestCategories, summarizeItems, toSeedExpenses,
} from '../src/lib/moneyFlow'
import handler, { normalizeFlowCheck, normalizeFlowEntry, splitDeleted, toEntry } from '../handlers/ui/money-flow'

test('분류표: id 중복 없음, 모든 소분류에 갈래·대분류·기본값·시드 항목이 있다', () => {
  const ids = FLOW_CATEGORIES.map((c) => c.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const c of FLOW_CATEGORIES) {
    assert.ok(['fixed', 'variable', 'irregular'].includes(c.kind))
    assert.ok(['must', 'trim', 'drop'].includes(c.cut))
    assert.ok(c.major && c.label && c.seed)
  }
})

test('금액 토큰: 원·만·천·쉼표·₩를 읽고 0·음수·소수 원은 거절한다', () => {
  assert.equal(parseAmountToken('15170'), 15170)
  assert.equal(parseAmountToken('15,170원'), 15170)
  assert.equal(parseAmountToken('₩21,500'), 21500)
  assert.equal(parseAmountToken('3만'), 30000)
  assert.equal(parseAmountToken('1.5만원'), 15000)
  assert.equal(parseAmountToken('5천원'), 5000)
  assert.equal(parseAmountToken('1만5천'), 15000)
  assert.equal(parseAmountToken('0'), null)
  assert.equal(parseAmountToken('만두'), null)
  assert.equal(parseAmountToken('12,34'), null)
})

const TODAY = '2026-10-06'

test('한 줄 입력: 수량·용량·모델명 숫자는 금액으로 읽지 않는다', () => {
  assert.deepEqual(parseQuickLine('냉동피자 4판 15170', TODAY), { amount: 15170, memo: '냉동피자 4판', date: undefined, amountGuessed: false })
  assert.deepEqual(parseQuickLine('곰곰 신선한 1A 우유, 900ml, 2개 3690', TODAY), { amount: 3690, memo: '곰곰 신선한 1A 우유, 900ml, 2개', date: undefined, amountGuessed: false })
  assert.deepEqual(parseQuickLine('카스 디지털 체중계 X15 21500', TODAY), { amount: 21500, memo: '카스 디지털 체중계 X15', date: undefined, amountGuessed: false })
  // 단위가 붙은 금액은 앞에 있어도 이긴다
  assert.equal(parseQuickLine('1.2만원 배민 치킨 2', TODAY)?.amount, 12000)
  assert.deepEqual(parseQuickLine('5000', TODAY), { amount: 5000, memo: '', date: undefined, amountGuessed: false })
  assert.equal(parseQuickLine('우유 900ml', TODAY), null)
  assert.equal(parseQuickLine('   ', TODAY), null)
})

test('원 표시 없이 맨숫자가 여럿이면 가장 큰 값을 금액으로 추정하고 표시한다', () => {
  assert.deepEqual(parseQuickLine('21500 우유 2', TODAY), { amount: 21500, memo: '우유 2', date: undefined, amountGuessed: true })
  assert.equal(parseQuickLine('냉동피자 4 15170', TODAY)?.amountGuessed, true)
})

test('사용자가 실제로 붙여넣는 형식: 맨 앞 날짜(YYMMDD) + 상품명 + 금액원', () => {
  const { parsed, failed } = parseQuickLines([
    '261001 카스 디지털 체중계 X15 21500원',
    '261001 풀무원 노엣지피자 코리안 BBQ 15170원',
    '261001 곰곰 신선한 1A 우유, 900ml, 2개 3690원',
    '261001 콘칲 크라운 C콘칲 군옥수수맛, 70g, 1개 1290원',
  ].join('\n'), TODAY)
  assert.deepEqual(failed, [])
  assert.deepEqual(parsed.map((p) => [p.date, p.amount, p.memo, p.amountGuessed]), [
    ['2026-10-01', 21500, '카스 디지털 체중계 X15', false],
    ['2026-10-01', 15170, '풀무원 노엣지피자 코리안 BBQ', false],
    ['2026-10-01', 3690, '곰곰 신선한 1A 우유, 900ml, 2개', false],
    ['2026-10-01', 1290, '콘칲 크라운 C콘칲 군옥수수맛, 70g, 1개', false],
  ])
  // 피자는 쓰임새가 갈려 사전에 없다 → 한 번 고르면 다음부터 기억
  assert.deepEqual(parsed.map((p) => classifyMemo(p.memo).categoryId), ['gadget', 'etc', 'grocery_basic', 'grocery_snack'])
  assert.equal(classifyMemo(parsed[1].memo).source, 'none')
})

test('맨 앞 날짜 형식들, 미래·없는 날짜는 날짜로 보지 않는다', () => {
  assert.equal(parseLeadingDate('261001', TODAY), '2026-10-01')
  assert.equal(parseLeadingDate('20261001', TODAY), '2026-10-01')
  assert.equal(parseLeadingDate('2026-10-01', TODAY), '2026-10-01')
  assert.equal(parseLeadingDate('26.10.1', TODAY), '2026-10-01')
  assert.equal(parseLeadingDate('10/1', TODAY), '2026-10-01')
  // 월/일만 썼는데 올해로는 미래면 작년
  assert.equal(parseLeadingDate('12/30', TODAY), '2025-12-30')
  assert.equal(parseLeadingDate('261231', TODAY), null)
  assert.equal(parseLeadingDate('260231', TODAY), null)
  assert.equal(parseLeadingDate('150000', TODAY), null)
  assert.equal(parseLeadingDate('21500', TODAY), null)
  // 날짜만 있는 줄은 날짜가 아니라 금액으로 본다
  assert.equal(parseQuickLine('261001', TODAY)?.date, undefined)
})

test('여러 줄 붙여넣기: 금액 없는 줄은 failed로 돌려준다', () => {
  const { parsed, failed } = parseQuickLines('냉동피자 15170\n\n콘칩 1,290원\n그냥 메모\n')
  assert.equal(parsed.length, 2)
  assert.deepEqual(failed, ['그냥 메모'])
})

test('자동 분류: 물건 기준, 긴 단어 우선, 영문 약어는 단어 경계에서만', () => {
  assert.equal(classifyMemo('풀무원 노엣지피자 냉동').categoryId, 'grocery_ready')
  assert.equal(classifyMemo('곰곰 신선한 1A 우유').categoryId, 'grocery_basic')
  assert.equal(classifyMemo('콘칩 군옥수수맛').categoryId, 'grocery_snack')
  assert.equal(classifyMemo('카스 디지털 체중계').categoryId, 'gadget')
  assert.equal(classifyMemo('스타벅스 커피').categoryId, 'cafe')
  assert.equal(classifyMemo('자동차보험 갱신').categoryId, 'car')
  assert.equal(classifyMemo('이마트24 삼각김밥').categoryId, 'convenience')
  assert.equal(classifyMemo('CU 도시락').categoryId, 'convenience')
  // 상호만 적어도 분류된다. 식당 메뉴에 든 "고기"는 식재료가 아니다(긴 단어가 이긴다).
  assert.equal(classifyMemo('CU(씨유)제기한신점').categoryId, 'convenience')
  assert.equal(classifyMemo('뚝배기불고기').categoryId, 'eat_out')
  assert.equal(classifyMemo('맥모닝콤보').categoryId, 'eat_out')
  assert.equal(classifyMemo('교통요금').categoryId, 'transit')
  assert.equal(classifyMemo('흑당라떼, 아이스초코').categoryId, 'cafe')
  // "cu"가 다른 영단어 속에 있으면 걸리지 않는다
  assert.equal(classifyMemo('cucumber').source, 'none')
  // 쓰임새가 갈리는 메모는 모른다고 답한다(사용자가 고르게)
  const unknown = classifyMemo('피자')
  assert.equal(unknown.source, 'none')
  assert.equal(unknown.categoryId, 'etc')
})

test('고친 기록이 사전보다 우선하고, 짧은 열쇠말은 긴 메모 안에서도 걸린다', () => {
  const learned = [{ keyword: '피자', categoryId: 'grocery_ready' }, { keyword: '스타벅스', categoryId: 'eat_out' }]
  assert.deepEqual(classifyMemo('도미노 피자', learned), { categoryId: 'grocery_ready', source: 'learned', matched: '피자' })
  assert.equal(classifyMemo('스타벅스 커피', learned).categoryId, 'eat_out')
  // 분류표에 없는 소분류로 학습된 기록은 무시한다
  assert.equal(classifyMemo('우유', [{ keyword: '우유', categoryId: 'deleted' }]).categoryId, 'grocery_basic')
})

test('학습 열쇠말은 수량·용량·모델명 토큰을 뺀다', () => {
  assert.equal(learnKeyword('냉동피자 4판'), '냉동피자')
  assert.equal(learnKeyword('곰곰 우유 900ml 2개'), '곰곰 우유')
  assert.equal(learnKeyword('체중계 X15'), '체중계')
  assert.equal(learnKeyword('15170'), '')
})

test('제안 버튼: 자주 쓴 소분류 순, 모자라면 흔한 것으로 채운다', () => {
  assert.deepEqual(suggestCategories(['cafe', 'delivery', 'cafe', 'nope']), ['cafe', 'delivery', 'grocery_basic'])
  assert.equal(suggestCategories([]).length, 3)
})

test('줄일 수 있나: 못 줄이는 몫을 떼고 나머지는 항목의 단계로', () => {
  assert.deepEqual(splitByCut({ categoryId: 'grocery_basic', amount: 600000 }), { must: 600000, trim: 0, drop: 0 })
  assert.deepEqual(splitByCut({ categoryId: 'grocery_ready', amount: 600000, mustPart: 400000 }), { must: 400000, trim: 200000, drop: 0 })
  assert.deepEqual(splitByCut({ categoryId: 'cafe', amount: 50000 }), { must: 0, trim: 0, drop: 50000 })
  // 사용자가 기본값을 바꿀 수 있다
  assert.deepEqual(splitByCut({ categoryId: 'cafe', amount: 50000, cut: 'must' }), { must: 50000, trim: 0, drop: 0 })
  // 못 줄이는 몫이 금액보다 크면 금액까지만
  assert.deepEqual(splitByCut({ categoryId: 'eat_out', amount: 10000, mustPart: 99999 }), { must: 10000, trim: 0, drop: 0 })
})

test('요약: 포인트는 소비에는 넣고 현금 지출에서는 뺀다', () => {
  const s = summarizeItems([
    { categoryId: 'gadget', amount: 21500, payment: 'point_once' },
    { categoryId: 'grocery_ready', amount: 15170 },
    { categoryId: 'grocery_basic', amount: 3690 },
    { categoryId: 'sub_media', amount: 17000, payment: 'point_regular' },
  ])
  assert.equal(s.consumption, 57360)
  assert.equal(s.cash, 18860)
  assert.equal(s.pointOnce, 21500)
  assert.equal(s.pointRegular, 17000)
  assert.deepEqual(s.cashByCut, { must: 3690, trim: 15170, drop: 0 })
  assert.equal(s.consumptionByCut.drop, 17000)
  assert.equal(s.byKind.fixed, 17000)
  // 대분류 순위는 포인트 포함 소비 기준
  assert.deepEqual(s.byMajor.map((m) => [m.major, m.amount]), [['생활용품', 21500], ['식재료', 18860], ['구독', 17000]])
})

test('비교: 소분류 단위, 변화 큰 순, 양쪽 0은 제외', () => {
  const prev = summarizeItems([{ categoryId: 'cafe', amount: 30000 }, { categoryId: 'grocery_basic', amount: 400000 }])
  const curr = summarizeItems([{ categoryId: 'cafe', amount: 10000 }, { categoryId: 'grocery_ready', amount: 80000 }, { categoryId: 'grocery_basic', amount: 400000 }])
  const changes = compareSummaries(prev, curr)
  assert.deepEqual(changes.map((c) => [c.categoryId, c.difference]), [['grocery_ready', 80000], ['cafe', -20000], ['grocery_basic', 0]])
})

test('지금 상태 점검: 투자 가능액·최대로 줄이면·포인트 없을 때·비상자금 기준', () => {
  const r = evaluateFlowCheck({
    monthlyIncome: 4_000_000,
    reserveMonthly: 200_000,
    fixed: [
      { categoryId: 'rent', amount: 900_000 },
      { categoryId: 'sub_media', amount: 17_000 },
      { categoryId: 'phone', amount: 55_000, mustPart: 30_000 },
    ],
    variable: [
      { categoryId: 'grocery_basic', amount: 400_000 },
      { categoryId: 'grocery_ready', amount: 200_000, payment: 'point_regular' },
      { categoryId: 'delivery', amount: 150_000 },
      { categoryId: 'gadget', amount: 21_500, payment: 'point_once' },
    ],
    irregular: [{ categoryId: 'car', label: '자동차보험', yearlyAmount: 600_000, months: [8] }],
  })
  // 현금 지출 = 900,000 + 17,000 + 55,000 + 400,000 + 150,000 + 50,000(보험 월할) = 1,572,000
  assert.equal(r.summary.cash, 1_572_000)
  assert.equal(r.available, 4_000_000 - 1_572_000 - 200_000)
  assert.equal(r.availableWithoutOncePoints, r.available - 21_500)
  assert.equal(r.availableWithoutPoints, r.available - 21_500 - 200_000)
  // 현금 중 못 줄임 = 월세 900,000 + 휴대폰 30,000 + 기본 식재료 400,000 + 보험 월할 50,000
  assert.equal(r.maxIfCut, 4_000_000 - 1_380_000 - 200_000)
  assert.equal(r.room, 17_000 + 25_000 + 150_000)
  assert.equal(r.room, r.maxIfCut - r.available)
  assert.deepEqual(r.topCuttable.map((t) => t.categoryId), ['delivery', 'phone', 'sub_media'])
  // 비상자금 기준은 포인트로 낸 못 줄이는 소비까지 포함(여기선 포인트 항목이 trim이라 동일)
  assert.equal(r.mustMonthly, 1_380_000)
  assert.equal(r.irregularDueByMonth[8], 600_000)
  // 고정 972,000 ÷ 소비 1,793,500(포인트·비정기 월할 포함)
  assert.equal(r.fixedRatio, 972_000 / 1_793_500)
})

test('비정기: 여러 달에 나눠 내면 달별로 나누고 나머지는 첫 달에', () => {
  const r = evaluateFlowCheck({ monthlyIncome: 0, reserveMonthly: 0, fixed: [], variable: [], irregular: [
    { categoryId: 'tax', label: '자동차세', yearlyAmount: 300_001, months: [12, 6] },
  ] })
  assert.equal(r.irregularDueByMonth[6], 150_001)
  assert.equal(r.irregularDueByMonth[12], 150_000)
  assert.equal(r.fixedRatio, 0)
  assert.equal(evaluateFlowCheck({ monthlyIncome: 0, reserveMonthly: 0, fixed: [], variable: [], irregular: [] }).fixedRatio, null)
})

test('시드 만들기로 넘길 금액은 현금 기준, 큰 항목으로 묶는다', () => {
  const seed = toSeedExpenses([
    { categoryId: 'grocery_basic', amount: 400_000 },
    { categoryId: 'delivery', amount: 100_000 },
    { categoryId: 'grocery_ready', amount: 50_000, payment: 'point_once' },
    { categoryId: 'rent', amount: 900_000 },
    { categoryId: 'sub_media', amount: 17_000 },
  ])
  assert.equal(seed.food, 500_000)
  assert.equal(seed.housing, 900_000)
  assert.equal(seed.subscriptions, 17_000)
  assert.equal(categoryById('delivery')?.seed, 'food')
})

const now = new Date('2026-10-06T03:00:00Z')

test('빠른 기록 입력 검증: 미래 날짜·없는 소분류·포인트 종류·못 줄이는 몫 초과 거절', () => {
  const ok = { date: '2026-10-06', amount: 15170, memo: '냉동피자 4판', categoryId: 'grocery_ready' }
  assert.deepEqual(normalizeFlowEntry(ok, now), { spent_on: '2026-10-06', amount: 15170, memo: '냉동피자 4판', category_id: 'grocery_ready', cut_level: null, must_part: null, payment: 'cash' })
  assert.equal(normalizeFlowEntry({ ...ok, date: '2026-10-07' }, now), null)
  assert.equal(normalizeFlowEntry({ ...ok, date: '2026-02-30' }, now), null)
  assert.equal(normalizeFlowEntry({ ...ok, amount: 0 }, now), null)
  assert.equal(normalizeFlowEntry({ ...ok, amount: 1.5 }, now), null)
  assert.equal(normalizeFlowEntry({ ...ok, categoryId: 'secret' }, now), null)
  assert.equal(normalizeFlowEntry({ ...ok, payment: 'gift' }, now), null)
  assert.equal(normalizeFlowEntry({ ...ok, payment: 'point_once' }, now)?.payment, 'point_once')
  assert.equal(normalizeFlowEntry({ ...ok, cut: 'later' }, now), null)
  assert.equal(normalizeFlowEntry({ ...ok, mustPart: 20000 }, now), null)
  assert.equal(normalizeFlowEntry({ ...ok, mustPart: 10000 }, now)?.must_part, 10000)
  assert.equal(normalizeFlowEntry({ ...ok, memo: 'x'.repeat(101) }, now), null)
})

test('점검 저장 검증: 금액·소분류·달·항목 수를 확인한다', () => {
  const input = {
    monthlyIncome: 4_000_000, reserveMonthly: 200_000,
    fixed: [{ categoryId: 'rent', amount: 900_000, label: '월세' }],
    variable: [{ categoryId: 'grocery_basic', amount: 400_000 }],
    irregular: [{ categoryId: 'car', label: '자동차보험', yearlyAmount: 600_000, months: [8, 8] }],
  }
  const check = normalizeFlowCheck({ input }, now)
  assert.equal(check?.checked_on, '2026-10-06')
  assert.deepEqual(check?.input.irregular[0].months, [8])
  assert.equal(normalizeFlowCheck({ input: { ...input, monthlyIncome: -1 } }, now), null)
  assert.equal(normalizeFlowCheck({ input: { ...input, fixed: [{ categoryId: 'nope', amount: 1 }] } }, now), null)
  assert.equal(normalizeFlowCheck({ input: { ...input, irregular: [{ ...input.irregular[0], months: [13] }] } }, now), null)
  assert.equal(normalizeFlowCheck({ input: { ...input, variable: Array(81).fill(input.variable[0]) } }, now), null)
  assert.equal(normalizeFlowCheck({ input, date: '2026-10-07' }, now), null)
})

test('로그인 없는 돈 흐름 조회는 차단한다', async () => {
  let statusCode = 0
  const response = {
    setHeader: () => response,
    status: (code: number) => { statusCode = code; return response },
    json: () => response,
    end: () => response,
  }
  await handler({ method: 'GET', headers: {}, query: { from: '2026-10-01', to: '2026-10-31' } } as unknown as VercelRequest, response as unknown as VercelResponse)
  assert.equal(statusCode, 401)
})

test('보는 사람 기준 표시: 기록한 사람이 아닌 쪽이 고치면 고친 사람, 지우면 지운 사람. client_id는 내보내지 않는다', () => {
  const base = { id: 'x', client_id: 'wife', spent_on: '2026-10-01', amount: 1000, memo: '우유', category_id: 'grocery_basic', cut_level: null, must_part: null, payment: 'cash', updated_by_client_id: null, deleted_at: null, deleted_by_client_id: null }
  const own = toEntry(base, 'wife')
  assert.equal(own.mine, true)
  assert.equal(own.editedBy, null)
  assert.equal('client_id' in own, false)
  // 남편이 고침 → 아내 화면에선 "배우자가 고침", 남편 화면에선 "내가 고침"
  const edited = { ...base, updated_by_client_id: 'husband' }
  assert.equal(toEntry(edited, 'wife').editedBy, 'partner')
  assert.equal(toEntry(edited, 'husband').editedBy, 'me')
  assert.equal(toEntry(edited, 'husband').mine, false)
  // 본인이 고친 건 표시하지 않는다
  assert.equal(toEntry({ ...base, updated_by_client_id: 'wife' }, 'husband').editedBy, null)
  const removed = toEntry({ ...base, deleted_at: '2026-10-06T00:00:00Z', deleted_by_client_id: 'husband' }, 'wife')
  assert.equal(removed.deletedBy, 'partner')
  const split = splitDeleted([own, removed])
  assert.deepEqual([split.entries.length, split.deleted.length], [1, 1])
})
