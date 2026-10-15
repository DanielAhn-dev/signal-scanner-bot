import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  FLOW_CATEGORIES, categoryById, classifyMemo, compareSummaries, detectPayment, splitPartnerWord, evaluateFlowCheck, learnKeyword, needsItemName, parseAmountToken,
  checkForMonth, fixedCashOf, fixedHistory, fixedOutsideCardOf, irregularDueIn, irregularForMonth, irregularHistory, matchesIrregular, monthSpending, seedExpenseTotal, seedFromCheck, seedPlanFromFlow, splitCashWord, parseLeadingDate, parseQuickLine, parseQuickLines, reconcileMonth, slotsForMonth, splitByCut, suggestCategories, summarizeItems, toSeedExpenses,
} from '../src/lib/moneyFlow'
import handler, { isMissingTable, normalizeFlowCheck, normalizeFlowEntry, normalizeMonthTotals, splitDeleted, storedForWhom, toEntry, toMonthTotal } from '../handlers/ui/money-flow'

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
  assert.equal(classifyMemo('햄버거세트 쿠폰').categoryId, 'eat_out')
  // 무인 아이스크림 가게는 사 먹은 간식, 마트에서 산 아이스크림은 쟁여 둔 과자
  assert.equal(classifyMemo('아이스크림(무인)').categoryId, 'snack_out')
  assert.equal(classifyMemo('무인 아이스크림 가게').categoryId, 'snack_out')
  assert.equal(classifyMemo('아이스크림').categoryId, 'grocery_snack')
  // 마트는 품목과 상관없이 장보기 한 칸, 편의점 이마트24는 편의점
  assert.equal(classifyMemo('이마트 성수점').categoryId, 'grocery_mart')
  assert.equal(classifyMemo('이마트24').categoryId, 'convenience')
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
  assert.deepEqual(normalizeFlowEntry(ok, now), { spent_on: '2026-10-06', amount: 15170, memo: '냉동피자 4판', category_id: 'grocery_ready', cut_level: null, must_part: null, payment: 'cash', for_whom: 'shared', paid_with: 'card' })
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

