import { PHASE_CONFIDENCE_THRESHOLD } from '../constants'
import { ROTATION_CYCLE, getSectorMeta, type EconomicPhase } from '../sectorMeta'
import type { MacroPhase, PhaseDetectionResult, Sector, SectorMarketOverviewSnapshot } from '../types'

export function clampNum(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

export function confidenceLabel(v: number): "높음" | "보통" | "낮음" {
  if (v >= PHASE_CONFIDENCE_THRESHOLD.high) return "높음"
  if (v >= PHASE_CONFIDENCE_THRESHOLD.medium) return "보통"
  return "낮음"
}

export function mapMacroPhaseToRotation(phase?: MacroPhase): EconomicPhase | null {
  if (!phase || phase === "unknown") return null
  if (phase === "normal") return "expansion"
  if (phase === "high_inflation") return "slowdown"
  return "recession"
}

// 현재 경기 국면 자동 추정 — WICS 대분류별 평균 점수로 가장 강한 로테이션 단계 판정
export function detectCurrentPhase(all: Sector[], marketOverview?: SectorMarketOverviewSnapshot | null): PhaseDetectionResult {
  if (all.length === 0) {
    return {
      phase: null,
      confidence: 0,
      confidenceLabel: "낮음",
      basisLabel: "데이터 부족",
      reason: "섹터 점수 데이터가 없어 국면을 판단할 수 없습니다.",
    }
  }
  const catScores: Record<string, number[]> = {}
  let usableScoreCount = 0
  for (const s of all) {
    const meta = getSectorMeta(s.name)
    if (!meta || s.score == null) continue
    usableScoreCount += 1
    if (!catScores[meta.wicsCategory]) catScores[meta.wicsCategory] = []
    catScores[meta.wicsCategory].push(s.score)
  }
  const avg = (cats: string[]): number => {
    const scores = cats.flatMap((c) => catScores[c] ?? [])
    if (scores.length === 0) return 0
    return scores.reduce((a, b) => a + b, 0) / scores.length
  }
  const ranked = ROTATION_CYCLE.map((p) => ({ phase: p.phase, score: avg(p.sectorCategories) }))
    .sort((a, b) => b.score - a.score)
  if (ranked.length === 0 || ranked[0].score <= 0) {
    return {
      phase: null,
      confidence: 0,
      confidenceLabel: "낮음",
      basisLabel: "데이터 부족",
      reason: "유효한 섹터 점수가 부족해 국면을 산출하지 못했습니다.",
    }
  }

  const top = ranked[0]
  const second = ranked[1] ?? { phase: top.phase, score: 0 }
  const gap = Math.max(0, top.score - second.score)
  const gapRatio = top.score > 0 ? gap / top.score : 0
  const coverage = clampNum(usableScoreCount / 12, 0, 1)

  const sectorConfidence = clampNum(Math.round(30 + gapRatio * 42 + coverage * 18), 15, 90)
  const macroPhase = mapMacroPhaseToRotation(marketOverview?.economicPhase?.phase)
  const macroLabel = marketOverview?.economicPhase?.label
  const macroSignalConfidence = Number(marketOverview?.tradingSignal?.confidence)

  let finalConfidence = sectorConfidence
  let basisLabel = "섹터 점수 기반"
  let reason = `1위-2위 격차 ${gap.toFixed(1)}점 · 유효 섹터 ${usableScoreCount}개`

  if (macroPhase) {
    const macroWeight = Number.isFinite(macroSignalConfidence)
      ? clampNum(Math.round(macroSignalConfidence * 0.2), 8, 20)
      : 12
    const agree = macroPhase === top.phase
    finalConfidence = clampNum(finalConfidence + (agree ? macroWeight : -macroWeight), 15, 95)
    basisLabel = "섹터+거시 혼합"
    reason = `${reason} · 거시 국면 ${macroLabel ?? "참고"} ${agree ? "정합" : "불일치"}`
  }

  const weakDistinction = gapRatio < PHASE_CONFIDENCE_THRESHOLD.weakGapRatio && !macroPhase
  if (weakDistinction) {
    return {
      phase: null,
      confidence: clampNum(Math.min(finalConfidence, 45), 15, 45),
      confidenceLabel: "낮음",
      basisLabel,
      reason: `${reason} · 상위 국면 간 점수 차가 작아 판단 보류`,
    }
  }

  return {
    phase: top.phase,
    confidence: finalConfidence,
    confidenceLabel: confidenceLabel(finalConfidence),
    basisLabel,
    reason,
  }
}
