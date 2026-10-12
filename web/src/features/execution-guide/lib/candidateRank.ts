import { formatKrw, formatNumber } from '../../../lib/format'
import type { AutoCandidate, CandidateMode, ScoreVersion } from '../types'
import {
  clampValue,
  computeFlowAccelerationScore,
  computeNetFlowScore,
  computeOverheatRisk,
  formatStageLabel,
  getThemeBoost,
  gradeToPct,
  normalizeScoreFrom5,
  scoreSignalFreshness,
} from './scoring'

export function getCandidateScoreByVersion(candidate: AutoCandidate, version: ScoreVersion): number {
  return version === 'legacy' ? candidate.scoreLegacy : candidate.score
}

export function rankScanCandidate(item: any, mode: CandidateMode): AutoCandidate {
  const entryPct = normalizeScoreFrom5(item?.entry_score)
  const trendPct = gradeToPct(item?.trend_grade)
  const quickPct = clampValue(Number(item?.quick_trade_score ?? 0), 0, 100)
  const adaptivePct = clampValue(Number(item?.adaptive_score ?? 0), 0, 100)
  const leadPct = clampValue(Number(item?.lead_accumulation_score ?? 0), 0, 100)
  const warnPct = normalizeScoreFrom5(item?.warn_score)
  const liquidity = Number(item?.liquidity ?? 0)
  const liquidityPct =
    liquidity >= 100_000_000_000 ? 100 :
    liquidity >= 30_000_000_000 ? 85 :
    liquidity >= 10_000_000_000 ? 70 :
    liquidity >= 3_000_000_000 ? 55 :
    liquidity >= 1_000_000_000 ? 40 : 20
  const intraday = Number(item?.intraday_change_pct ?? 0)
  // balanced/multibagger: 당일 +2.8% 부근 최고점
  // swing: 오늘 아직 안 튄 것이 최고점 (+1.5% 이상 급등은 강하게 감점)
  const intradayFit = mode === 'swing'
    ? clampValue(100 - Math.max(0, intraday - 1.5) * 18 - Math.max(0, -intraday - 3.0) * 5, 0, 100)
    : clampValue(100 - Math.abs(intraday - 2.8) * 12, 0, 100)
  const leadStage = formatStageLabel(item?.lead_accumulation_stage)
  // swing: 리드 축적(아직 안 터진 것)을 최우대, 리드 돌파는 이미 움직임
  const stageBoost = mode === 'swing'
    ? (leadStage === '리드 축적' ? 9 : (leadStage === '리드 돌파' ? 3 : 0))
    : (leadStage === '리드 돌파' ? 5 : (leadStage === '리드 축적' ? 2.5 : 0))
  const flow = computeNetFlowScore(item)
  const flowAcceleration = computeFlowAccelerationScore(flow.net5d, flow.net20d)
  const signalFresh = scoreSignalFreshness(item?.quick_signal_age_days, item?.quick_lite_signal_age_days)
  const overheatRisk = computeOverheatRisk(intraday)
  const earlyStageFit = clampValue(
    leadStage === '리드 축적'
      ? 100 - Math.max(0, intraday - 3.0) * 12
      : leadStage === '리드 돌파'
      ? 70 - Math.max(0, intraday - 5.0) * 10
      : 52,
    0,
    100,
  )

  const upsideSignal = clampValue(
    leadPct * 0.24 +
    trendPct * 0.17 +
    entryPct * 0.14 +
    adaptivePct * 0.1 +
    quickPct * 0.08 +
    flow.score * 0.1 +
    flowAcceleration.score * 0.08 +
    signalFresh.score * 0.05 +
    earlyStageFit * 0.04,
    0,
    100,
  )
  const riskSignal = clampValue(
    warnPct * 0.46 +
    (100 - liquidityPct) * 0.24 +
    overheatRisk * 0.2 +
    (100 - intradayFit) * 0.1,
    0,
    100,
  )
  const v2Base = clampValue(upsideSignal * 0.74 + (100 - riskSignal) * 0.26, 0, 100)

  const legacyBaseScore = mode === 'multibagger'
    ? (
      quickPct * 0.16 +
      adaptivePct * 0.17 +
      leadPct * 0.2 +
      entryPct * 0.06 +
      trendPct * 0.1 +
      (100 - warnPct) * 0.08 +
      liquidityPct * 0.05 +
      intradayFit * 0.02 +
      flow.score * 0.16
    )
    : mode === 'swing'
    ? (
      quickPct * 0.07 +
      adaptivePct * 0.12 +
      leadPct * 0.20 +
      entryPct * 0.20 +
      trendPct * 0.20 +
      (100 - warnPct) * 0.14 +
      liquidityPct * 0.05 +
      intradayFit * 0.02 +
      flow.score * 0.00
    )
    : (
      quickPct * 0.26 +
      adaptivePct * 0.2 +
      leadPct * 0.13 +
      entryPct * 0.11 +
      trendPct * 0.08 +
      (100 - warnPct) * 0.1 +
      liquidityPct * 0.08 +
      intradayFit * 0.04 +
      flow.score * 0.06
    )

  const baseScore = mode === 'multibagger'
    ? (
      v2Base * 0.7 +
      leadPct * 0.12 +
      flow.score * 0.08 +
      flowAcceleration.score * 0.1
    )
    : mode === 'swing'
    ? (
      // 스윙은 초기 추세와 신호 신선도, 과열 회피를 최우선으로 본다.
      v2Base * 0.68 +
      signalFresh.score * 0.14 +
      earlyStageFit * 0.12 +
      (100 - overheatRisk) * 0.06
    )
    : (
      v2Base * 0.78 +
      quickPct * 0.1 +
      flowAcceleration.score * 0.12
    )

  const theme = getThemeBoost(item?.name, item?.sector_id)
  // swing: 20D 장기수급 보너스 항상 반영 (더 강하게)
  const longFlowBonus = flow.net20d != null && (mode === 'multibagger' || mode === 'swing')
    ? clampValue((flow.net20d / 1_000_000_000) * (mode === 'swing' ? 0.9 : 0.5), -8, 14)
    : 0
  // swing: 당일 급등 패널티 (intraday > 4%는 점수 추가 차감)
  const swingPenalty = mode === 'swing' ? clampValue((intraday - 3.5) * 3.0, 0, 24) : 0
  const finalScore = clampValue(baseScore + stageBoost + longFlowBonus + theme.score - swingPenalty - overheatRisk * 0.06, 0, 100)
  const legacySwingPenalty = mode === 'swing' ? clampValue((intraday - 4.0) * 2.5, 0, 20) : 0
  const legacyScore = clampValue(legacyBaseScore + stageBoost + longFlowBonus + theme.score - legacySwingPenalty, 0, 100)
  const modeLabel = mode === 'multibagger' ? '모드 멀티배거' : mode === 'swing' ? '모드 스윙' : '모드 밸런스'
  const reasons = [
    `후보점수 ${formatNumber(upsideSignal, 1)}`,
    `리스크 ${formatNumber(riskSignal, 1)}`,
    `퀵점수 ${formatNumber(quickPct, 1)}`,
    `적응점수 ${formatNumber(adaptivePct, 1)}`,
    `거래대금 ${formatKrw(liquidity)}`,
    `당일변동 ${Number.isFinite(intraday) ? `${formatNumber(intraday, 2)}%` : '—'}`,
    `리드단계 ${leadStage}`,
    modeLabel,
  ]
  if (flow.label) reasons.push(flow.label)
  if (flowAcceleration.label) reasons.push(flowAcceleration.label)
  if (signalFresh.label) reasons.push(signalFresh.label)
  if (theme.labels.length > 0) reasons.push(`테마 ${theme.labels.join(', ')}`)

  return {
    code: String(item?.code || ''),
    name: String(item?.name || item?.code || ''),
    source: 'scan',
    sector: item?.sector_id ? String(item.sector_id) : null,
    score: finalScore,
    scoreLegacy: legacyScore,
    upsideSignal,
    riskSignal,
    confidencePct: null,
    liquidity: Number.isFinite(liquidity) ? liquidity : null,
    intradayChangePct: Number.isFinite(intraday) ? intraday : null,
    netFlow5d: flow.net5d,
    netFlow20d: flow.net20d,
    reason: reasons.join(' · '),
  }
}

