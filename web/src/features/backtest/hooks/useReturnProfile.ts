import { useState } from 'react'
import type { ReturnProfileKey } from '../types'

export function useReturnProfile() {
  const [returnProfile, setReturnProfile] = useState<ReturnProfileKey>('strict')
  // 기대수익 = 규칙 일치 과거 사례 평균(모든 후보 동일). 0이면 과거 평균이 플러스인 규칙만 통과.
  const [minExpectedReturnPct, setMinExpectedReturnPct] = useState(0)
  const [minShortMomentumPct, setMinShortMomentumPct] = useState(-2)
  const [minLiquidityEok, setMinLiquidityEok] = useState(50)

  const applyReturnProfile = (profile: ReturnProfileKey) => {
    setReturnProfile(profile)
    if (profile === 'strict') {
      setMinExpectedReturnPct(1)
      setMinShortMomentumPct(-2)
      setMinLiquidityEok(50)
      return
    }
    if (profile === 'conservative') {
      setMinExpectedReturnPct(0)
      setMinShortMomentumPct(-5)
      setMinLiquidityEok(30)
      return
    }
    // 공격형: 필터 거의 없음 (기술지표 신호 품질만 봄)
    setMinExpectedReturnPct(-100)
    setMinShortMomentumPct(-10)
    setMinLiquidityEok(10)
  }

  return {
    returnProfile, minExpectedReturnPct, setMinExpectedReturnPct, minShortMomentumPct, setMinShortMomentumPct,
    minLiquidityEok, setMinLiquidityEok, applyReturnProfile,
  }
}
