import { describe, expect, it } from 'vitest'
import { assembleCaptureText, nameSimilarity, parseTradeCapture, validateCapturedTrade, type BlockRead } from './tradeCapture'

const stocks = [
  { code: '498400', name: 'KODEX 200타겟위클리커버드콜' },
  { code: '0167B0', name: 'SOL 200타겟위클리커버드콜' },
  { code: '0219E0', name: 'KODEX 200커버드콜액티브' },
  { code: '458730', name: 'TIGER 미국배당다우존스' },
  { code: '294400', name: 'KIWOOM 200TR' },
  { code: '278530', name: 'KODEX 200TR' },
]
const today = '2026-10-26'

// 2026-10-26 토스 주문내역 캡처(최신순): 이름 줄 오른쪽에 가격, 아래 줄에 수량·상태
const SCREEN = `
주문내역
주문 예약 시세감지
2026년 10월 26일
KODEX 200타겟위클리커버드콜 주당 15,900원
10주 구매 완료
KODEX 200타겟위클리커버드콜 주당 16,050원
10주 구매 완료
TIGER 미국배당다우존스 주당 14,830원
17주 판매 완료
KODEX 200커버드콜액티브 주당 6,525원
5주 구매 완료
KODEX 200커버드콜액티브
5주 구매 취소
KODEX 200커버드콜액티브 주당 6,520원
5주 구매 완료
2026년 10월 23일
KIWOOM 200TR 주당 110,895원
1주 구매 완료
주식 모으기
KODEX 200TR
24주 구매 미체결
`

