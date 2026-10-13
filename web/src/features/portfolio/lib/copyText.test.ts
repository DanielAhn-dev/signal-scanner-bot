import { describe, expect, it } from 'vitest'
import { buildQuantityText } from './share'
import type { HoldingRow } from '../types'

const row = (code: string, name: string, quantity: number, avg_price: number, close?: number, account = 'A'): HoldingRow =>
  ({ code, stock_name: name, quantity, avg_price, stock: close ? { close } : undefined, broker_name: 'NH', account_name: account } as unknown as HoldingRow)

describe('buildQuantityText', () => {
  const rows = [
    row('069500', 'KODEX 200', 100, 100000),
    row('005930', '삼성전자', 2, 55000),
    row('329200', 'TIGER 리츠부동산인프라', 600, 4000),
    row('069500', 'KODEX 200', 100, 110000, undefined, 'B'),
  ]

  it('역할별: 같은 종목 합산·평단 가중평균, 소계와 합계', () => {
    const t = buildQuantityText(rows, 'role')
    expect(t).toContain('069500 / KODEX 200 / 105,000원 / 200주')
    expect(t.indexOf('■ 성장 (지수)')).toBeLessThan(t.indexOf('■ 인컴 (리츠·인프라)'))
    expect(t).toMatch(/■ 성장 \(지수\) · 1종목 · .+ · 비중 \d+%/)
    expect(t).toContain('합계')
  })

  it('묶지 않음: 제목 없이 줄만', () => {
    const t = buildQuantityText(rows, 'plain')
    expect(t).not.toContain('■')
    expect(t.split('\n')).toHaveLength(3)
  })

  it('브랜드별·계좌별', () => {
    expect(buildQuantityText(rows, 'brand')).toContain('■ KODEX')
    expect(buildQuantityText(rows, 'brand')).toContain('■ 개별주·기타')
    expect(buildQuantityText(rows, 'account')).toContain('■ NH / A')
  })
})
