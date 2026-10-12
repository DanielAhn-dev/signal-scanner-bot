import { formatKrw, formatKstDateTime, formatNumber } from '../../../lib/format'
import type { AutoCandidate, GuideRow, RiskMode, ScoreVersion } from '../types'
import { getCandidateScoreByVersion } from './candidateRank'
import { formatDateRangeLabel, formatRowDataAsOf } from './news'

export function toExecutionGuideSnapshotText(input: {
  generatedAtIso: string
  sourceLabel: string
  codeList: string[]
  capital: string
  maxWeightPct: string
  splitCount: string
  riskMode: RiskMode
  scoreVersion: ScoreVersion
  includeNews: boolean
  autoCandidates: AutoCandidate[]
  rows: GuideRow[]
}): string {
  const lines: string[] = []
  const generatedAtText = formatKstDateTime(input.generatedAtIso)
  const marketDateText = formatDateRangeLabel(input.rows.map((row) => row.marketDataDate))
  const newsDateText = formatDateRangeLabel(input.rows.map((row) => row.newsDataDate))
  const asOfParts = [
    marketDateText ? `시세 ${marketDateText}` : null,
    newsDateText ? `뉴스 ${newsDateText}` : null,
  ].filter(Boolean)
  lines.push('<b>매매 실행 계획서</b>')
  lines.push(`생성시각: ${generatedAtText}`)
  lines.push(`출처: ${input.sourceLabel}`)
  lines.push(`코드 ${input.codeList.length}개: ${input.codeList.join(', ') || '-'}`)
  if (asOfParts.length > 0) {
    lines.push(`데이터 기준일: ${asOfParts.join(' · ')}`)
  }
  lines.push('')
  lines.push('<b>설정</b>')
  lines.push(`• 총 투자금: ${formatKrw(Math.max(0, Number(input.capital || 0)))}`)
  lines.push(`• 종목당 최대 비중: ${Math.max(1, Math.min(100, Number(input.maxWeightPct || 25)))}%`)
  lines.push(`• 분할 횟수: ${Math.max(3, Number(input.splitCount || 4))}`)
  lines.push(`• 리스크 모드: ${input.riskMode}`)
  lines.push(`• 후보 점수 버전: ${input.scoreVersion === 'v2' ? 'v2(후보점수-리스크 분리)' : 'legacy(기존 가중합)'}`)
  lines.push(`• 뉴스 요약 포함: ${input.includeNews ? '예' : '아니오'}`)

  if (input.autoCandidates.length > 0) {
    lines.push('')
    lines.push('<b>자동 추천 후보 TOP</b>')
    const topItems = input.autoCandidates.slice(0, 8)
    const avgV2 = topItems.reduce((acc, item) => acc + item.score, 0) / Math.max(1, topItems.length)
    const avgLegacy = topItems.reduce((acc, item) => acc + item.scoreLegacy, 0) / Math.max(1, topItems.length)
    lines.push(`• 점수 버전 비교 요약: 평균 v2 ${formatNumber(avgV2, 1)} / 평균 legacy ${formatNumber(avgLegacy, 1)} / 평균 Δ ${formatNumber(avgV2 - avgLegacy, 1)}`)
    for (const item of topItems) {
      const displayScore = getCandidateScoreByVersion(item, input.scoreVersion)
      const scoreDelta = item.score - item.scoreLegacy
      const detailParts = [
        `v2 ${formatNumber(item.score, 1)} / legacy ${formatNumber(item.scoreLegacy, 1)}`,
        `Δ ${formatNumber(scoreDelta, 1)}`,
        `후보점수 ${item.upsideSignal != null ? formatNumber(item.upsideSignal, 1) : '—'} / 리스크 ${item.riskSignal != null ? formatNumber(item.riskSignal, 1) : '—'}`,
        item.reason,
      ]
      lines.push(`• ${item.name}(${item.code}) [${item.source === 'highlights' ? '집행우선' : '눌림목'}] 점수 ${formatNumber(displayScore, 1)} · ${detailParts.join(' · ')}`)
    }
  }

  lines.push('')
  lines.push('<b>종목별 실행 계획</b>')
  if (input.rows.length === 0) {
    lines.push('• 생성된 계획이 없습니다.')
  } else {
    for (const row of input.rows) {
      lines.push(`• ${row.name}(${row.code})`) 
      lines.push(`  - 점수/판정: ${row.score != null ? formatNumber(row.score, 1) : '—'} / ${row.statusLabel || '—'}`)
      lines.push(`  - 진입: ${row.entryLow != null && row.entryHigh != null ? `${formatKrw(row.entryLow)} ~ ${formatKrw(row.entryHigh)}` : '—'}`)
      lines.push(`  - 기준가: ${row.entryRef != null ? formatKrw(row.entryRef) : '—'}`)
      lines.push(`  - 데이터 기준일: ${formatRowDataAsOf(row.marketDataDate, row.newsDataDate)}`)
      lines.push(`  - 손절: ${row.stopPrice != null ? formatKrw(row.stopPrice) : '—'}`)
      lines.push(`  - 목표1/목표2: ${row.target1 != null ? formatKrw(row.target1) : '—'} / ${row.target2 != null ? formatKrw(row.target2) : '—'}`)
      lines.push(`  - 예산/수량: ${formatKrw(row.plannedBudget)} / ${row.qty.toLocaleString()}주`)
      if (row.warnings.length > 0) lines.push(`  - 주의: ${row.warnings.join(' / ')}`)
      if (row.headlines.length > 0) {
        const entries = row.headlineLinks.length > 0
          ? row.headlineLinks.slice(0, 3)
          : row.headlines.slice(0, 3).map((title) => ({ title, url: null, source: null }))
        for (const headline of entries) {
          lines.push(`    · ${headline.title}${headline.source ? ` (출처: ${headline.source})` : ''}${headline.url ? ` | ${headline.url}` : ''}`)
        }
      }
    }
  }

  // Structured JSON prefix for high-quality PDF rendering
  const egData = {
    v: 1,
    generatedAtIso: input.generatedAtIso,
    sourceLabel: input.sourceLabel,
    capital: input.capital,
    maxWeightPct: input.maxWeightPct,
    splitCount: input.splitCount,
    riskMode: input.riskMode as string,
    scoreVersion: input.scoreVersion,
    includeNews: input.includeNews,
    autoCandidates: input.autoCandidates.slice(0, 10).map((c) => ({
      code: c.code,
      name: c.name,
      source: c.source as string,
      score: c.score,
      scoreLegacy: c.scoreLegacy,
      displayScore: getCandidateScoreByVersion(c, input.scoreVersion),
      upsideSignal: c.upsideSignal,
      riskSignal: c.riskSignal,
      reason: c.reason,
      netFlow5d: c.netFlow5d ?? null,
      netFlow20d: c.netFlow20d ?? null,
    })),
    rows: input.rows.map((r) => ({
      code: r.code,
      name: r.name,
      score: r.score,
      statusLabel: r.statusLabel,
      summary: r.summary,
      entryLow: r.entryLow,
      entryHigh: r.entryHigh,
      entryRef: r.entryRef,
      stopPrice: r.stopPrice,
      target1: r.target1,
      target2: r.target2,
      target1Pct: r.target1Pct,
      target2Pct: r.target2Pct,
      holdDays: r.holdDays,
      riskReward: r.riskReward,
      warnings: r.warnings,
      headlines: r.headlines.slice(0, 3),
      headlineLinks: r.headlineLinks.slice(0, 3),
      marketDataDate: r.marketDataDate,
      newsDataDate: r.newsDataDate,
      plannedBudget: r.plannedBudget,
      qty: r.qty,
      firstOrderAmount: r.firstOrderAmount,
    })),
  }
  return `__EXGUIDE__\n${JSON.stringify(egData)}\n__EGTEXT__\n${lines.join('\n')}`
}
