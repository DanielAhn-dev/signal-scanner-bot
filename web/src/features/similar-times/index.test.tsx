import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SimilarTimesPage from './index'
import { SIMILAR } from '../../lib/similarTimes'

const apiFetchMock = vi.fn()
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))

beforeEach(() => apiFetchMock.mockReset())

describe('지금과 비슷했던 때 화면', () => {
  it('지금 상태·사례 수·한계·생성일을 보여 주고 매매 지시 표현은 없다', async () => {
    apiFetchMock.mockResolvedValue({ ok: true, data: { asOf: '2026-10-27', score: 25.5, dd60: -19.9, vol20: 45.8 } })
    render(<SimilarTimesPage />)
    await waitFor(() => expect(screen.getByText(/서로 겹치지 않는 사례/)).toBeTruthy())
    expect(screen.getByText('지금과 비슷했던 때')).toBeTruthy()
    expect(screen.getByText('26점')).toBeTruthy()
    expect(screen.getByText(/비슷했던 주/)).toBeTruthy()
    expect(screen.getByText('한계와 읽는 법')).toBeTruthy()
    expect(screen.getByText(new RegExp(`생성일 ${SIMILAR.generated}`))).toBeTruthy()
    expect(screen.getByLabelText(/가격 경로/)).toBeTruthy()
    const legend = screen.getByLabelText('사례별 선 색')
    expect(legend.querySelectorAll('li').length).toBeGreaterThanOrEqual(6)   // 중앙값 + 사례 선 범례
    expect(legend.textContent).toMatch(/\d{4}\.\d{1,2}/)
    expect(legend.textContent).toContain('중앙값')
    const text = document.body.textContent || ''
    expect(text).not.toMatch(/과열|팔라|파세요|사세요|매수하세요|매도하세요/)
    expect(text).toContain('맞히는 것이 아니라')
  })

  it('지금 값을 못 받으면 오류 안내와 다시 시도를 보여 준다', async () => {
    apiFetchMock.mockResolvedValue({ ok: true, data: null })
    render(<SimilarTimesPage />)
    await waitFor(() => expect(screen.getByText(/계산하지 못했어요/)).toBeTruthy())
    expect(screen.getByText('재시도')).toBeTruthy()
  })
})