test('점검 저장 검증: 자녀 id는 문자열만 받고, 없으면 필드를 만들지 않는다', () => {
  const base = { monthlyIncome: 4_000_000, reserveMonthly: 0, variable: [], irregular: [] }
  const withKid = normalizeFlowCheck({ input: { ...base, fixed: [{ categoryId: 'rent', amount: 1000, childId: 'abc1' }, { categoryId: 'rent', amount: 2000 }] } }, now)
  assert.equal(withKid?.input.fixed[0].childId, 'abc1')
  assert.equal('childId' in (withKid?.input.fixed[1] ?? {}), false)
  assert.equal(normalizeFlowCheck({ input: { ...base, fixed: [{ categoryId: 'rent', amount: 1000, childId: 7 }] } }, now), null)
  assert.equal(normalizeFlowCheck({ input: { ...base, fixed: [{ categoryId: 'rent', amount: 1000, childId: 'x'.repeat(41) }] } }, now), null)
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

test('통로 이름(간편결제·종합 쇼핑몰)만 적으면 산 물건을 묻는다', () => {
  for (const memo of ['네이버페이', 'NAVERPAY 결제', '쿠팡(주)', '카카오페이 주문', 'G마켓', '11번가']) assert.equal(needsItemName(memo), true, memo)
  // 물건이 함께 있거나, 통로 이름 뒤에 다른 가게 이름이 붙으면 묻지 않는다
  for (const memo of ['쿠팡 물티슈', '쿠팡이츠', '네이버플러스 멤버십', 'CU(씨유)제기한신점', '', '알리오올리오']) assert.equal(needsItemName(memo), false, memo)
})

test('환급·캐시백: 소비는 그대로, 현금 지출에서 빼고 그만큼 투자 가능액이 는다', () => {
  // 배우자 교통비 100,000원 중 모두의카드 환급 30,000원, 이벤트 캐시백 5,000원(카페)
  const items = [
    { categoryId: 'transit', amount: 100_000 },
    { categoryId: 'transit', amount: 30_000, payment: 'refund_regular' as const },
    { categoryId: 'cafe', amount: 20_000 },
    { categoryId: 'cafe', amount: 5_000, payment: 'refund_once' as const },
  ]
  const s = summarizeItems(items)
  assert.equal(s.consumption, 120_000)
  assert.equal(s.cash, 85_000)
  assert.deepEqual([s.refundRegular, s.refundOnce], [30_000, 5_000])
  // 대중교통은 못 줄임, 카페는 끊을 수 있음 — 환급은 같은 칸에서 빠진다
  assert.deepEqual(s.cashByCut, { must: 70_000, trim: 0, drop: 15_000 })
  assert.equal(s.consumptionByCut.must, 100_000)
  assert.equal(s.byCategory.find((r) => r.categoryId === 'transit')?.cash, 70_000)

  const r = evaluateFlowCheck({ monthlyIncome: 1_000_000, reserveMonthly: 0, fixed: [], variable: items, irregular: [] })
  assert.equal(r.available, 915_000)
  assert.equal(r.availableWithoutOncePoints, 910_000)
  assert.equal(r.availableWithoutPoints, 880_000)
  assert.deepEqual(r.topCuttable, [{ categoryId: 'cafe', trim: 0, drop: 15_000 }])
  assert.equal(r.mustMonthly, 100_000)
  assert.equal(toSeedExpenses(items).vehicle, 70_000)
  assert.equal(toSeedExpenses(items).food, 15_000)
})

test('환급이 그 칸 지출보다 커도 줄일 수 있나 칸과 시드 지출은 음수가 되지 않는다', () => {
  const items = [{ categoryId: 'cafe', amount: 9_000, payment: 'refund_once' as const }]
  assert.deepEqual(summarizeItems(items).cashByCut, { must: 0, trim: 0, drop: 0 })
  assert.equal(summarizeItems(items).cash, -9_000)
  assert.equal(toSeedExpenses(items).food, 0)
})

test('메모로 환급을 알아본다: 교통 환급 카드는 매달, 그 밖의 캐시백은 이번만', () => {
  assert.equal(detectPayment('모두의카드 환급'), 'refund_regular')
  assert.equal(detectPayment('K-패스 환급금'), 'refund_regular')
  assert.equal(classifyMemo('K-패스 환급금').categoryId, 'transit')
  assert.equal(detectPayment('모두의 카드 환급'), 'refund_regular')
  assert.equal(detectPayment('신한카드 캐시백'), 'refund_once')
  assert.equal(detectPayment('스타벅스'), 'cash')
  assert.equal(classifyMemo('모두의카드 환급').categoryId, 'transit')
  const now = new Date('2026-10-06T03:00:00Z')
  assert.equal(normalizeFlowEntry({ date: '2026-10-05', amount: 23000, memo: '모두의카드 환급', categoryId: 'transit', payment: 'refund_regular' }, now)?.payment, 'refund_regular')
  assert.equal(normalizeFlowEntry({ date: '2026-10-05', amount: 23000, memo: '', categoryId: 'transit', payment: 'refund' }, now), null)
})

test('"배우자"는 메모 어디에 있어도 배우자 몫으로 보고, 분류는 그 단어를 뺀 메모로 한다', () => {
  for (const memo of ['배우자 모두의 카드 환급', '모두의 카드 배우자 환급', '모두의카드 환급 배우자', '배우자의 모두의 카드 환급']) {
    const { memo: rest, forPartner } = splitPartnerWord(memo)
    assert.equal(forPartner, true, memo)
    assert.ok(!rest.includes('배우자'), memo)
    assert.equal(classifyMemo(rest).categoryId, 'transit', memo)
    assert.equal(detectPayment(rest), 'refund_regular', memo)
  }
  assert.deepEqual(splitPartnerWord('교통카드 충전'), { memo: '교통카드 충전', forPartner: false })
  const now = new Date('2026-10-06T03:00:00Z')
  const ok = { date: '2026-10-05', amount: 62000, memo: '교통카드', categoryId: 'transit' }
  assert.equal(normalizeFlowEntry({ ...ok, forWhom: 'partner' }, now)?.for_whom, 'partner')
  assert.equal(normalizeFlowEntry({ ...ok, forWhom: 'me' }, now)?.for_whom, 'me')
  // 따로 고르지 않으면 공용 — 기록은 한 사람이 해도 지출은 대부분 집 공용이다
  assert.equal(normalizeFlowEntry(ok, now)?.for_whom, 'shared')
  assert.equal(normalizeFlowEntry({ ...ok, forWhom: 'kid' }, now), null)
})

test('누구 몫은 보는 사람 기준으로 뒤집어 보여 준다', () => {
  const row = { id: 'x', client_id: 'wife', spent_on: '2026-10-05', amount: 62000, memo: '교통카드', category_id: 'transit', payment: 'cash' }
  // 아내가 자기 몫으로 적은 기록: 아내에겐 '나', 남편에겐 '배우자'
  assert.equal(toEntry({ ...row, for_whom: 'me' }, 'wife').forWhom, 'me')
  assert.equal(toEntry({ ...row, for_whom: 'me' }, 'husband').forWhom, 'partner')
  // 아내가 남편 몫으로 적은 기록: 아내에겐 '배우자', 남편에겐 '나'
  assert.equal(toEntry({ ...row, for_whom: 'partner' }, 'wife').forWhom, 'partner')
  assert.equal(toEntry({ ...row, for_whom: 'partner' }, 'husband').forWhom, 'me')
  // 공용은 누가 보든 공용
  assert.equal(toEntry({ ...row, for_whom: 'shared' }, 'wife').forWhom, 'shared')
  assert.equal(toEntry({ ...row, for_whom: 'shared' }, 'husband').forWhom, 'shared')
})

test('누구 몫을 고쳐 저장하면 고친 사람 화면에 고른 그대로 보인다(배우자 기록을 고쳐도)', () => {
  const row = { id: 'x', client_id: 'wife', spent_on: '2026-10-05', amount: 62000, memo: '교통카드', category_id: 'transit', payment: 'cash' }
  for (const viewer of ['wife', 'husband']) {
    for (const pick of ['shared', 'me', 'partner'] as const) {
      const stored = storedForWhom(pick, row.client_id, viewer)
      assert.equal(toEntry({ ...row, for_whom: stored }, viewer).forWhom, pick, `${viewer} ${pick}`)
    }
  }
})

test('월 합계: 세부를 일부만 적으면 차액이 세부 안 적음으로 남고, 환급은 합계에서 따로 뺀다', () => {
  const summary = summarizeItems([
    { categoryId: 'cafe', amount: 20_000 },
    { categoryId: 'transit', amount: 30_000, payment: 'refund_regular' as const },
    { categoryId: 'eat_out', amount: 10_000, payment: 'point_regular' as const },
  ])
  const r = reconcileMonth([
    { label: 'A카드', kind: 'cash', amount: 1_000_000 }, { label: '현금', kind: 'cash', amount: 50_000 }, { label: '포인트', kind: 'point', amount: 32_000 },
  ], summary)
  assert.deepEqual([r.cashTotal, r.detailedCash, r.unrecordedCash], [1_050_000, 20_000, 1_030_000])
  assert.deepEqual([r.pointTotal, r.unrecordedPoint], [32_000, 22_000])
  assert.equal(r.cash, 1_020_000)
  assert.equal(r.consumption, 1_082_000)
  assert.equal(r.overCash, false)
})

test('월 합계: 합계가 없으면 세부 기록 그대로, 세부가 합계보다 많으면 막지 않고 표시만 한다', () => {
  const summary = summarizeItems([{ categoryId: 'cafe', amount: 20_000 }])
  const none = reconcileMonth([], summary)
  assert.deepEqual([none.cashTotal, none.unrecordedCash, none.cash, none.overCash], [20_000, 0, 20_000, false])
  const over = reconcileMonth([{ label: '카드', kind: 'cash', amount: 15_000 }], summary)
  assert.deepEqual([over.unrecordedCash, over.overCash, over.cash], [0, true, 20_000])
})

test('월 합계 칸: 이 달 칸 → 지난달 칸 이름(금액 빈칸) → 기본 칸', () => {
  const all = [
    { month: '2026-08', label: 'A카드', kind: 'cash' as const, amount: 900_000 },
    { month: '2026-09', label: 'B카드', kind: 'cash' as const, amount: 300_000 },
    { month: '2026-09', label: '포인트', kind: 'point' as const, amount: 10_000 },
  ]
  assert.deepEqual(slotsForMonth('2026-09', all).map((t) => [t.label, t.amount]), [['B카드', 300_000], ['포인트', 10_000]])
  assert.deepEqual(slotsForMonth('2026-10', all).map((t) => [t.label, t.kind, t.amount]), [['B카드', 'cash', null], ['포인트', 'point', null]])
  assert.deepEqual(slotsForMonth('2026-07', all).map((t) => t.label), ['카드'])
})

test('월 합계 저장 검증: 이번 달 이후·겹치는 이름·빈 이름·잘못된 종류는 거절, 빈 목록은 지우기', () => {
  const now = new Date('2026-10-15T03:00:00Z')
  const ok = { label: 'A카드', kind: 'cash', amount: 1_240_000 }
  assert.deepEqual(normalizeMonthTotals({ month: '2026-10', totals: [ok, { label: ' 포인트 ', kind: 'point', amount: 0 }] }, now)?.totals.map((t) => t.label), ['A카드', '포인트'])
  assert.deepEqual(normalizeMonthTotals({ month: '2026-09', totals: [] }, now)?.totals, [])
  assert.equal(normalizeMonthTotals({ month: '2026-11', totals: [ok] }, now), null)
  assert.equal(normalizeMonthTotals({ month: '2026-13', totals: [ok] }, now), null)
  assert.equal(normalizeMonthTotals({ month: '2026-10', totals: [ok, { ...ok, amount: 1 }] }, now), null)
  assert.equal(normalizeMonthTotals({ month: '2026-10', totals: [{ ...ok, label: '  ' }] }, now), null)
  assert.equal(normalizeMonthTotals({ month: '2026-10', totals: [{ ...ok, kind: 'refund' }] }, now), null)
  assert.equal(normalizeMonthTotals({ month: '2026-10', totals: [{ ...ok, amount: -1 }] }, now), null)
  assert.equal(normalizeMonthTotals({ month: '2026-10', totals: Array.from({ length: 13 }, (_, i) => ({ ...ok, label: `카드${i}` })) }, now), null)
  assert.deepEqual(toMonthTotal({ client_id: 'wife', month: '2026-10-01', label: 'A카드', kind: 'cash', amount: '1000' }, 'husband'), { month: '2026-10', label: 'A카드', kind: 'cash', amount: 1000, mine: false })
})

test('세부 기록에는 "세부 안 적음" 분류를 쓸 수 없고, 합계 테이블이 없을 때만 그 기능을 끈다', () => {
  const now = new Date('2026-10-06T03:00:00Z')
  assert.equal(normalizeFlowEntry({ date: '2026-10-05', amount: 1000, memo: '', categoryId: 'unrecorded' }, now), null)
  assert.equal(isMissingTable({ code: 'PGRST205' }), true)
  assert.equal(isMissingTable({ code: '42P01' }), true)
  assert.equal(isMissingTable({ code: '57014' }), false)
  assert.equal(isMissingTable(null), false)
})

test('고정비 기준: 그 달 말일까지 저장한 가장 최근 점검, 고정비 현금은 포인트 제외·환급 차감', () => {
  const input = (rent: number) => ({ monthlyIncome: 0, reserveMonthly: 0, variable: [], irregular: [], fixed: [
    { categoryId: 'rent', amount: rent }, { categoryId: 'sub_media', amount: 17_000, payment: 'point_regular' as const }, { categoryId: 'phone', amount: 5_000, payment: 'refund_regular' as const },
  ] })
  const checks = [{ date: '2026-08-31', input: input(900_000) }, { date: '2026-09-15', input: input(950_000) }]
  assert.equal(checkForMonth(checks, '2026-07'), null)
  assert.equal(checkForMonth(checks, '2026-08')?.date, '2026-08-31')
  assert.equal(checkForMonth(checks, '2026-10')?.date, '2026-09-15')
  assert.equal(fixedCashOf(checks[1].input), 945_000)
})

test('고정비 바뀐 기록: 소분류별로 나란히, 없던 항목은 빈칸, 마지막 두 점검 차이', () => {
  const mk = (date: string, fixed: Array<{ categoryId: string; amount: number }>) => ({ date, input: { monthlyIncome: 0, reserveMonthly: 0, variable: [], irregular: [], fixed } })
  const h = fixedHistory([
    mk('2026-09-30', [{ categoryId: 'utilities', amount: 123_000 }, { categoryId: 'maintenance', amount: 280_000 }]),
    mk('2026-08-31', [{ categoryId: 'utilities', amount: 81_000 }]),
    mk('2026-10-31', [{ categoryId: 'utilities', amount: 50_000 }, { categoryId: 'utilities', amount: 40_000 }, { categoryId: 'maintenance', amount: 295_000 }, { categoryId: 'phone', amount: 110_000 }]),
  ])
  assert.deepEqual(h.dates, ['2026-08-31', '2026-09-30', '2026-10-31'])
  assert.deepEqual(h.rows.find((r) => r.categoryId === 'utilities'), { categoryId: 'utilities', amounts: [81_000, 123_000, 90_000], change: -33_000 })
  assert.deepEqual(h.rows.find((r) => r.categoryId === 'maintenance'), { categoryId: 'maintenance', amounts: [null, 280_000, 295_000], change: 15_000 })
  assert.deepEqual(h.rows.find((r) => r.categoryId === 'phone')?.change, null)
  assert.equal(fixedHistory([mk('2026-01-31', []), mk('2026-02-28', []), mk('2026-03-31', []), mk('2026-04-30', []), mk('2026-05-31', [])]).dates[0], '2026-02-28')
})

test('그 달 비정기: 고른 달에만, 여러 달이면 나눠서(나머지는 첫 달), 포인트는 제외', () => {
  const input = { monthlyIncome: 0, reserveMonthly: 0, fixed: [], variable: [], irregular: [
    { categoryId: 'tax', label: '재산세', yearlyAmount: 600_001, months: [9, 7] },
    { categoryId: 'tax', label: '자동차세', yearlyAmount: 300_000, months: [1] },
    { categoryId: 'travel', label: '여행', yearlyAmount: 100_000, months: [7], payment: 'point_once' as const },
  ] }
  assert.equal(irregularDueIn(input, 7), 300_001)
  assert.equal(irregularDueIn(input, 9), 300_000)
  assert.equal(irregularDueIn(input, 1), 300_000)
  assert.equal(irregularDueIn(input, 2), 0)
  assert.equal(evaluateFlowCheck({ ...input, irregular: input.irregular.slice(0, 2) }).irregularDueByMonth[7], 300_001)
})

test('그 달 비정기: 예산 몫과 이름이 같은 실제 기록, 예산에 없는 비정기 기록은 따로', () => {
  const input = { monthlyIncome: 0, reserveMonthly: 0, fixed: [], variable: [], irregular: [
    { categoryId: 'tax', label: '재산세', yearlyAmount: 600_000, months: [7, 9] },
    { categoryId: 'car', label: '자동차보험', yearlyAmount: 900_000, months: [9] },
  ] }
  const records = [
    { categoryId: 'tax', amount: 312_000, memo: '재산 세' },
    { categoryId: 'occasion', amount: 100_000, memo: '축의금' },
    { categoryId: 'delivery', amount: 30_000, memo: '배민' },
  ]
  const r = irregularForMonth(input, 9, records)
  assert.deepEqual(r.rows, [
    { label: '재산세', categoryId: 'tax', expected: 300_000, actual: 312_000 },
    { label: '자동차보험', categoryId: 'car', expected: 900_000, actual: null },
  ])
  assert.equal(r.others, 100_000)
  assert.equal(r.total, 1_312_000)
  // 예산이 없으면 비정기 소분류 기록은 모두 '예산에 없는 비정기'
  assert.equal(irregularForMonth(null, 9, records).total, 412_000)
})

test('비정기 이력: 항목별 연도 합, 시드로는 1년 예산 ÷ 12를 비정기 적립 한 칸으로', () => {
  const input = { monthlyIncome: 0, reserveMonthly: 0, fixed: [{ categoryId: 'rent', amount: 900_000 }], variable: [{ categoryId: 'fuel', amount: 200_000 }], irregular: [
    { categoryId: 'tax', label: '자동차세', yearlyAmount: 300_000, months: [1] },
    { categoryId: 'car', label: '', yearlyAmount: 1_200_000, months: [3] },
  ] }
  const h = irregularHistory(input, [
    { date: '2025-01-20', categoryId: 'tax', amount: 280_000, memo: '자동차세' },
    { date: '2026-01-20', categoryId: 'tax', amount: 275_000, memo: '자동차세' },
    { date: '2026-03-02', categoryId: 'car', amount: 1_150_000, memo: '자동차보험·정비' },
  ])
  assert.deepEqual(h[0], { label: '자동차세', budget: 300_000, byYear: { '2025': 280_000, '2026': 275_000 } })
  assert.deepEqual(h[1].byYear, { '2026': 1_150_000 })
  const seed = seedFromCheck(input)
  assert.equal(seed.irregularFund, 125_000)
  assert.equal(seed.expenses.housing, 900_000)
  assert.equal(seed.expenses.tax, 0)
})

test('시드 지출 합계: 비정기 적립이 있는 달만 낸 달 실제 금액 칸을 빼고, 따로 볼 칸은 제외', () => {
  assert.equal(seedExpenseTotal({ food: 100_000, irregularFund: 125_000, water: 50_000, propertyTax: 300_000 }), 225_000)
  assert.equal(seedExpenseTotal({ food: 100_000, water: 50_000, propertyTax: 300_000 }), 450_000)
  assert.equal(seedExpenseTotal({ food: 100_000, card: 700_000, irregularFund: 10_000, water: 5 }, ['card']), 110_000)
  assert.equal(seedExpenseTotal(undefined), 0)
})

test('현금: 메모의 "현금"으로 표시하고, 카드 합계 밖이라 더한다(환급도 뺀다)', () => {
  assert.deepEqual(splitCashWord('축의금 현금'), { memo: '축의금', paidCash: true })
  assert.deepEqual(splitCashWord('현금으로 시장 장보기'), { memo: '시장 장보기', paidCash: true })
  assert.deepEqual(splitCashWord('스타벅스'), { memo: '스타벅스', paidCash: false })
  assert.deepEqual(splitCashWord('망원시장 서울 페이'), { memo: '망원시장 서울 페이', paidCash: true })
  assert.deepEqual(splitCashWord('엄마 송금'), { memo: '엄마 송금', paidCash: true })
  const card = summarizeItems([{ categoryId: 'delivery', amount: 30_000 }])
  const cash = summarizeItems([{ categoryId: 'occasion', amount: 100_000 }, { categoryId: 'grocery_mart', amount: 20_000 }, { categoryId: 'grocery_mart', amount: 5_000, payment: 'refund_once' as const }])
  const s = monthSpending([{ label: 'A카드', kind: 'cash', amount: 1_500_000 }], card, cash)
  assert.deepEqual([s.cashTotal, s.unrecordedCash, s.cashPaid, s.cash], [1_500_000, 1_470_000, 120_000, 1_615_000])
  const now = new Date('2026-10-06T03:00:00Z')
  const ok = { date: '2026-10-05', amount: 100_000, memo: '축의금', categoryId: 'occasion' }
  assert.equal(normalizeFlowEntry(ok, now)?.paid_with, 'card')
  assert.equal(normalizeFlowEntry({ ...ok, paidWith: 'cash' }, now)?.paid_with, 'cash')
  assert.equal(normalizeFlowEntry({ ...ok, paidWith: 'point' }, now), null)
  assert.equal(toEntry({ id: 'x', client_id: 'a', spent_on: '2026-10-05', amount: 1, memo: '', category_id: 'etc', payment: 'cash', paid_with: 'cash' }, 'a').paidWith, 'cash')
  assert.equal(toEntry({ id: 'x', client_id: 'a', spent_on: '2026-10-05', amount: 1, memo: '', category_id: 'etc', payment: 'cash' }, 'a').paidWith, 'card')
})

test('비정기 예산 밖(비상금): 1년 예산에 있는 분류는 이름이 달라도 예산 안, 없는 분류만 비상금', () => {
  const input = { monthlyIncome: 0, reserveMonthly: 0, fixed: [], variable: [], irregular: [{ categoryId: 'occasion', label: '경조사·명절', yearlyAmount: 1_200_000, months: [2, 9] }] }
  const r = irregularForMonth(input, 5, [
    { categoryId: 'occasion', amount: 100_000, memo: '축의금' },
    { categoryId: 'big_item', amount: 300_000, memo: '세탁기' },
    { categoryId: 'eat_out', amount: 50_000, memo: '외식' },
  ])
  assert.deepEqual([r.rows.length, r.inBudget, r.emergency, r.total], [0, 100_000, 300_000, 400_000])
})

test('시드 계획: 고정·변동·비정기 적립을 항목 내역과 함께, 합계 없는 달은 점검 변동 값', () => {
  const input = {
    monthlyIncome: 0, reserveMonthly: 0,
    fixed: [{ categoryId: 'maintenance', amount: 300_000, label: '관리비' }, { categoryId: 'phone', amount: 110_000, label: '' }],
    variable: [{ categoryId: 'grocery_mart', amount: 500_000 }],
    irregular: [{ categoryId: 'tax', label: '재산세', yearlyAmount: 600_000, months: [9, 7] }, { categoryId: 'car', label: '차량 소모품', yearlyAmount: 210_000, months: [4, 10] }],
  }
  const check = { date: '2026-09-30', input }
  const records = [
    { categoryId: 'fuel', amount: 180_000, memo: '주유' },
    { categoryId: 'tax', amount: 312_000, memo: '재산세' },
    { categoryId: 'occasion', amount: 100_000, memo: '축의금', paidWith: 'cash' as const },
    { categoryId: 'grocery_mart', amount: 40_000, memo: '시장', paidWith: 'cash' as const },
  ]
  const totals = [{ label: 'A카드', kind: 'cash' as const, amount: 1_500_000 }, { label: 'B카드', kind: 'cash' as const, amount: 300_000 }]
  const p = seedPlanFromFlow({ baseMonth: '2026-09', check, totals, records })
  assert.deepEqual(p.fixed, { total: 410_000, items: [{ label: '관리비', amount: 300_000 }, { label: '휴대폰', amount: 110_000 }] })
  // 지출 = 카드 1,800,000 + 현금 140,000 = 1,940,000 → − 고정 410,000 − 비정기(재산세 실제 312,000 + 예산 밖 축의금 100,000)
  assert.equal(p.variable.spending, 1_940_000)
  assert.equal(p.variable.total, 1_118_000)
  assert.deepEqual(p.variable.cards, [{ label: 'A카드', amount: 1_500_000 }, { label: 'B카드', amount: 300_000 }])
  assert.equal(p.variable.cash, 140_000)
  assert.deepEqual(p.variable.recorded, [{ label: '주유·충전', amount: 180_000 }, { label: '장보기(마트)', amount: 40_000 }])
  assert.equal(p.variable.unrecorded, 1_800_000 - 180_000 - 312_000)
  assert.deepEqual(p.irregularFund.items.map((i) => [i.label, i.amount, i.months]), [['재산세', 50_000, [7, 9]], ['차량 소모품', 17_500, [4, 10]]])
  assert.equal(p.irregularFund.total, 67_500)
  assert.deepEqual(p.emergency, { total: 100_000, items: [{ label: '축의금', amount: 100_000 }] })
  assert.equal(p.expected, 410_000 + 1_118_000 + 67_500)
  const noTotals = seedPlanFromFlow({ baseMonth: '2026-09', check, totals: [], records: [] })
  assert.deepEqual([noTotals.variable.source, noTotals.variable.total], ['check', 500_000])
  assert.equal(seedPlanFromFlow({ baseMonth: '2026-09', check: null, totals, records }).variable.source, 'none')
})

test('아이 돌봄비: 고정·못 줄임, "부모님 돌봄비 송금"은 돌봄비로 분류하고 송금이라 현금', () => {
  assert.deepEqual([categoryById('family_care')?.kind, categoryById('family_care')?.cut], ['fixed', 'must'])
  assert.equal(classifyMemo('부모님 돌봄비 송금').categoryId, 'family_care')
  assert.equal(classifyMemo('부모님 용돈').categoryId, 'family_parents')
  assert.equal(splitCashWord('부모님 돌봄비 송금').paidCash, true)
})

test('카드 밖 고정비(대출 자동이체): 매달 기록 없이 그달 지출에 더하고, 변동 계산에서 고정으로 다시 빠진다', () => {
  const input = { monthlyIncome: 0, reserveMonthly: 0, variable: [], irregular: [],
    fixed: [{ categoryId: 'maintenance', amount: 300_000, label: '관리비' }, { categoryId: 'rent', amount: 167_596, label: '대출금', outsideCard: true }] }
  assert.equal(fixedOutsideCardOf(input), 167_596)
  assert.equal(fixedOutsideCardOf(null), 0)
  const empty = summarizeItems([])
  const s = monthSpending([{ label: 'A카드', kind: 'cash', amount: 1_000_000 }], empty, empty, 167_596)
  assert.deepEqual([s.cash, s.outsideCard, s.unrecordedCash], [1_167_596, 167_596, 1_000_000])
  const p = seedPlanFromFlow({ baseMonth: '2026-09', check: { date: '2026-10-01', input }, totals: [{ label: 'A카드', kind: 'cash', amount: 1_000_000 }], records: [] })
  // 지출 1,167,596 − 고정 467,596 = 변동 700,000 (대출금이 변동을 줄이지 않는다)
  assert.deepEqual([p.variable.spending, p.variable.outsideCard, p.variable.total], [1_167_596, 167_596, 700_000])
  const now = new Date('2026-10-06T03:00:00Z')
  assert.equal(normalizeFlowCheck({ input: { monthlyIncome: 0, fixed: [{ categoryId: 'rent', amount: 1, outsideCard: true }] } }, now)?.input.fixed[0].outsideCard, true)
  assert.equal(normalizeFlowCheck({ input: { monthlyIncome: 0, fixed: [{ categoryId: 'rent', amount: 1, outsideCard: 'y' }] } }, now), null)
})

test('비정기 예산 이름 연결: 괄호 설명을 뺀 이름이 메모에 있으면 같은 항목', () => {
  assert.equal(matchesIrregular('엔진오일 교체', '엔진오일(하이브리드)'), true)
  assert.equal(matchesIrregular('재산 세', '재산세'), true)
  assert.equal(matchesIrregular('자동차 보험료 갱신', '자동차보험'), true)
  assert.equal(matchesIrregular('주유', '엔진오일(하이브리드)'), false)
  assert.equal(matchesIrregular('세탁기', '세(기타)'), false)
  const input = { monthlyIncome: 0, reserveMonthly: 0, fixed: [], variable: [], irregular: [{ categoryId: 'car', label: '엔진오일(하이브리드)', yearlyAmount: 240_000, months: [4, 10] }] }
  assert.deepEqual(irregularHistory(input, [{ date: '2026-04-11', categoryId: 'car', amount: 89_000, memo: '엔진오일 교체' }])[0].byYear, { '2026': 89_000 })
  assert.equal(irregularForMonth(input, 4, [{ categoryId: 'car', amount: 89_000, memo: '엔진오일 교체' }]).rows[0].actual, 89_000)
})

test('전기차 충전은 주유와 같은 변동 지출, 교통카드·휴대폰 충전과는 구분', () => {
  assert.equal(classifyMemo('전기차 충전 23000원').categoryId, 'fuel')
  assert.equal(classifyMemo('환경부 급속충전').categoryId, 'fuel')
  assert.equal(classifyMemo('교통카드 충전').categoryId, 'transit')
  assert.equal(categoryById('fuel')?.label, '주유·충전')
})
