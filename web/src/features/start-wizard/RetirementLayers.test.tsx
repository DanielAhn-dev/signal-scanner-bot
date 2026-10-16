import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import RetirementLayers from './RetirementLayers'

const renderLayers = (initial?: Parameters<typeof RetirementLayers>[0]['initial']) => render(<MemoryRouter><RetirementLayers initial={initial} /></MemoryRouter>)

describe('노후 준비 3층 점검', () => {
  it('고르기 전에는 안내가 없고, 개인연금이 없으면 돌려받는 돈과 해지 세금을 숫자로 보여 주며 절세 탭으로 잇는다', () => {
    renderLayers()
    expect(screen.queryByText(/연말정산에서 돌려받습니다/)).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: '없음·모름' })[2])
    expect(screen.getByText(/최대 118.8만원~148.5만원/)).toBeTruthy()
    expect(screen.getByText(/55세 전에 해지하면 16.5%/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /내가 돌려받을 돈 계산해 보기/ }).getAttribute('href')).toBe('/plan?tab=tax')
  })

  it('예산에 연금 저축이 있으면 개인연금을 미리 있음으로 두고, 국민연금 있음은 은퇴 인출 탭으로 잇는다', () => {
    renderLayers({ personal: 'yes' })
    expect(screen.getByRole('group', { name: '3층 개인연금(연금저축·IRP)' }).querySelector('[aria-pressed="true"]')?.textContent).toBe('있음')
    expect(screen.getByRole('link', { name: /절세 계좌 확인하기/ })).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: '있음' })[0])
    expect(screen.getByRole('link', { name: /수령액 넣어 보기/ }).getAttribute('href')).toBe('/plan?tab=retire')
    expect(screen.getByText(/ISA/)).toBeTruthy()
  })
})
