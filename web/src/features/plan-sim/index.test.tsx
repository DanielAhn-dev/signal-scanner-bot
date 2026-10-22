import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import PlanSimPage from './index'

const apiFetchMock = vi.fn()
let chatId = ''
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))
vi.mock('../../stores/profileStore', () => ({ useCurrentChatId: () => chatId }))
beforeEach(() => {
  apiFetchMock.mockReset()
  chatId = ''
})

describe('시뮬레이터 화면', () => {
  it('처음엔 국내·해외 반반(A)과 코스피200만(B)을 최근 10년 매달 50만원으로 비교한다', () => {
    render(<PlanSimPage />)
    expect(screen.getByText('국내·해외 반반', { selector: '.ps-slot--A strong' })).toBeTruthy()
    expect(screen.getByText('코스피200만', { selector: '.ps-slot--B strong' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '최근 10년' }).getAttribute('aria-pressed')).toBe('true')
    // 120개월 × 50만원 = 6,000만원 — A·B 두 열
    const row = screen.getByText('넣은 돈', { selector: 'th' }).closest('tr')!
    expect(row.textContent).toContain('6,000만원')
    expect(row.querySelectorAll('td')).toHaveLength(2)
    expect(screen.getByText(/다른 달에 시작했다면/)).toBeTruthy()
    expect(apiFetchMock).not.toHaveBeenCalled()
  })

  it('로그인했으면 내 계획 구성·매달 금액으로 A를 채운다', async () => {
    chatId = 'u1'
    apiFetchMock.mockResolvedValue({ data: { plan: { mix: [{ index: 'kospi200', weight: 0.5 }, { index: 'nasdaq100', weight: 0.5 }], monthly: 300_000 } } })
    render(<PlanSimPage />)
    await waitFor(() => expect(screen.getByText('내 계획 구성')).toBeTruthy())
    expect((screen.getByLabelText('매달 (만원)') as HTMLInputElement).value).toBe('30')
    expect(screen.getByText(/코스피200 50 · 미국 나스닥100 50/)).toBeTruthy()
  })

  it('이력보다 이른 시작은 첫 달부터 계산하고 기간을 정한 자산을 알린다', () => {
    render(<PlanSimPage />)
    fireEvent.click(screen.getByRole('button', { name: '2000 닷컴 고점' }))
    expect(screen.getByText(/코스피200 이력이 2002-10부터라 기간을 정합니다/)).toBeTruthy()
  })

  it('비교는 3개까지, B·C는 뺄 수 있다', () => {
    render(<PlanSimPage />)
    fireEvent.click(screen.getByRole('button', { name: '+ 비교 추가' }))
    expect(screen.queryByRole('button', { name: '+ 비교 추가' })).toBeNull()
    expect(screen.getByText('넣은 돈', { selector: 'th' }).closest('tr')!.querySelectorAll('td')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'C 구성 빼기' }))
    expect(screen.getByRole('button', { name: '+ 비교 추가' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'A 구성 빼기' })).toBeNull()
  })

  it('구성을 바꾸면 예시와 자산별 비중이 열리고, 직접 바꾸면 이름이 바뀐다', () => {
    render(<PlanSimPage />)
    fireEvent.click(screen.getAllByRole('button', { name: '바꾸기' })[1])
    // 코스피200만 비중을 바꿔도 여전히 코스피200만이다 — 다른 자산을 넣어야 직접 정한 구성
    fireEvent.change(screen.getByRole('slider', { name: /^코스피200 / }), { target: { value: '55' } })
    expect(screen.getByText('코스피200만', { selector: '.ps-slot--B strong' })).toBeTruthy()
    fireEvent.change(screen.getByRole('slider', { name: /^미국 S&P500 / }), { target: { value: '45' } })
    expect(screen.getByText('직접 정한 구성', { selector: '.ps-slot--B strong' })).toBeTruthy()
    expect(screen.getByText(/코스피200 55 · 미국 S&P500 45/)).toBeTruthy()
  })

  it('넣는 돈이 모두 0이면 안내한다', () => {
    render(<PlanSimPage />)
    fireEvent.change(screen.getByLabelText('매달 (만원)'), { target: { value: '0' } })
    expect(screen.getByText(/하나는 정해 주세요/)).toBeTruthy()
  })

  it('자료 기준월·생성일·스크립트를 표시한다', () => {
    render(<PlanSimPage />)
    expect(screen.getByText(/build_sim_data\.py/)).toBeTruthy()
    expect(screen.getByText(/기간은 이력이 가장 짧은 자산이 정합니다/)).toBeTruthy()
  })
})
