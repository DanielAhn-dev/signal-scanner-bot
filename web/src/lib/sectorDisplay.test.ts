import { describe, expect, it } from 'vitest'
import { isIndexGroupSector, pickIndustrySectors, sectorChange } from './sectorDisplay'

describe('sectorDisplay', () => {
  it('지수 묶음 이름을 가려낸다', () => {
    expect(isIndexGroupSector('코스피 200 TOP 10')).toBe(true)
    expect(isIndexGroupSector('코스피 200 비중상한 20%')).toBe(true)
    expect(isIndexGroupSector('코스닥150')).toBe(true)
    expect(isIndexGroupSector('전자장비와기기')).toBe(false)
    expect(isIndexGroupSector('도로와철도운송')).toBe(false)
  })

  it('업종만 남겨 앞에서 n개', () => {
    const list = [{ name: '전자장비와기기' }, { name: '코스피 200 TOP 10' }, { name: '화학' }, { name: '운송·창고' }]
    expect(pickIndustrySectors(list, 2).map((s) => s.name)).toEqual(['전자장비와기기', '화학'])
  })

  it('표본 0개면 등락률은 자료 없음', () => {
    expect(sectorChange({ change_rate: 0, metrics: { change_sample: 0 } })).toBeNull()
    expect(sectorChange({ change_rate: 0, metrics: { change_sample: 3 } })).toBe(0)
    expect(sectorChange({ change_rate: 1.59 })).toBe(1.59)
    expect(sectorChange({ changeRate: -0.6 })).toBe(-0.6)
    expect(sectorChange(undefined)).toBeNull()
  })
})
