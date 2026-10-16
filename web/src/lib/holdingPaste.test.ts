import { describe, expect, it } from 'vitest'
import { parseHoldingLines, parsePasteDate } from './holdingPaste'

const stocks = [
  { code: '005930', name: '삼성전자' },
  { code: '005935', name: '삼성전자우' },
  { code: '069500', name: 'KODEX 200' },
  { code: '360750', name: 'TIGER 미국S&P500' },
  { code: '000660', name: 'SK하이닉스' },
]
const today = '2026-10-16'

describe('보유 종목 붙여넣기', () => {
  it('종목명·수량·평균매수가를 공백·탭·쉼표 어느 것으로 나눠도 읽는다', () => {
    const rows = parseHoldingLines('삼성전자 10 72000\nSK하이닉스\t3\t180,000원\n005935,5,60000', stocks, today)
    expect(rows.map((r) => [r.code, r.quantity, r.avgPrice, r.error])).toEqual([
      ['005930', 10, 72000, null],
      ['000660', 3, 180000, null],
      ['005935', 5, 60000, null],
    ])
  })

  it('이름에 숫자가 있는 ETF도 이름과 수량을 헷갈리지 않는다', () => {
    const [a, b] = parseHoldingLines('KODEX 200 25 35000\nkodex200 10 34,500 250312', stocks, today)
    expect([a.code, a.quantity, a.avgPrice, a.buyDate]).toEqual(['069500', 25, 35000, null])
    expect([b.code, b.quantity, b.avgPrice, b.buyDate]).toEqual(['069500', 10, 34500, '2025-03-12'])
  })

  it('"10주 72,000원"처럼 단위를 붙여도, 이름에 공백이 있어도 읽는다', () => {
    const [r] = parseHoldingLines('TIGER 미국S&P500 12주 21,350원 2026-01-05', stocks, today)
    expect([r.code, r.quantity, r.avgPrice, r.buyDate, r.error]).toEqual(['360750', 12, 21350, '2026-01-05', null])
  })

  it('이름이 정확히 맞지 않으면 후보만 보여 주고 고르지 않는다(후보가 1개여도)', () => {
    const [r] = parseHoldingLines('하이닉스 3 180000', stocks, today)
    expect(r.code).toBeNull()
    expect(r.candidates.map((c) => c.code)).toEqual(['000660'])
    expect(r.error).toMatch(/고르세요/)
  })

  it('수량·가격이 없거나 잘못되면 그 줄만 오류로 남긴다', () => {
    const rows = parseHoldingLines('삼성전자 10\n삼성전자우 1.5 60000\nSK하이닉스 3 180000 261231', stocks, today)
    expect(rows[0].error).toMatch(/수량과 평균매수가/)
    expect(rows[1].error).toMatch(/정수/)
    expect(rows[2].error).toMatch(/오늘 이후/)
  })

  it('같은 종목이 두 줄이면 둘 다 표시한다', () => {
    const rows = parseHoldingLines('삼성전자 10 72000\n005930 5 70000', stocks, today)
    expect(rows.every((r) => /두 번/.test(r.error ?? ''))).toBe(true)
  })

  it('날짜 모양: 6자리·8자리·구분자, 없는 날짜는 거른다', () => {
    expect(parsePasteDate('250312')).toBe('2025-03-12')
    expect(parsePasteDate('20250312')).toBe('2025-03-12')
    expect(parsePasteDate('2025.3.12')).toBe('2025-03-12')
    expect(parsePasteDate('250231')).toBeNull()
  })
})
