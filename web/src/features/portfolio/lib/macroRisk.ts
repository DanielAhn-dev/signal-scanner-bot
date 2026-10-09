export type MacroRisk = {
  label: string
  addScorePenalty: number
  partialTakeProfitBonus: number
  us10y: number | null
  wtiOil: number | null
  cpiYoy: number | null
  diagnosis: string
}

/** 거시지표 스냅샷으로 추가매수 기준 가산점·부분익절 완화폭을 정한다 */
export function computeMacroRisk(macroSnapshot: any): MacroRisk {
  const us10y = Number(macroSnapshot?.indices?.us10y?.price)
  const wtiOil = Number(macroSnapshot?.indices?.wtiOil?.price)
  const cpiYoy = Number(macroSnapshot?.cpi?.yoy)
  const riskScore = Number(macroSnapshot?.diagnosis?.riskScore)
  const score = Number.isFinite(riskScore) ? riskScore : 50

  let addScorePenalty = 0
  let partialTakeProfitBonus = 0
  let label = '중립'

  if (score >= 75 || us10y >= 5 || wtiOil >= 95 || cpiYoy >= 3.5) {
    addScorePenalty = 8
    partialTakeProfitBonus = 2
    label = '방어'
  } else if (score >= 60 || us10y >= 4.6 || wtiOil >= 85 || cpiYoy >= 3.0) {
    addScorePenalty = 4
    partialTakeProfitBonus = 1
    label = '주의'
  }

  return {
    label,
    addScorePenalty,
    partialTakeProfitBonus,
    us10y: Number.isFinite(us10y) ? us10y : null,
    wtiOil: Number.isFinite(wtiOil) ? wtiOil : null,
    cpiYoy: Number.isFinite(cpiYoy) ? cpiYoy : null,
    diagnosis: String(macroSnapshot?.regimeLabel || '시장 진단 없음'),
  }
}
