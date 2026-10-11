import { useState } from 'react'
import { loadTradeCostSettings } from '../../../lib/tradeCost'
import { useSyncedSettings } from '../../../lib/userState'

export function useTradeCost() {
  // 매매비용 표시 설정은 계정에 저장한다 (기기를 바꿔도 유지)
  const storedCost = loadTradeCostSettings()
  const [includeCost, setIncludeCost] = useState(storedCost.includeCost)
  const [buyFeeRatePct, setBuyFeeRatePct] = useState(storedCost.buyFeeRatePct)  // 매수수수료 %
  const [sellFeeRatePct, setSellFeeRatePct] = useState(storedCost.sellFeeRatePct) // 매도수수료+거래세 %
  useSyncedSettings('tradeCost', { includeCost, buyFeeRatePct, sellFeeRatePct }, { includeCost: true, buyFeeRatePct: 0.015, sellFeeRatePct: 0.215 }, (saved) => {
    if (typeof saved.includeCost === 'boolean') setIncludeCost(saved.includeCost)
    if (Number.isFinite(Number(saved.buyFeeRatePct))) setBuyFeeRatePct(Number(saved.buyFeeRatePct))
    if (Number.isFinite(Number(saved.sellFeeRatePct))) setSellFeeRatePct(Number(saved.sellFeeRatePct))
  })

  return {
    includeCost,
    setIncludeCost,
    buyFeeRatePct,
    setBuyFeeRatePct,
    sellFeeRatePct,
    setSellFeeRatePct,
  }
}
