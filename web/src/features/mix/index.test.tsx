import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MixPage from './index'
import { MIX_PRESETS, simulateMix } from '../../lib/mix'

describe('섞어보기 화면', () => {
  it('예시 조합의 결과와 기준선, 주의 문구를 보여준다', () => {
    render(<MixPage />)
    expect(screen.getByText('연평균 수익률')).toBeTruthy()
    expect(screen.getByText('최대 낙폭')).toBeTruthy()
    expect(screen.getByText(/코스피200 100% \(같은 기간\)/)).toBeTruthy()
    expect(screen.getByText(/미국이 유독 강했던 구간/)).toBeTruthy()
  })

  it('비중을 모두 0으로 만들면 안내를 보여준다', () => {
    render(<MixPage />)
    for (const s of screen.getAllByRole('slider')) fireEvent.change(s, { target: { value: '0' } })
    expect(screen.getByText(/비중을 하나 이상 정해주세요/)).toBeTruthy()
  })
})

describe('하락 가정', () => {
  it('하락 가정 결과와 버틸 수 있는 선 판정을 보여준다', () => {
    render(<MixPage />)
    expect(screen.getByText('하락이 왔다고 가정해보기')).toBeTruthy()
    expect(screen.getByText('이 하락에서 내 조합')).toBeTruthy()
    fireEvent.click(screen.getByText('최악 가정'))
    expect(screen.getByText(/버틸 수 있는 선\(20%\)을 넘습니다/)).toBeTruthy()
  })
})

describe('하락 중에 팔았다면', () => {
  it('조건에 따른 결과와 주의 문구를 보여준다', () => {
    render(<MixPage />)
    expect(screen.getByText('하락 중에 팔았다면')).toBeTruthy()
    expect(screen.getByText(/보유보다 나았던 경우/)).toBeTruthy()
    expect(screen.getByText(/몇 번의 큰 하락에 걸려 있습니다/)).toBeTruthy()
    fireEvent.click(screen.getByText('매월 적립'))
    expect(screen.getByText(/넣은 돈 대비/)).toBeTruthy()
  })
})

describe('실제 데이터 점검', () => {
  it('한국 상장 4종 조합은 파이썬 검증(연 12.3%, 낙폭 -19%)과 비슷하다', () => {
    const r = simulateMix(MIX_PRESETS.find((p) => p.key === 'mix4')!.weights, 'month')!
    expect(r.from).toBe('201111')
    expect(r.cagr).toBeGreaterThan(0.11)
    expect(r.cagr).toBeLessThan(0.135)
    expect(r.mdd).toBeGreaterThan(-0.23)
    expect(r.mdd).toBeLessThan(-0.15)
  })
})
