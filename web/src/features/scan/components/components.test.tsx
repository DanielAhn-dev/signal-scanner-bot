import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AccumulationBadge, GradeBadge, SignalBadge, WarnBadge } from './badges'
import { ConfirmTrendSparkline, StrategySparkline } from './Sparklines'

describe('스캔 배지', () => {
  it('GradeBadge: 등급 색 클래스와 라벨, 값이 없으면 대시', () => {
    const { container, rerender } = render(<GradeBadge grade="a" label="진입" />)
    expect(container.querySelector('.scan-grade-badge.scan-grade-a')?.textContent).toBe('A')
    expect(container.querySelector('.scan-grade-label')?.textContent).toBe('진입')
    rerender(<GradeBadge grade="C" />)
    expect(container.querySelector('.scan-grade-c')).toBeTruthy()
    rerender(<GradeBadge grade={null} />)
    expect(container.textContent).toBe('—')
  })
  it('WarnBadge: SAFE 안전 · WATCH 관찰 · WARN 주의, 그 외는 원문', () => {
    const { container, rerender } = render(<WarnBadge grade="safe" />)
    expect(container.textContent).toBe('안전')
    expect(container.querySelector('.scan-warn-safe')).toBeTruthy()
    rerender(<WarnBadge grade="WATCH" />)
    expect(container.textContent).toBe('관찰')
    rerender(<WarnBadge grade="WARN" />)
    expect(container.textContent).toBe('주의')
    rerender(<WarnBadge grade="SELL" />)
    expect(container.textContent).toBe('SELL')
    expect(container.querySelector('.scan-warn-default')).toBeTruthy()
  })
  it('SignalBadge: 중립·없음은 그리지 않는다', () => {
    const { container, rerender } = render(<SignalBadge signal="STRONG_BUY" />)
    expect(container.textContent).toBe('매수+')
    rerender(<SignalBadge signal="neutral" />)
    expect(container.textContent).toBe('')
    rerender(<SignalBadge signal={null} />)
    expect(container.textContent).toBe('')
  })
  it('AccumulationBadge: breakout은 눌림 강함, lead는 눌림형, 없으면 그리지 않는다', () => {
    const { container, rerender } = render(<AccumulationBadge stage="breakout" />)
    expect(container.textContent).toBe('눌림 강함')
    rerender(<AccumulationBadge stage="lead" />)
    expect(container.textContent).toBe('눌림형')
    rerender(<AccumulationBadge stage={null} />)
    expect(container.textContent).toBe('')
  })
})

describe('스파크라인', () => {
  it('StrategySparkline: 값 2개 미만이면 신호 부족', () => {
    const { container } = render(<StrategySparkline values={[1]} />)
    expect(container.textContent).toBe('신호 부족')
  })
  it('StrategySparkline: 마지막 값이 0 이상이면 상승 클래스, 막대는 값 개수만큼', () => {
    const { container, rerender } = render(<StrategySparkline values={[-2, 1, 3]} />)
    expect(container.querySelector('.scan-strategy-sparkline--up')).toBeTruthy()
    expect(container.querySelectorAll('rect')).toHaveLength(3)
    rerender(<StrategySparkline values={[3, 1, -2]} />)
    expect(container.querySelector('.scan-strategy-sparkline--down')).toBeTruthy()
  })
  it('StrategySparkline: 숫자가 아닌 값은 걸러낸다', () => {
    const { container } = render(<StrategySparkline values={[1, NaN, 2, Infinity] as number[]} />)
    expect(container.querySelectorAll('rect')).toHaveLength(2)
  })
  it('ConfirmTrendSparkline: 값 2개 미만이면 안내 문구, 충분하면 선과 상승/하락 색', () => {
    const { container, rerender } = render(<ConfirmTrendSparkline values={[]} />)
    expect(container.textContent).toBe('추세 데이터 부족')
    rerender(<ConfirmTrendSparkline values={[10, 20, 30]} />)
    expect(container.querySelector('polyline')?.getAttribute('stroke')).toBe('var(--color-stock-up)')
    rerender(<ConfirmTrendSparkline values={[30, 20, 10]} />)
    expect(container.querySelector('polyline')?.getAttribute('stroke')).toBe('var(--color-stock-down)')
  })
})
