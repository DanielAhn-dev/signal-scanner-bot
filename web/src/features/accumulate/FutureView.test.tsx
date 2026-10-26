import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import FutureView from './FutureView'
import type { MixEntry } from '../../lib/planMix'

const half: MixEntry[] = [
  { index: 'kospi200', weight: 0.5, product: null, account: null },
  { index: 'sp500', weight: 0.5, product: null, account: null },
]

describe('앞으로의 경우의 수 보기', () => {
  it('예측이 아니라고 밝히고, 범위·운 나쁨·원금 아래 비율을 보여 준다 (한 숫자 아님)', () => {
    const { container } = render(<FutureView monthly={1_000_000} lump={0} years={10} mix={half} />)
    expect(screen.getByText('예측이 아닙니다.')).toBeInTheDocument()
    expect(screen.getByText(/코스피200 50% · S&P500 50%/)).toBeInTheDocument()
    const tiles = container.querySelector('.acc-tiles')!
    expect(within(tiles as HTMLElement).getByText('보통(중앙값)')).toBeInTheDocument()
    expect(within(tiles as HTMLElement).getByText('운 나쁨(하위 10%)')).toBeInTheDocument()
    expect(within(tiles as HTMLElement).getByText('넣은 돈보다 적은 경우')).toBeInTheDocument()
    // 넣은 돈 대비 % 축
    const labels = [...container.querySelectorAll('.acc-axis')].map((t) => t.textContent ?? '')
    expect(labels).toContain('원금')
  })

  it('세 구성을 같은 경우들로 나란히 — 순위가 아니라고 적는다', () => {
    render(<FutureView monthly={1_000_000} lump={0} years={10} mix={half} />)
    expect(screen.getByText(/순위가 아닙니다/)).toBeInTheDocument()
    const rows = screen.getAllByRole('row').map((r) => r.textContent ?? '')
    expect(rows.some((t) => t.startsWith('국내만'))).toBe(true)
    expect(rows.some((t) => t.startsWith('국내·해외 반반'))).toBe(true)
    expect(rows.some((t) => t.startsWith('셋 같은 비중'))).toBe(true)
  })

  it('살아남은 시장 반례 세 가지와 자료 출처를 보여 준다', () => {
    render(<FutureView monthly={1_000_000} lump={0} years={10} mix={half} />)
    expect(screen.getByText('일본 닛케이')).toBeInTheDocument()
    expect(screen.getByText('코스피')).toBeInTheDocument()
    expect(screen.getByText('미국 S&P500')).toBeInTheDocument()
    expect(screen.getByText(/생성일 \d{4}-\d{2}-\d{2}/)).toBeInTheDocument()
  })

  it('해외지수의 연 0.9%p 가정 차감과 실제 비용 미계산을 구분해 밝힌다', () => {
    render(<FutureView monthly={1_000_000} lump={0} years={10} mix={half} />)
    fireEvent.click(screen.getByText('자세히 보기'))
    expect(screen.getByText(/해외지수 수익률에는 한국 상장 상품과의 격차를 연 0\.9%p로 일괄 가정해 이미 차감했습니다/)).toBeInTheDocument()
    expect(screen.getByText(/실제 ETF별 보수나 계좌별 세금·환전·매매 비용을 계산한 값은 아닙니다/)).toBeInTheDocument()
  })

  it('사건을 끼우면 그 사건 설명과 내 구성 지수별 깊이를 보여 주고, 원금 아래 비율이 바뀐다', () => {
    render(<FutureView monthly={1_000_000} lump={0} years={10} mix={half} />)
    const below = () => screen.getByText('넣은 돈보다 적은 경우').nextElementSibling?.textContent
    const before = below()
    expect(screen.getByLabelText('언제')).toBeDisabled()
    fireEvent.change(screen.getByLabelText('끼워 넣을 사건'), { target: { value: 'japan' } })
    expect(screen.getByText(/세 시장이 한꺼번에 이렇게 된 적은 없는 가정/)).toBeInTheDocument()
    expect(screen.getByText(/가장 깊을 때 코스피200 -\d+% · S&P500 -\d+%/)).toBeInTheDocument()
    expect(below()).not.toBe(before)
    expect(screen.getByLabelText('언제')).not.toBeDisabled()
  })

  it('처음 겹쳐 그린 경우는 보통에 가까운 경우이고, 다른 경우 보기로 바꾼다', () => {
    const { container } = render(<FutureView monthly={1_000_000} lump={0} years={10} mix={half} />)
    const caseText = () => container.querySelector('.acc-summary')?.textContent ?? ''
    const first = caseText().match(/^경우 (\d+):/)?.[1]
    expect(first).toBeDefined()
    // 운 좋은 극단(넣은 돈의 300%대)을 예시로 보이지 않는다 — 끝 결과가 보통(+n%)과 같은 수준
    const typical = Number(screen.getByText('보통(중앙값)').parentElement!.querySelector('small')!.textContent!.replace(/[+%]/g, ''))
    const caseEnd = Number(caseText().match(/넣은 돈의 (\d+)%/)?.[1])
    expect(Math.abs(caseEnd - (100 + typical))).toBeLessThanOrEqual(2)
    fireEvent.click(screen.getByRole('button', { name: '다른 경우 보기' }))
    expect(caseText().match(/^경우 (\d+):/)?.[1]).toBe(String(((Number(first) - 1 + 137) % 2000) + 1))
  })

  it('기간이 짧으면 기간 밖 시점은 고를 수 없다', () => {
    render(<FutureView monthly={1_000_000} lump={0} years={2} mix={half} />)
    fireEvent.change(screen.getByLabelText('끼워 넣을 사건'), { target: { value: 'gfc' } })
    const opts = [...(screen.getByLabelText('언제') as HTMLSelectElement).options].map((o) => o.textContent)
    expect(opts).toEqual(['지금 바로', '1년 뒤'])
    expect(screen.getByText(/뒤 \d+개월은 잘렸습니다/)).toBeInTheDocument()
  })
})
