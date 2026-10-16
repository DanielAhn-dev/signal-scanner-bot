import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MaturityInbox from './MaturityInbox'
import { maturitiesDue, sanitizeMaturityState, suggestedInvest, type Maturity } from '../../lib/maturity'
import { readUserState, writeUserState } from '../../lib/userState'

const apiFetchMock = vi.fn()
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))
vi.mock('../../stores/profileStore', () => ({ useCurrentClientId: () => 'test-user', getCurrentClientIdFromStore: () => 'test-user' }))

const krw = (n: number) => `${n.toLocaleString('ko-KR')}원`
const item = (over: Partial<Maturity>): Maturity => ({ id: 'a', name: 'OO적금', amount: 12_400_000, date: '2026-10-03', horizon: 'over5', ...over })

beforeEach(() => {
  apiFetchMock.mockReset()
  apiFetchMock.mockResolvedValue({ data: {} })
  localStorage.clear()
})

describe('만기 → 이번 달 투자금', () => {
  it('넣을 금액 기본값은 안내를 따른다: 5년 넘게 전부, 3~5년 절반, 3년 안 0', () => {
    expect(suggestedInvest(item({ horizon: 'over5' }))).toBe(12_400_000)
    expect(suggestedInvest(item({ horizon: '3to5' }))).toBe(6_200_000)
    expect(suggestedInvest(item({ horizon: 'under3' }))).toBe(0)
  })

  it('그 달까지 만기가 온 것 중 처리 안 한 것만, 넣은 기록은 저장소에서 읽어도 유지된다', () => {
    const items = [item({ id: 'a' }), item({ id: 'b', date: '2026-11-02' }), item({ id: 'c', done: true })]
    expect(maturitiesDue(items, '2026-10').map((i) => i.id)).toEqual(['a'])
    const kept = sanitizeMaturityState({ items: [{ ...item({}), investedMonth: '2026-10', investedAmount: 5_000_000 }] }).items[0]
    expect([kept.done, kept.investedMonth, kept.investedAmount]).toEqual([true, '2026-10', 5_000_000])
    // 만기금보다 많이 넣었다는 기록은 믿지 않는다
    expect(sanitizeMaturityState({ items: [{ ...item({}), investedMonth: '2026-10', investedAmount: 99_000_000 }] }).items[0].investedMonth).toBeUndefined()
  })

  it('빼 둘 금액을 적으면 나머지만 투자금에 넣고, 저장이 성공한 뒤에 처리됨으로 바꾼다. 되돌리면 그만큼 뺀다', async () => {
    writeUserState('maturities', { items: [item({})] })
    const onApply = vi.fn().mockResolvedValue(true)
    render(<MaturityInbox month="2026-10" onApply={onApply} krw={krw} />)
    expect(screen.getByText('만기 도착 1건 · 12,400,000원')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('OO적금 빼 둘 금액'), { target: { value: '2400000' } })
    expect((screen.getByLabelText('OO적금 투자금에 넣을 금액') as HTMLInputElement).value).toBe('10000000')
    fireEvent.click(screen.getByRole('button', { name: '10,000,000원 투자금에 넣기' }))
    await waitFor(() => expect(screen.getByText('OO적금: 10,000,000원 넣음 · 2,400,000원 뺌')).toBeTruthy())
    expect(onApply).toHaveBeenCalledWith(10_000_000)
    expect(sanitizeMaturityState(readUserState('maturities')).items[0]).toMatchObject({ done: true, investedMonth: '2026-10', investedAmount: 10_000_000 })

    fireEvent.click(screen.getByRole('button', { name: '되돌리기' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '10,000,000원 투자금에 넣기' })).toBeTruthy())
    expect(onApply).toHaveBeenLastCalledWith(-10_000_000)
    expect(sanitizeMaturityState(readUserState('maturities')).items[0].done).toBeUndefined()
  })

  it('저장이 실패하면 처리됨으로 바꾸지 않는다', async () => {
    writeUserState('maturities', { items: [item({})] })
    const onApply = vi.fn().mockResolvedValue(false)
    render(<MaturityInbox month="2026-10" onApply={onApply} krw={krw} />)
    fireEvent.click(screen.getByRole('button', { name: '12,400,000원 투자금에 넣기' }))
    await waitFor(() => expect(onApply).toHaveBeenCalled())
    expect(sanitizeMaturityState(readUserState('maturities')).items[0].done).toBeUndefined()
  })
})