export function rankHighlightCandidate(item: any, mode: CandidateMode): AutoCandidate {
  // confidence/expected_* 필드는 예측이 아니라 조건별 과거 20일 분포(src/services/forecastBaseRates.ts)라
  // 후보별 우열 정보가 없다. 점수 계산에서는 중립값(50)으로 두고, 표시만 과거 분포로 보여준다.
  const confidence = Number(item?.confidence_pct ?? 0)
  const upsidePct = clampValue(Number(item?.expected_upside_pct ?? 0), -100, 200)
  const drawdownPct = clampValue(Number(item?.expected_drawdown_pct ?? 0), -100, 100)
  const confidencePct = 50
  const edgePct = 50
  const momentumPct = clampValue(Number(item?.score_momentum ?? 0), 0, 100)
  const safetyPct = clampValue(Number(item?.score_safety ?? 0), 0, 100)
  const leadPct = clampValue(Number(item?.lead_accumulation_score ?? 0), 0, 100)
  const flow = computeNetFlowScore(item)
  const flowAcceleration = computeFlowAccelerationScore(flow.net5d, flow.net20d)
  const leadStage = formatStageLabel(item?.lead_accumulation_stage)
  // swing: 리드 축적(예열 중) 최우대
  const stageBoost = mode === 'swing'
    ? (leadStage === '리드 축적' ? 7 : (leadStage === '리드 돌파' ? 2 : 0))
    : (leadStage === '리드 돌파' ? 4 : (leadStage === '리드 축적' ? 2 : 0))
  const drawdownRisk = 50
  const confidenceRisk = 50
  const upsideSignal = clampValue(
    confidencePct * 0.23 +
    edgePct * 0.28 +
    momentumPct * 0.12 +
    safetyPct * 0.11 +
    leadPct * 0.1 +
    flow.score * 0.08 +
    flowAcceleration.score * 0.08,
    0,
    100,
  )
  const riskSignal = clampValue(
    (100 - safetyPct) * 0.45 +
    drawdownRisk * 0.35 +
    confidenceRisk * 0.2,
    0,
    100,
  )
  const v2Base = clampValue(upsideSignal * 0.76 + (100 - riskSignal) * 0.24, 0, 100)

  const legacyBaseScore = mode === 'multibagger'
    ? (
      confidencePct * 0.28 +
      edgePct * 0.29 +
      momentumPct * 0.2 +
      safetyPct * 0.06 +
      leadPct * 0.1 +
      flow.score * 0.07
    )
    : mode === 'swing'
    ? (
      confidencePct * 0.24 +
      edgePct * 0.30 +
      momentumPct * 0.10 +
      safetyPct * 0.20 +
      leadPct * 0.16 +
      flow.score * 0.00
    )
    : (
      confidencePct * 0.37 +
      edgePct * 0.23 +
      momentumPct * 0.16 +
      safetyPct * 0.09 +
      leadPct * 0.1 +
      flow.score * 0.05
    )

  const baseScore = mode === 'multibagger'
    ? (
      v2Base * 0.72 +
      momentumPct * 0.1 +
      leadPct * 0.1 +
      flowAcceleration.score * 0.08
    )
    : mode === 'swing'
    ? (
      // 스윙은 손익비/안전성과 초기 단계 신호에 더 높은 비중을 둔다.
      v2Base * 0.67 +
      edgePct * 0.14 +
      safetyPct * 0.1 +
      (leadStage === '리드 축적' ? 9 : 0)
    )
    : (
      v2Base * 0.8 +
      confidencePct * 0.1 +
      flowAcceleration.score * 0.1
    )
  const theme = getThemeBoost(item?.name, item?.sector_id)
  // swing: 20D 장기수급 보너스 항상 반영
  const longFlowBonus = flow.net20d != null && (mode === 'multibagger' || mode === 'swing')
    ? clampValue((flow.net20d / 1_000_000_000) * (mode === 'swing' ? 0.85 : 0.45), -8, 12)
    : 0
  const finalScore = clampValue(baseScore + stageBoost + longFlowBonus + theme.score * 0.5, 0, 100)
  const legacyScore = clampValue(legacyBaseScore + stageBoost + longFlowBonus + theme.score * 0.5, 0, 100)
  const modeLabel = mode === 'multibagger' ? '모드 멀티배거' : mode === 'swing' ? '모드 스윙' : '모드 밸런스'
  const reasons = [
    `후보점수 ${formatNumber(upsideSignal, 1)}`,
    `리스크 ${formatNumber(riskSignal, 1)}`,
    `전략 ${String(item?.strategy_label || '집행우선')}`,
    `과거 상승확률 ${Number.isFinite(confidence) ? `${formatNumber(confidence, 0)}%` : '—'}`,
    `과거 20일 상위25% ${formatNumber(upsidePct, 1)}% / 하위10% -${formatNumber(Math.abs(drawdownPct), 1)}%`,
    `모멘텀 ${formatNumber(momentumPct, 1)}`,
    `리드단계 ${leadStage}`,
    modeLabel,
  ]
  if (flow.label) reasons.push(flow.label)
  if (flowAcceleration.label) reasons.push(flowAcceleration.label)
  if (theme.labels.length > 0) reasons.push(`테마 ${theme.labels.join(', ')}`)

  return {
    code: String(item?.code || ''),
    name: String(item?.name || item?.code || ''),
    source: 'highlights',
    sector: item?.sector_id ? String(item.sector_id) : null,
    score: finalScore,
    scoreLegacy: legacyScore,
    upsideSignal,
    riskSignal,
    confidencePct: Number.isFinite(confidence) ? confidence : null,
    liquidity: null,
    intradayChangePct: null,
    netFlow5d: flow.net5d,
    netFlow20d: flow.net20d,
    reason: reasons.join(' · '),
  }
}
