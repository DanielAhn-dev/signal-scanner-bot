import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AdherenceCard, { type Adherence, type AdherenceRow } from './AdherenceCard'

const row = (over: Partial<AdherenceRow>): AdherenceRow => ({
  key: '2026-08-01|278530', from: '2026-07-01', to: '2026-08-01', code: '278530', name: 'KODEX 200TR', shares: 50, amount: 1_000_000,
  status: 'deviated', advised: { code: '294400', name: 'KIWOOM 200TR' }, actualNow: 1_100_000, advisedNow: 1_105_000, diff: -5_000,
  mature: true, excluded: false, reason: '새 돈은 KIWOOM 200TR 한 곳으로 안내한 달', ...over,
})

describe('AdherenceCard', () => {
  it('내 선택 우세·안내 우세를 함께, 3개월 안 된 건 아직', async () => {
    const data: Adherence = {
      rows: [row({}), row({ key: '2026-08-01|498400', code: '498400', name: '커버드콜', diff: 50_000, actualNow: 1_050_000, advisedNow: 1_000_000 }), row({ key: '2026-10-01|x', to: '2026-10-01', name: '최근', mature: false, diff: null, actualNow: null, advisedNow: null })],
      followed: 2, deviated: 3, early: 1, matureDiff: 45_000, matureCount: 2, since: '2026-07-01',
    }
    const onExclude = vi.fn(async () => {})
    render(<MemoryRouter><AdherenceCard data={data} onExclude={onExclude} /></MemoryRouter>)
    expect(screen.getByText('안내 우세')).toBeTruthy()
    expect(screen.getByText('내 선택 우세')).toBeTruthy()
    expect(screen.getByText('아직 (3개월 뒤 비교)')).toBeTruthy()
    expect(screen.getByText(/2건이라 아직 어느 쪽이 낫다고 하기 이릅니다/)).toBeTruthy()
    fireEvent.click(screen.getAllByText('판정에서 빼기')[0])
    await waitFor(() => expect(onExclude).toHaveBeenCalledWith('2026-08-01|278530', true))
  })
  it('안내 기록이 아직 없으면 시작 안내', () => {
    render(<MemoryRouter><AdherenceCard data={{ rows: [], followed: 0, deviated: 0, early: 0, matureDiff: 0, matureCount: 0, since: null }} onExclude={async () => {}} /></MemoryRouter>)
    expect(screen.getByText(/이번 달부터/)).toBeTruthy()
  })
})