describe('주문내역 캡처 읽기', () => {
  it('체결만 오래된 순으로 뽑고 취소·미체결은 건수만 센다', () => {
    const { trades, skipped } = parseTradeCapture(SCREEN, stocks, today)
    expect(skipped).toBe(2)
    expect(trades.map((t) => [t.code, t.side, t.quantity, t.price, t.date, t.error])).toEqual([
      ['294400', 'BUY', 1, 110895, '2026-10-23', null],
      ['0219E0', 'BUY', 5, 6520, '2026-10-26', null],
      ['0219E0', 'BUY', 5, 6525, '2026-10-26', null],
      ['458730', 'SELL', 17, 14830, '2026-10-26', null],
      ['498400', 'BUY', 10, 16050, '2026-10-26', null],
      ['498400', 'BUY', 10, 15900, '2026-10-26', null],
    ])
  })

  it('가격이 별도 줄(오른쪽 칸을 따로 읽음)이어도 종목에 붙인다', () => {
    const text = '2026년 10월 26일\nKODEX 200커버드콜액티브\n5주 구매 완료\n주당 6,530원\nTIGER 미국배당다우존스\n주당 14,830원\n17주 판매 완료'
    const { trades } = parseTradeCapture(text, stocks, today)
    expect(trades.map((t) => [t.code, t.quantity, t.price])).toEqual([
      ['458730', 17, 14830],
      ['0219E0', 5, 6530],
    ])
  })

  it('종목명이 한 글자 틀리면 자동으로 정하지 않고 비슷한 후보만 준다', () => {
    const { trades } = parseTradeCapture('2026년 10월 26일\nKODEX 200타켓위클리커버드콜 주당 16,000원\n20주 구매 완료', stocks, today)
    expect(trades).toHaveLength(1)
    expect(trades[0].code).toBeNull()
    expect(trades[0].candidates[0]?.code).toBe('498400')
    expect(trades[0].error).toMatch(/아래에서 고르세요/)
  })

  it('체결 상태를 못 읽은 줄은 오류로 남기고, 상태가 아예 없는 글자는 무시한다', () => {
    const { trades } = parseTradeCapture('KIWOOM 200TR 주당 110,000원\n3주 구매', stocks, '2026-10-26')
    expect(trades[0].error).toMatch(/체결 완료인지/)
  })

  it('지난 날짜 매도·7일 넘은 매수·미래 날짜는 막는다', () => {
    expect(validateCapturedTrade({ side: 'SELL', quantity: 1, price: 100, date: '2026-10-23' }, today)).toMatch(/매도/)
    expect(validateCapturedTrade({ side: 'BUY', quantity: 1, price: 100, date: '2026-10-10' }, today)).toMatch(/7일/)
    expect(validateCapturedTrade({ side: 'BUY', quantity: 1, price: 100, date: '2026-10-27' }, today)).toMatch(/이후/)
    expect(validateCapturedTrade({ side: 'BUY', quantity: 1, price: 100, date: '2026-10-23' }, today)).toBeNull()
    expect(validateCapturedTrade({ side: 'BUY', quantity: 0, price: 100, date: null }, today)).toMatch(/수량/)
  })

  // 2026-10-26 실제 캡처를 건별·칸별로 읽은 결과(Tesseract kor+eng): 가격·상태는 정확, 긴 ETF 이름 뒤쪽은 깨짐
  const REAL_BLOCKS: BlockRead[] = [
    { kind: 'text', text: '2026년 10월 26일' },
    { kind: 'item', name: 'KODEX 200EIZIRI22|7{HES', price: '주당 15,900원', status: '10주 구매 완료', full: '' },
    { kind: 'item', name: 'KODEX 200E[ZIRI22|7{HES', price: '주당 15,925원', status: '10주 구매 완료', full: '' },
    { kind: 'item', name: 'TIGER 미국배당다우존스', price: '주당 14,830원', status: '17주 판매 완료', full: '' },
    { kind: 'item', name: 'KODEX 200커버드콜액티브', price: '주당 6,525원', status: '5주 구매 완료', full: '' },
    { kind: 'item', name: 'KODEX 200커버드콜액티브', price: '', status: '5주 구매 취소', full: '' },
    { kind: 'item', name: 'KODEX 200커버드콜액티브', price: '주당 6,520원', status: '5주 구매 완료', full: '' },
    { kind: 'text', text: '2026년 10월 23일' },
    // 3줄 블록('주식 모으기')이라 상태 칸이 어긋난 건 — 블록 전체 글자에서 채운다
    { kind: 'item', name: 'KIWOOM 200TR', price: '주당 110,895원', status: '4 7', full: 'KIWOOM 20018\n1주 구매 완료   주당 110,895원\n주식 모으기' },
    { kind: 'item', name: 'KODEX 20018', price: '', status: '24주 구매 미체결', full: '' },
  ]

  it('칸별로 읽은 결과를 합쳐 체결만 뽑고, 깨진 ETF 이름은 보유 종목을 위로 올린 후보로 준다', () => {
    const more = [...stocks, { code: '069500', name: 'KODEX 200' }, { code: '102110', name: 'TIGER 200' }]
    const text = assembleCaptureText(REAL_BLOCKS, more)
    const held = new Set(['498400', '0219E0', '458730', '278530', '069500'])
    const { trades, skipped } = parseTradeCapture(text, more, today, { heldCodes: held })
    expect(skipped).toBe(2)
    expect(trades.map((t) => [t.code, t.side, t.quantity, t.price, t.date])).toEqual([
      ['294400', 'BUY', 1, 110895, '2026-10-23'],
      ['0219E0', 'BUY', 5, 6520, '2026-10-26'],
      ['0219E0', 'BUY', 5, 6525, '2026-10-26'],
      ['458730', 'SELL', 17, 14830, '2026-10-26'],
      [null, 'BUY', 10, 15925, '2026-10-26'],
      [null, 'BUY', 10, 15900, '2026-10-26'],
    ])
    // 이름이 깨진 두 건은 자동 채택하지 않고, 이 계좌에 있는 타겟위클리가 후보 맨 위
    expect(trades[4].candidates[0]?.code).toBe('498400')
    expect(trades[5].candidates[0]?.code).toBe('498400')
  })

  it('이름 유사도: 같으면 1, 한 글자 오독은 높고 다른 종목은 낮다', () => {
    expect(nameSimilarity('KODEX 200TR', 'kodex200tr')).toBe(1)
    expect(nameSimilarity('KODEX 200타켓위클리커버드콜', 'KODEX 200타겟위클리커버드콜')).toBeGreaterThan(0.8)
    expect(nameSimilarity('TIGER 미국배당다우존스', 'KODEX 200TR')).toBeLessThan(0.3)
  })
})
