import { describe, expect, it } from 'vitest'
import { rankStockMatches } from './stockSearch'
import type { StockItem } from './stockCache'

const st = (code: string, name: string, liquidity: number | null = null): StockItem => ({ code, name, sector_id: null, liquidity, updated_at: null })

describe('rankStockMatches', () => {
  const all = [
    st('000001', '한화삼성', 5),
    st('005930', '삼성전자', 900),
    st('006400', '삼성SDI', 300),
    st('028260', '삼성물산', 100),
    st('999999', '삼성', 1),
  ]

  it('이름 정확 일치 → 앞부분 일치 → 포함 순, 같은 순위는 거래대금 큰 순', () => {
    expect(rankStockMatches(all, '삼성').map((s) => s.name)).toEqual(['삼성', '삼성전자', '삼성SDI', '삼성물산', '한화삼성'])
  })

  it('코드 정확 일치가 먼저, 코드 일부도 찾는다', () => {
    expect(rankStockMatches(all, '005930')[0].name).toBe('삼성전자')
    expect(rankStockMatches(all, '0059').map((s) => s.code)).toEqual(['005930'])
  })

  it('공백·특수문자를 무시하고 대소문자를 구분하지 않는다', () => {
    expect(rankStockMatches(all, ' 삼성 sdi ')[0].code).toBe('006400')
  })

  it('빈 검색어는 빈 목록, 개수는 limit까지', () => {
    expect(rankStockMatches(all, '  ')).toEqual([])
    expect(rankStockMatches(all, '삼성', 2)).toHaveLength(2)
  })
})
