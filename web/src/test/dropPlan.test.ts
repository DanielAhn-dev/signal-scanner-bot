import { describe, expect, it } from 'vitest'
import { DROP_COMMITMENTS, dropPlanLines, sanitizeDropPlan, todayKst } from '../lib/dropPlan'

describe('dropPlan', () => {
  const ok = { savedAt: '2026-10-02', tolerancePct: 20, commitments: ['keep-dca', 'wait-a-day'], ifTempted: '  배우자와 이야기한다  ' }

  it('올바른 계획은 다듬어 돌려준다', () => {
    const p = sanitizeDropPlan(ok)!
    expect(p.ifTempted).toBe('배우자와 이야기한다')
    expect(p.commitments).toEqual(['keep-dca', 'wait-a-day'])
  })

  it('알 수 없는 항목과 중복은 버린다', () => {
    const p = sanitizeDropPlan({ ...ok, commitments: ['keep-dca', 'keep-dca', 'hack'] })!
    expect(p.commitments).toEqual(['keep-dca'])
  })

  it('날짜·선·내용이 잘못되면 null', () => {
    expect(sanitizeDropPlan(null)).toBeNull()
    expect(sanitizeDropPlan({ ...ok, savedAt: '어제' })).toBeNull()
    expect(sanitizeDropPlan({ ...ok, tolerancePct: 0 })).toBeNull()
    expect(sanitizeDropPlan({ ...ok, commitments: [], ifTempted: '' })).toBeNull()
  })

  it('직접 적은 문장은 200자로 자른다', () => {
    const p = sanitizeDropPlan({ ...ok, ifTempted: 'a'.repeat(500) })!
    expect(p.ifTempted).toHaveLength(200)
  })

  it('하락 때 보여줄 문장은 고른 항목과 직접 적은 문장이다', () => {
    const lines = dropPlanLines(sanitizeDropPlan(ok)!)
    expect(lines).toContain(DROP_COMMITMENTS[0].text)
    expect(lines.at(-1)).toBe('팔고 싶어지면 먼저: 배우자와 이야기한다')
    expect(lines).toHaveLength(3)
  })

  it('한국 날짜로 오늘을 만든다', () => {
    expect(todayKst(new Date('2026-10-01T16:00:00Z'))).toBe('2026-10-02')
  })
})
