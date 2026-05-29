import React, { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { formatKrw, formatNumber } from '../../lib/format'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import SheetHeaderBar from '../../components/SheetHeaderBar'
import EconomicEventBadge from '../../components/EconomicEventBadge'
import ShareModal from '../../components/ShareModal'
import { useToast } from '../../components/ToastProvider'
import { useShareManager } from '../../hooks/useShareManager'
import { getCurrentClientIdFromStore, useCurrentChatId } from '../../stores/profileStore'

const EXECUTION_GUIDE_PENDING_KEY = 'execution_guide_pending_v1'

type RiskMode = 'conservative' | 'neutral' | 'aggressive'
type CandidateMode = 'balanced' | 'multibagger' | 'swing'
type ScoreVersion = 'v2' | 'legacy'

type GuideRow = {
  code: string
  name: string
  score: number | null
  statusLabel: string | null
  summary: string | null
  entryLow: number | null
  entryHigh: number | null
  entryRef: number | null
  stopPrice: number | null
  target1: number | null
  target2: number | null
  target1Pct: number | null
  target2Pct: number | null
  holdDays: [number, number] | null
  riskReward: number | null
  warnings: string[]
  headlines: string[]
  headlineLinks: Array<{ title: string; url: string | null; source: string | null }>
  marketDataDate: string | null
  newsDataDate: string | null
  plannedBudget: number
  qty: number
  firstOrderAmount: number
}

type AutoCandidate = {
  code: string
  name: string
  source: 'highlights' | 'scan'
  sector: string | null
  score: number
  scoreLegacy: number
  upsideSignal: number | null
  riskSignal: number | null
  confidencePct: number | null
  liquidity: number | null
  intradayChangePct: number | null
  netFlow5d: number | null
  netFlow20d: number | null
  reason: string
}

function getCandidateScoreByVersion(candidate: AutoCandidate, version: ScoreVersion): number {
  return version === 'legacy' ? candidate.scoreLegacy : candidate.score
}

function toExecutionGuideSnapshotText(input: {
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
  const generatedAtText = new Date(input.generatedAtIso).toLocaleString('ko-KR')
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
  lines.push(`• 후보 점수 버전: ${input.scoreVersion === 'v2' ? 'v2(상승잠재-리스크 분리)' : 'legacy(기존 가중합)'}`)
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
        `상승잠재 ${item.upsideSignal != null ? formatNumber(item.upsideSignal, 1) : '—'} / 리스크 ${item.riskSignal != null ? formatNumber(item.riskSignal, 1) : '—'}`,
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

function parseCodes(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const token of text.split(/[\s,\n]+/g)) {
    const value = token.trim()
    if (!value) continue
    const code = value.replace(/[^0-9A-Za-z]/g, '').toUpperCase()
    if (!code) continue
    if (seen.has(code)) continue
    seen.add(code)
    out.push(code)
  }
  return out
}

function normalizeSourceLabel(input: string | null | undefined): string {
  const value = String(input || '').trim().toLowerCase()
  if (!value) return '수동 입력'
  if (value === 'manual' || value === 'manual-input') return '수동 입력'
  if (value === 'auto-scan' || value === 'autoscan') return '자동 후보(스캔)'
  if (value === 'scan') return '스캔 연동'
  if (value === 'highlights') return '집행우선 연동'
  if (value === 'execution-guide') return '실행가이드'
  return String(input || '').trim()
}

function autoSourceLabelByMode(mode: CandidateMode): string {
  if (mode === 'multibagger') return '자동 후보(멀티배거)'
  if (mode === 'swing') return '자동 후보(스윙)'
  return '자동 후보(밸런스)'
}

function applyRiskMode(v: number | null, mode: RiskMode, kind: 'target' | 'stop'): number | null {
  if (v == null) return null
  const targetFactor: Record<RiskMode, number> = {
    conservative: 0.85,
    neutral: 1,
    aggressive: 1.18,
  }
  const stopFactor: Record<RiskMode, number> = {
    conservative: 0.9,
    neutral: 1,
    aggressive: 1.15,
  }
  const factor = kind === 'target' ? targetFactor[mode] : stopFactor[mode]
  return Math.round(v * factor)
}

function parseHoldDays(input: unknown): [number, number] | null {
  if (!Array.isArray(input) || input.length < 2) return null
  const a = Number(input[0])
  const b = Number(input[1])
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return [Math.max(1, Math.floor(a)), Math.max(1, Math.floor(b))]
}

function decodeHeadlineText(input: string): string {
  const base = String(input || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_m, dec: string) => {
      const value = Number(dec)
      return Number.isFinite(value) ? String.fromCharCode(value) : _m
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => {
      const value = Number.parseInt(hex, 16)
      return Number.isFinite(value) ? String.fromCharCode(value) : _m
    })

  return base.replace(/\s{2,}/g, ' ').trim()
}

function normalizeNewsUrl(input: unknown): string | null {
  const value = String(input || '').trim()
  if (!value) return null
  if (/^https?:\/\//i.test(value)) return value
  if (value.startsWith('//')) return `https:${value}`
  return null
}

function normalizeNewsSource(input: unknown): string | null {
  const value = decodeHeadlineText(String(input || ''))
  return value || null
}

function normalizeDateLabel(input: unknown): string | null {
  const raw = String(input || '').trim()
  if (!raw) return null
  const dateOnly = raw.match(/\d{4}-\d{2}-\d{2}/)?.[0]
  if (dateOnly) return dateOnly
  const compact = raw.match(/(\d{4})[./](\d{1,2})[./](\d{1,2})/)
  if (compact) {
    const y = compact[1]
    const m = compact[2].padStart(2, '0')
    const d = compact[3].padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  const ts = Date.parse(raw)
  if (Number.isFinite(ts)) {
    return new Date(ts).toISOString().slice(0, 10)
  }
  return null
}

function formatDateRangeLabel(values: Array<string | null | undefined>): string | null {
  const uniq = Array.from(new Set(values.map((value) => normalizeDateLabel(value)).filter(Boolean) as string[])).sort()
  if (uniq.length === 0) return null
  if (uniq.length === 1) return uniq[0]
  return `${uniq[0]}~${uniq[uniq.length - 1]}`
}

function formatRowDataAsOf(marketDataDate: string | null, newsDataDate: string | null): string {
  const market = normalizeDateLabel(marketDataDate)
  const news = normalizeDateLabel(newsDataDate)
  const parts = [
    market ? `시세 ${market}` : null,
    news ? `뉴스 ${news}` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : '—'
}

function clampValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

function normalizeScoreFrom5(value: number | null | undefined): number {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return 0
  if (n > 5) return clampValue(n, 0, 100)
  return clampValue(n * 20, 0, 100)
}

function gradeToPct(grade: unknown): number {
  const value = String(grade || '').trim().toUpperCase()
  if (value === 'A') return 92
  if (value === 'B') return 78
  if (value === 'C') return 60
  if (value === 'D') return 42
  return 50
}

function pickFirstFiniteNumber(obj: any, keys: string[]): number | null {
  for (const key of keys) {
    const value = Number(obj?.[key])
    if (Number.isFinite(value)) return value
  }
  return null
}

function computeNetFlow(item: any): { net5d: number | null; net20d: number | null } {
  const foreign = pickFirstFiniteNumber(item, [
    'foreign_net_buy_5d',
    'foreignNetBuy5d',
    'foreign5d',
  ])
  const institution = pickFirstFiniteNumber(item, [
    'institution_net_buy_5d',
    'institutionNetBuy5d',
    'institution5d',
  ])
  const foreign20 = pickFirstFiniteNumber(item, [
    'foreign_net_buy_20d',
    'foreignNetBuy20d',
    'foreign20d',
  ])
  const institution20 = pickFirstFiniteNumber(item, [
    'institution_net_buy_20d',
    'institutionNetBuy20d',
    'institution20d',
  ])

  const net5d = foreign == null && institution == null
    ? null
    : (foreign ?? 0) + (institution ?? 0)
  const net20d = foreign20 == null && institution20 == null
    ? null
    : (foreign20 ?? 0) + (institution20 ?? 0)

  return { net5d, net20d }
}

function formatCompactKrw(value: number | null | undefined): string {
  if (value == null) return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  const sign = n >= 0 ? '+' : '-'
  const abs = Math.abs(Math.round(n))
  if (abs >= 100_000_000) return `${sign}${formatNumber(abs / 100_000_000, abs >= 1_000_000_000 ? 1 : 0)}억원`
  if (abs >= 10_000) return `${sign}${formatNumber(Math.round(abs / 10_000))}만원`
  return `${sign}${formatNumber(abs)}원`
}

function computeNetFlowScore(item: any): { score: number; label: string | null; net5d: number | null; net20d: number | null } {
  const flow = computeNetFlow(item)
  if (flow.net5d == null && flow.net20d == null) return { score: 50, label: null, net5d: null, net20d: null }

  const net5d = flow.net5d ?? 0
  const net20d = flow.net20d ?? 0
  const billions5d = net5d / 1_000_000_000
  const billions20d = net20d / 1_000_000_000
  const score = clampValue(50 + billions5d * 3.6 + billions20d * 1.4, 0, 100)
  const leadNet = flow.net5d ?? flow.net20d ?? 0
  const label = leadNet >= 0
    ? `수급 순유입(5D) ${formatKrw(Math.round(Math.abs(net5d)))}`
    : `수급 순유출(5D) ${formatKrw(Math.round(Math.abs(net5d)))}`
  return { score, label, net5d: flow.net5d, net20d: flow.net20d }
}

function computeFlowAccelerationScore(net5d: number | null, net20d: number | null): { score: number; label: string | null } {
  if (net5d == null && net20d == null) return { score: 50, label: null }
  const daily5 = (net5d ?? 0) / 5
  const daily20 = (net20d ?? 0) / 20
  const delta = daily5 - daily20
  const score = clampValue(50 + (delta / 200_000_000) * 18 + ((net5d ?? 0) / 1_000_000_000) * 1.2, 0, 100)
  const label = delta >= 0
    ? `수급 가속(최근) +${formatKrw(Math.round(Math.abs(delta * 5)))}`
    : `수급 둔화(최근) -${formatKrw(Math.round(Math.abs(delta * 5)))}`
  return { score, label }
}

function scoreSignalFreshness(ageDays: number | null | undefined, liteAgeDays: number | null | undefined): { score: number; label: string | null } {
  const strictAge = Number(ageDays)
  const liteAge = Number(liteAgeDays)
  if (Number.isFinite(strictAge) && strictAge >= 0) {
    const score = strictAge <= 0 ? 100 : strictAge <= 1 ? 92 : strictAge <= 3 ? 80 : strictAge <= 5 ? 68 : strictAge <= 10 ? 52 : 36
    return { score, label: `신호 신선도(D-${strictAge})` }
  }
  if (Number.isFinite(liteAge) && liteAge >= 0) {
    const score = liteAge <= 0 ? 92 : liteAge <= 1 ? 84 : liteAge <= 3 ? 72 : liteAge <= 5 ? 60 : liteAge <= 10 ? 46 : 32
    return { score, label: `라이트 신호(D-${liteAge})` }
  }
  return { score: 55, label: null }
}

function computeOverheatRisk(intradayPct: number): number {
  const upRisk = Math.max(0, intradayPct - 4.2)
  const downRisk = Math.max(0, -intradayPct - 4.8)
  return clampValue(upRisk * 18 + downRisk * 10, 0, 100)
}

function formatStageLabel(stage: unknown): string {
  const value = String(stage || '').trim().toLowerCase()
  if (value === 'breakout') return '리드 돌파'
  if (value === 'lead') return '리드 축적'
  return '일반'
}

function getThemeBoost(name?: string | null, sector?: string | null): { score: number; labels: string[] } {
  const text = `${name || ''} ${sector || ''}`.toLowerCase()
  const tags: Array<{ score: number; label: string; tokens: string[] }> = [
    { score: 1.6, label: 'LG그룹/전장', tokens: ['lg', '엘지', '전장'] },
    { score: 2, label: '반도체/소부장', tokens: ['반도체', 'semiconductor', '소부장', 'hbm', '메모리'] },
    { score: 1.8, label: '로봇/자동화', tokens: ['로봇', 'robot', '자동화'] },
    { score: 1.4, label: '현대차그룹', tokens: ['현대차', '현대모비스', '오토에버', 'hl만도', '기아'] },
  ]

  let score = 0
  const labels: string[] = []
  for (const tag of tags) {
    if (tag.tokens.some((token) => text.includes(token))) {
      score += tag.score
      labels.push(tag.label)
    }
  }
  return { score, labels }
}

function rankScanCandidate(item: any, mode: CandidateMode): AutoCandidate {
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
    `상승잠재 ${formatNumber(upsideSignal, 1)}`,
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

function rankHighlightCandidate(item: any, mode: CandidateMode): AutoCandidate {
  const confidence = Number(item?.confidence_pct ?? 0)
  const confidencePct = clampValue(Number.isFinite(confidence) ? confidence : 0, 0, 100)
  const upsidePct = clampValue(Number(item?.expected_upside_pct ?? 0), -100, 200)
  const drawdownPct = clampValue(Number(item?.expected_drawdown_pct ?? 0), -100, 100)
  const edgePct = clampValue(50 + (upsidePct - Math.abs(drawdownPct)) * 4, 0, 100)
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
  const drawdownAbs = Math.abs(drawdownPct)
  const drawdownRisk = clampValue(drawdownAbs * 11.5, 0, 100)
  const confidenceRisk = clampValue((70 - confidencePct) * 1.25, 0, 100)
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
  const weakEdgePenalty = upsidePct < drawdownAbs * 1.4 ? clampValue((drawdownAbs * 1.4 - upsidePct) * 1.6, 0, 18) : 0
  const finalScore = clampValue(baseScore + stageBoost + longFlowBonus + theme.score * 0.5 - weakEdgePenalty, 0, 100)
  const legacyScore = clampValue(legacyBaseScore + stageBoost + longFlowBonus + theme.score * 0.5, 0, 100)
  const modeLabel = mode === 'multibagger' ? '모드 멀티배거' : mode === 'swing' ? '모드 스윙' : '모드 밸런스'
  const reasons = [
    `상승잠재 ${formatNumber(upsideSignal, 1)}`,
    `리스크 ${formatNumber(riskSignal, 1)}`,
    `전략 ${String(item?.strategy_label || '집행우선')}`,
    `신뢰도 ${Number.isFinite(confidence) ? `${formatNumber(confidence, 1)}%` : '—'}`,
    `기대상승 ${formatNumber(upsidePct, 1)}% / 기대낙폭 ${formatNumber(Math.abs(drawdownPct), 1)}%`,
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

function formatFlowBadgeLabel(flow5d: number | null, flow20d: number | null): string {
  const base = flow5d != null ? flow5d : flow20d
  if (base == null) return '수급액 데이터 없음'
  const sign = base >= 0 ? '유입' : '유출'
  const fiveText = flow5d == null ? '—' : formatCompactKrw(flow5d)
  const twentyText = flow20d == null ? '—' : formatCompactKrw(flow20d)
  return `수급액 ${sign} 5D ${fiveText} · 20D ${twentyText}`
}

function normalizeSectorKey(value: string | null | undefined): string {
  const text = String(value || '').trim().toLowerCase()
  if (!text) return '__unknown__'
  if (text.includes('반도체') || text.includes('semiconductor') || text.includes('소부장')) return 'semiconductor'
  if (text.includes('로봇') || text.includes('automation') || text.includes('자동화')) return 'robotics'
  if (text.includes('전장') || text.includes('현대차') || text.includes('자동차') || text.includes('auto')) return 'auto'
  if (text.includes('2차전지') || text.includes('배터리') || text.includes('battery')) return 'battery'
  if (text.includes('바이오') || text.includes('제약') || text.includes('bio') || text.includes('pharma')) return 'bio'
  return text
}

function pickDiversifiedCandidates(input: AutoCandidate[], limit = 16, perSectorCap = 2): AutoCandidate[] {
  const selected: AutoCandidate[] = []
  const sectorCount = new Map<string, number>()
  const usedCode = new Set<string>()

  // 1차: 점수 순을 유지하면서 섹터당 최대 개수 제한을 적용한다.
  for (const row of input) {
    if (selected.length >= limit) break
    if (!row.code || usedCode.has(row.code)) continue
    const sectorKey = normalizeSectorKey(row.sector)
    const used = sectorCount.get(sectorKey) ?? 0
    if (used >= perSectorCap) continue
    selected.push(row)
    usedCode.add(row.code)
    sectorCount.set(sectorKey, used + 1)
  }

  // 2차: 제한 때문에 자리가 남으면 점수 상위 순으로 채운다.
  if (selected.length < limit) {
    for (const row of input) {
      if (selected.length >= limit) break
      if (!row.code || usedCode.has(row.code)) continue
      selected.push(row)
      usedCode.add(row.code)
    }
  }

  return selected
}

export default function ExecutionGuidePage() {
  const chatId = useCurrentChatId()
  const toast = useToast()
  const [codesText, setCodesText] = useState('')
  const [capital, setCapital] = useState('10000000')
  const [maxWeightPct, setMaxWeightPct] = useState('25')
  const [splitCount, setSplitCount] = useState('4')
  const [riskMode, setRiskMode] = useState<RiskMode>('neutral')
  const [sourceLabel, setSourceLabel] = useState('수동 입력')
  const [includeNews, setIncludeNews] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<GuideRow[]>([])
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [hydratedByPending, setHydratedByPending] = useState(false)
  const [autoCandidates, setAutoCandidates] = useState<AutoCandidate[]>([])
  const [autoLoading, setAutoLoading] = useState(false)
  const [autoError, setAutoError] = useState<string | null>(null)
  const [candidateMode, setCandidateMode] = useState<CandidateMode>('balanced')
  const [scoreVersion, setScoreVersion] = useState<ScoreVersion>('v2')
  const [compactView, setCompactView] = useState(false)
  const [snapshotReady, setSnapshotReady] = useState(false)
  const [lastSnapshotAt, setLastSnapshotAt] = useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const shareManager = useShareManager({
    endpoint: '/api/ui/report-share',
    scopeKey: 'topic',
    requiresCode: true,
  })

  const persistGuideSnapshot = async (payload: { generatedAtIso: string; rows: GuideRow[]; codeList: string[]; sourceLabel?: string }): Promise<boolean> => {
    if (payload.rows.length === 0) return false
    const resolvedSourceLabel = payload.sourceLabel ?? sourceLabel
    const snapshotAutoCandidates = [...autoCandidates].sort(
      (a, b) => getCandidateScoreByVersion(b, scoreVersion) - getCandidateScoreByVersion(a, scoreVersion),
    )
    const bodyText = toExecutionGuideSnapshotText({
      generatedAtIso: payload.generatedAtIso,
      sourceLabel: resolvedSourceLabel,
      codeList: payload.codeList,
      capital,
      maxWeightPct,
      splitCount,
      riskMode,
      scoreVersion,
      includeNews,
      autoCandidates: snapshotAutoCandidates,
      rows: payload.rows,
    })

    try {
      const saved = await apiFetch('/api/ui/report-snapshot', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 15_000,
        body: JSON.stringify({
          topic: '실행가이드',
          bodyText,
          sourceLabel: '/실행가이드 스냅샷',
        }),
      })
      return Boolean(saved?.ok)
    } catch {
      // 공유/PDF를 위한 스냅샷 저장 실패는 화면 사용성을 방해하지 않는다.
      return false
    }
  }

  const openExecutionGuideShare = async () => {
    if (rows.length === 0) {
      setError('먼저 가이드를 생성해 주세요.')
      return
    }

    if (!snapshotReady) {
      const nextGeneratedAt = generatedAt || new Date().toISOString()
      if (!generatedAt) setGeneratedAt(nextGeneratedAt)
      const saved = await persistGuideSnapshot({ generatedAtIso: nextGeneratedAt, rows, codeList })
      setSnapshotReady(saved)
      if (!saved) {
        setError('스냅샷 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.')
        return
      }
      setLastSnapshotAt(new Date().toISOString())
    }
    setError(null)
    await shareManager.createShare('실행가이드', { topic: '실행가이드' })
  }

  const openExecutionGuideShareManager = async () => {
    await shareManager.loadList('실행가이드')
    shareManager.setOpen(true)
  }

  const appendQueryParam = (url: string, key: string, value: string): string => {
    if (!value) return url
    if (new RegExp(`(?:\\?|&)${key}=`).test(url)) return url
    return `${url}${url.includes('?') ? '&' : '?'}${encodeURIComponent(key)}=${encodeURIComponent(value)}`
  }

  const buildUiRequest = (endpoint: string): { url: string; headers: Record<string, string> } => {
    const base = import.meta.env.VITE_API_BASE || ''
    const uiKey = import.meta.env.VITE_UI_READ_KEY
    const clientId = getCurrentClientIdFromStore()

    let resolvedEndpoint = endpoint
    if (uiKey) resolvedEndpoint = appendQueryParam(resolvedEndpoint, 'ui_key', uiKey)
    if (clientId) resolvedEndpoint = appendQueryParam(resolvedEndpoint, 'client_id', clientId)
    if (chatId) resolvedEndpoint = appendQueryParam(resolvedEndpoint, 'chat_id', chatId)

    const url = base
      ? `${base.replace(/\/$/, '')}${resolvedEndpoint.startsWith('/') ? resolvedEndpoint : `/${resolvedEndpoint}`}`
      : resolvedEndpoint

    const headers: Record<string, string> = {}
    if (uiKey) headers['x-ui-key'] = uiKey
    if (chatId) headers['x-user-chat-id'] = chatId
    return { url, headers }
  }

  const downloadExecutionGuidePdf = async () => {
    if (rows.length === 0) {
      setError('먼저 가이드를 생성해 주세요.')
      return
    }

    setPdfLoading(true)
    try {
      if (!snapshotReady) {
        const nextGeneratedAt = generatedAt || new Date().toISOString()
        if (!generatedAt) setGeneratedAt(nextGeneratedAt)
        const saved = await persistGuideSnapshot({ generatedAtIso: nextGeneratedAt, rows, codeList })
        setSnapshotReady(saved)
        if (!saved) {
          throw new Error('스냅샷 저장 실패')
        }
        setLastSnapshotAt(new Date().toISOString())
      }

      const request = buildUiRequest('/api/ui/report-pdf?topic=실행가이드')
      const res = await fetch(request.url, { method: 'GET', headers: request.headers })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(text || `다운로드 실패 (${res.status})`)
      }

      const blob = await res.blob()
      const downloadUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = downloadUrl
      const today = new Date()
      const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
      a.download = `execution_guide_report_${dateStr}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(downloadUrl)

      setError(null)
      toast.show('실행가이드 PDF 다운로드 완료 ✓')
    } catch (e: any) {
      const msg = String(e?.message || e)
      setError(`PDF 생성 실패: ${msg}`)
      toast.show(`PDF 생성 실패: ${msg}`)
    } finally {
      setPdfLoading(false)
    }
  }

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const urlCodes = params.get('codes')
      const urlSource = params.get('source')
      if (urlCodes) {
        const normalized = parseCodes(urlCodes).join(', ')
        if (normalized) setCodesText(normalized)
      }
      if (urlSource) setSourceLabel(normalizeSourceLabel(urlSource))

      const pendingRaw = sessionStorage.getItem(EXECUTION_GUIDE_PENDING_KEY)
      if (pendingRaw) {
        const parsed = JSON.parse(pendingRaw) as { codes?: string[]; source?: string }
        if (Array.isArray(parsed?.codes) && parsed.codes.length > 0) {
          setCodesText(parseCodes(parsed.codes.join(',')).join(', '))
          setHydratedByPending(true)
        }
        if (parsed?.source) setSourceLabel(normalizeSourceLabel(String(parsed.source)))
        sessionStorage.removeItem(EXECUTION_GUIDE_PENDING_KEY)
      }
    } catch {
      // ignore
    }
  }, [])

  const codeList = useMemo(() => parseCodes(codesText), [codesText])
  const visibleAutoCandidates = useMemo(
    () => [...autoCandidates].sort((a, b) => getCandidateScoreByVersion(b, scoreVersion) - getCandidateScoreByVersion(a, scoreVersion)),
    [autoCandidates, scoreVersion],
  )

  const buildGuide = async () => {
    if (codeList.length === 0 && autoCandidates.length === 0) {
      setError('종목 코드를 1개 이상 입력해 주세요.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const totalCapital = Math.max(0, Number(capital || 0))
      const maxWeight = Math.max(1, Math.min(100, Number(maxWeightPct || 25)))
      const slots = Math.max(3, Number(splitCount || 4))
      const manualCodes = codeList
      const autoFillPool = manualCodes.length < 3
        ? (visibleAutoCandidates.length > 0 ? visibleAutoCandidates : await fetchAutoCandidates())
        : []
      const autoFillCodes = autoFillPool.map((candidate) => candidate.code).filter(Boolean)
      const autoCodeSet = new Set(autoCandidates.map((candidate) => candidate.code))
      const usedAutoMode = autoFillCodes.length > 0 || (manualCodes.length > 0 && manualCodes.every((code) => autoCodeSet.has(code)))
      const resolvedSourceLabel = usedAutoMode ? autoSourceLabelByMode(candidateMode) : (sourceLabel.trim() || '수동 입력')
      if (resolvedSourceLabel !== sourceLabel) {
        setSourceLabel(resolvedSourceLabel)
      }
      if (autoCandidates.length === 0 && autoFillPool.length > 0) {
        setAutoCandidates(autoFillPool)
      }
      const effectiveCodes = [...new Set([...manualCodes, ...autoFillCodes])].slice(0, Math.max(3, manualCodes.length || 0, autoFillCodes.length > 0 ? 4 : 0))
      const finalCodes = effectiveCodes.length > 0 ? effectiveCodes : manualCodes
      const budgetPerName = Math.floor(Math.min(totalCapital / finalCodes.length, totalCapital * (maxWeight / 100)))

      const fetched = await Promise.all(
        finalCodes.map(async (code) => {
          const chatQs = chatId ? `&chat_id=${encodeURIComponent(chatId)}` : ''
          const stockRes = await apiFetch(`/api/ui/stock-latest?code=${encodeURIComponent(code)}${chatQs}`, {
            cacheMs: 0,
            timeoutMs: 20_000,
          })

          if (!(stockRes?.profile || stockRes?.latest)) {
            throw new Error(`${code}: 종목 데이터 조회 실패`)
          }

          const merged = { ...(stockRes.profile || {}), ...(stockRes.latest || {}) }
          const advisor = stockRes.advisor || {}

          let headlines: string[] = []
          let headlineLinks: Array<{ title: string; url: string | null; source: string | null }> = []
          let newsRes: any = null
          if (includeNews) {
            newsRes = await apiFetch(`/api/ui/news?q=${encodeURIComponent(code)}&page=1&pageSize=3`, {
              cacheMs: 30_000,
              timeoutMs: 10_000,
            }).catch(() => null)
            headlineLinks = Array.isArray(newsRes?.data)
              ? newsRes.data
                .map((item: any) => {
                  const title = decodeHeadlineText(String(item?.title || ''))
                  const url = normalizeNewsUrl(item?.originallink ?? item?.link ?? item?.url)
                  const source = normalizeNewsSource(item?.source ?? item?.press ?? item?.officeName ?? item?.publisher ?? item?.media)
                  return { title, url, source }
                })
                .filter((item: { title: string }) => Boolean(item.title))
                .slice(0, 3)
              : []
            headlines = headlineLinks.map((item) => item.title)
          }

          const marketDataDate = formatDateRangeLabel([
            stockRes?.latest?.trade_date,
            stockRes?.profile?.indicators_as_of,
            stockRes?.data?.[0]?.trade_date,
            stockRes?.data?.[0]?.date,
            stockRes?.flow?.date,
            stockRes?.profile?.updated_at,
          ])
          const newsDataDate = includeNews
            ? formatDateRangeLabel(
              (Array.isArray(newsRes?.data) ? newsRes.data : []).slice(0, 3).flatMap((item: any) => [
                item?.pubDate,
                item?.published_at,
                item?.publishedAt,
                item?.datetime,
                item?.date,
              ])
            )
            : null

          const entryLow = Number.isFinite(Number(advisor.entryLow)) ? Number(advisor.entryLow) : null
          const entryHigh = Number.isFinite(Number(advisor.entryHigh)) ? Number(advisor.entryHigh) : null
          const entryRef = entryLow != null && entryHigh != null
            ? Math.round((entryLow + entryHigh) / 2)
            : (Number.isFinite(Number(merged.close)) ? Number(merged.close) : null)

          const stopPriceRaw = Number.isFinite(Number(advisor.stopPrice)) ? Number(advisor.stopPrice) : null
          const target1Raw = Number.isFinite(Number(advisor.target1)) ? Number(advisor.target1) : null
          const target2Raw = Number.isFinite(Number(advisor.target2)) ? Number(advisor.target2) : null

          const stopPrice = applyRiskMode(stopPriceRaw, riskMode, 'stop')
          const target1 = applyRiskMode(target1Raw, riskMode, 'target')
          const target2 = applyRiskMode(target2Raw, riskMode, 'target')

          const qty = entryRef && entryRef > 0 ? Math.max(0, Math.floor(budgetPerName / entryRef)) : 0
          const firstOrderAmount = entryRef && qty > 0
            ? Math.round((qty * entryRef) / slots)
            : 0

          return {
            code,
            name: String(merged.name || code),
            score: Number.isFinite(Number(advisor.finalScore)) ? Number(advisor.finalScore) : null,
            statusLabel: advisor.statusLabel ? String(advisor.statusLabel) : null,
            summary: advisor.summary ? decodeHeadlineText(String(advisor.summary)) : null,
            entryLow,
            entryHigh,
            entryRef,
            stopPrice,
            target1,
            target2,
            target1Pct: Number.isFinite(Number(advisor.target1Pct)) ? Number(advisor.target1Pct) : null,
            target2Pct: Number.isFinite(Number(advisor.target2Pct)) ? Number(advisor.target2Pct) : null,
            holdDays: parseHoldDays(advisor.holdDays),
            riskReward: Number.isFinite(Number(advisor.riskReward)) ? Number(advisor.riskReward) : null,
            warnings: Array.isArray(advisor.warnings)
              ? advisor.warnings.map((w: any) => decodeHeadlineText(String(w))).slice(0, 2)
              : [],
            headlines: headlines.map(decodeHeadlineText),
            headlineLinks,
            marketDataDate,
            newsDataDate,
            plannedBudget: budgetPerName,
            qty,
            firstOrderAmount,
          } satisfies GuideRow
        }),
      )

      setRows(fetched)
      if (finalCodes.length !== codeList.length) {
        setCodesText(finalCodes.join(', '))
      }
      const nextGeneratedAt = new Date().toISOString()
      setGeneratedAt(nextGeneratedAt)
      const saved = await persistGuideSnapshot({
        generatedAtIso: nextGeneratedAt,
        rows: fetched,
        codeList: finalCodes,
        sourceLabel: resolvedSourceLabel,
      })
      setSnapshotReady(saved)
      setLastSnapshotAt(saved ? new Date().toISOString() : null)
    } catch (e: any) {
      setError(e?.message || String(e))
      setRows([])
      setSnapshotReady(false)
      setLastSnapshotAt(null)
    } finally {
      setLoading(false)
    }
  }

  const totalPlanned = useMemo(() => rows.reduce((acc, row) => acc + (row.entryRef && row.qty > 0 ? row.entryRef * row.qty : 0), 0), [rows])
  const totalCapital = Math.max(0, Number(capital || 0))

  const fetchAutoCandidates = async (): Promise<AutoCandidate[]> => {
    const [highlightsRes, scanRes] = await Promise.all([
      apiFetch('/api/ui/scan-highlights', { cacheMs: 30_000, timeoutMs: 30_000 }).catch(() => null),
      apiFetch('/api/ui/scan-candidates?limit=120&cacheMs=0', { cacheMs: 0, timeoutMs: 30_000 }).catch(() => null),
    ])

    const highlightItems = Array.isArray(highlightsRes?.data) ? highlightsRes.data : []
    const scanItems = Array.isArray(scanRes?.data) ? scanRes.data : []
    const ranked = [
      ...highlightItems.map((row: any) => rankHighlightCandidate(row, candidateMode)),
      ...scanItems.map((row: any) => rankScanCandidate(row, candidateMode)),
    ].filter((item) => item.code)

    if (ranked.length === 0) return []

    const merged = new Map<string, AutoCandidate>()
    for (const row of ranked) {
      const prev = merged.get(row.code)
      if (!prev || row.score > prev.score) {
        merged.set(row.code, row)
      }
    }

    const sorted = [...merged.values()].sort((a, b) => b.score - a.score)
    return pickDiversifiedCandidates(sorted, 16, 2)
  }

  const loadAutoCandidates = async () => {
    setAutoLoading(true)
    setAutoError(null)
    try {
      const diversified = await fetchAutoCandidates()

      if (diversified.length === 0) {
        setAutoCandidates([])
        setAutoError('자동 후보를 찾지 못했습니다. 스캔 데이터 동기화 후 다시 시도해 주세요.')
        return
      }

      setAutoCandidates(diversified)
      const autoLabel = autoSourceLabelByMode(candidateMode)
      setSourceLabel(autoLabel)
      if (codeList.length === 0 && diversified.length > 0) {
        const sortedForView = [...diversified].sort((a, b) => getCandidateScoreByVersion(b, scoreVersion) - getCandidateScoreByVersion(a, scoreVersion))
        setCodesText(sortedForView.slice(0, 6).map((row) => row.code).join(', '))
      }
    } catch (e: any) {
      setAutoError(e?.message || String(e))
      setAutoCandidates([])
    } finally {
      setAutoLoading(false)
    }
  }

  const useAutoCandidatesAsCodes = () => {
    if (autoCandidates.length === 0) {
      setError('먼저 자동 후보 찾기를 실행해 주세요.')
      return
    }
    const next = visibleAutoCandidates.slice(0, 8).map((row) => row.code).join(', ')
    setCodesText(next)
    setSourceLabel(autoSourceLabelByMode(candidateMode))
    setError(null)
  }

  useEffect(() => {
    if (!hydratedByPending) return
    if (loading) return
    if (rows.length > 0) return
    if (codeList.length === 0) return
    void buildGuide()
    setHydratedByPending(false)
  }, [hydratedByPending, loading, rows.length, codeList.length])

  return (
    <section className="xls-page-inset">
      <div className="xls-scroll-frame" style={{ ['--xls-table-min-width' as any]: '360px' }}>
        <table className="xls-table" style={{ width: 'max-content', minWidth: '100%', tableLayout: 'auto' }}>
          <tbody>
            <tr className="xls-row xls-row--even">
              <td className="xls-cell" style={{ padding: '8px 10px' }}>
                <SheetHeaderBar
                  title="실행 가이드"
                  subtitle="종목을 직접 고르지 않아도, 스캔/집행우선 데이터에서 수급·추세·유동성 중심의 자동 후보를 찾아 진입·청산 계획으로 변환합니다."
                  action={<EconomicEventBadge />}
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <section className="execution-guide-page" style={{ display: 'grid', gap: 'var(--space-3)' }}>

      <div className="card" style={{ padding: 'var(--space-3)' }}>
        <div className="flex-between" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <div>
            <div className="title-md">자동 후보 찾기</div>
            <div className="caption">눌림목/집행우선 데이터를 합쳐 퀵점수·적응점수·리드단계·수급액(5D/20D)·거래대금 중심으로 우선순위를 제시합니다.</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button
              variant={candidateMode === 'balanced' ? 'primary' : 'secondary'}
              onClick={() => setCandidateMode('balanced')}
              disabled={autoLoading}
            >
              밸런스 모드
            </Button>
            <Button
              variant={candidateMode === 'multibagger' ? 'primary' : 'secondary'}
              onClick={() => setCandidateMode('multibagger')}
              disabled={autoLoading}
            >
              멀티배거 모드
            </Button>
            <Button
              variant={candidateMode === 'swing' ? 'primary' : 'secondary'}
              onClick={() => setCandidateMode('swing')}
              disabled={autoLoading}
            >
              스윙 모드
            </Button>
            <Button
              variant={scoreVersion === 'v2' ? 'primary' : 'secondary'}
              onClick={() => setScoreVersion('v2')}
              disabled={autoLoading}
            >
              점수 v2
            </Button>
            <Button
              variant={scoreVersion === 'legacy' ? 'primary' : 'secondary'}
              onClick={() => setScoreVersion('legacy')}
              disabled={autoLoading}
            >
              점수 legacy
            </Button>
            <Button variant="secondary" onClick={loadAutoCandidates} disabled={autoLoading}>
              {autoLoading ? '후보 탐색 중…' : '자동 후보 찾기'}
            </Button>
            <Button variant="secondary" onClick={useAutoCandidatesAsCodes} disabled={autoCandidates.length === 0}>
              상위 후보 코드 반영
            </Button>
            <Button size="sm" onClick={buildGuide} disabled={loading || codeList.length === 0}>
              {loading ? '생성 중…' : '가이드 생성'}
            </Button>
            <Button size="sm" variant="secondary" onClick={openExecutionGuideShare} disabled={shareManager.creating || rows.length === 0}>
              {shareManager.creating ? '공유 준비 중…' : '공유'}
            </Button>
            <Button size="sm" variant="secondary" onClick={downloadExecutionGuidePdf} disabled={pdfLoading || rows.length === 0}>
              {pdfLoading ? 'PDF 생성 중…' : '리포트 PDF'}
            </Button>
            <Button size="sm" variant="secondary" onClick={openExecutionGuideShareManager}>
              공유 관리
            </Button>
          </div>
        </div>

        <div className="caption" style={{ marginTop: 8 }}>
          자동 후보 모드: {candidateMode === 'multibagger' ? '멀티배거(수급 20D·리드·상승여력 강화)' : candidateMode === 'swing' ? '스윙(눌림·추세·안전성·20D수급 우선 / 당일급등 제외)' : '밸런스(단기 집행 안정성 중심)'}
          {' · '}점수 버전: {scoreVersion === 'v2' ? 'v2(상승잠재-리스크 분리)' : 'legacy(기존 가중합)'}
          {' · '}스냅샷: {snapshotReady ? '준비됨' : '미준비'}
          {lastSnapshotAt ? ` · 최근 저장 ${new Date(lastSnapshotAt).toLocaleString('ko-KR')}` : ''}
        </div>

        {autoError && <div className="caption" style={{ color: 'var(--color-error)', marginTop: 8 }}>{autoError}</div>}

        {visibleAutoCandidates.length > 0 && (
          <div style={{ marginTop: 'var(--space-2)', display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            {visibleAutoCandidates.map((row) => (
              <button
                key={`${row.code}-${row.source}`}
                type="button"
                onClick={() => {
                  const next = new Set(parseCodes(codesText))
                  next.add(row.code)
                  setCodesText([...next].join(', '))
                  setSourceLabel(autoSourceLabelByMode(candidateMode))
                }}
                style={{
                  border: '1px solid var(--color-border-default)',
                  background: 'var(--color-bg-surface)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '8px 10px',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontWeight: 700 }}>{row.name} ({row.code})</div>
                  <span className="scan-grade-badge scan-grade-a" style={{ fontSize: 11 }}>
                    {formatNumber(getCandidateScoreByVersion(row, scoreVersion), 1)}
                  </span>
                </div>
                <div className="caption" style={{ marginTop: 4 }}>
                  상승잠재 {row.upsideSignal != null ? formatNumber(row.upsideSignal, 1) : '—'} · 리스크 {row.riskSignal != null ? formatNumber(row.riskSignal, 1) : '—'}
                </div>
                <div className="caption" style={{ marginTop: 2 }}>
                  v2 {formatNumber(row.score, 1)} / legacy {formatNumber(row.scoreLegacy, 1)}
                </div>
                <div className="caption" style={{ marginTop: 4, color: row.netFlow5d != null && row.netFlow5d < 0 ? 'var(--color-error)' : 'var(--color-text-secondary)' }}>
                  {formatFlowBadgeLabel(row.netFlow5d, row.netFlow20d)}
                </div>
                <div className="caption" style={{ marginTop: 4 }}>[{row.source === 'highlights' ? '집행우선' : '눌림목'}] {row.reason}</div>
              </button>
            ))}
          </div>
        )}

        <div className="execution-guide-form-block" style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <Input
            label="종목 코드(쉼표/공백 구분)"
            textarea
            value={codesText}
            onChange={(e) => setCodesText(e.target.value)}
            placeholder="005930, 000660, 272210"
          />

          <div className="execution-guide-form-grid" style={{ display: 'grid', gap: 'var(--space-2)', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            <Input label="총 투자금" value={capital} onChange={(e) => setCapital(e.target.value)} />
            <Input label="종목당 최대 비중(%)" value={maxWeightPct} onChange={(e) => setMaxWeightPct(e.target.value)} />
            <Input label="분할 횟수(권장 3~5)" value={splitCount} onChange={(e) => setSplitCount(e.target.value)} />
            <div className="ui-field">
              <label className="ui-label">리스크 모드</label>
              <select className="ui-input ui-text" value={riskMode} onChange={(e) => setRiskMode(e.target.value as RiskMode)}>
                <option value="conservative">보수</option>
                <option value="neutral">중립</option>
                <option value="aggressive">공격</option>
              </select>
            </div>
            <Input label="추천 출처" value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} />
            <div className="ui-field" style={{ display: 'flex', alignItems: 'flex-end' }}>
              <Button onClick={buildGuide} disabled={loading} style={{ width: '100%', minHeight: 38 }}>
                {loading ? '가이드 생성 중…' : '가이드 생성'}
              </Button>
            </div>
          </div>
        </div>

        <div className="execution-guide-meta-row" style={{ marginTop: 'var(--space-3)', display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={includeNews} onChange={(e) => setIncludeNews(e.target.checked)} />
            뉴스 상위 3건 요약 포함
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={compactView} onChange={(e) => setCompactView(e.target.checked)} />
            핵심만 보기
          </label>
          <span className="caption">코드 {codeList.length}개</span>
          {generatedAt && <span className="caption">생성시각 {new Date(generatedAt).toLocaleString('ko-KR')}</span>}
        </div>

        {codeList.length > 0 && (
          <div className="execution-guide-code-chip-row" style={{ marginTop: 'var(--space-2)', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {codeList.slice(0, 12).map((code) => (
              <span key={code} className="scan-grade-badge scan-grade-b" style={{ fontSize: 11 }}>
                {code}
              </span>
            ))}
            {codeList.length > 12 && <span className="caption">외 {codeList.length - 12}개</span>}
          </div>
        )}
      </div>

      {error && <div className="card" style={{ color: 'var(--color-error)' }}>{error}</div>}

      <div className="card" style={{ padding: 0 }}>
        <div className="xls-scroll-frame execution-guide-table-wrap" style={{ ['--xls-table-min-width' as any]: '980px' }}>
          <table className="xls-table execution-guide-table" style={{ width: 'max-content', minWidth: '100%', tableLayout: 'auto' }}>
          <colgroup>
            <col style={{ width: compactView ? '25%' : '24%' }} />
            <col style={{ width: compactView ? '26%' : '28%' }} />
            <col style={{ width: compactView ? '19%' : '20%' }} />
            <col style={{ width: compactView ? '30%' : '28%' }} />
          </colgroup>
          <thead>
            <tr className="xls-header-row">
              <th className="xls-th">종목</th>
              <th className="xls-th">진입/손절/목표</th>
              <th className="xls-th">수량/주문</th>
              <th className="xls-th">가이드</th>
            </tr>
          </thead>
            <tbody>
              {loading && (
              <tr className="xls-row">
                <td colSpan={4} className="xls-cell" style={{ color: 'var(--color-text-secondary)' }}>
                  종목 분석과 뉴스를 조합해 실행 가이드를 생성 중입니다.
                </td>
              </tr>
              )}
              {!loading && rows.map((row, idx) => (
              <tr key={row.code} className={`xls-row${idx % 2 ? ' xls-row--even' : ''}`}>
                <td className="xls-cell" style={{ verticalAlign: 'top' }}>
                  <div className="execution-guide-stock-title">{row.name} ({row.code})</div>
                  <div className="execution-guide-kv-line">
                    <span className="execution-guide-kv-label">데이터일자</span>
                    <span className="execution-guide-kv-value">{formatRowDataAsOf(row.marketDataDate, row.newsDataDate)}</span>
                  </div>
                  <div className="execution-guide-kv-line">
                    <span className="execution-guide-kv-label">점수/판정</span>
                    <span className="execution-guide-kv-value">{row.score != null ? formatNumber(row.score, 1) : '—'} / {row.statusLabel || '—'}</span>
                  </div>
                  {row.summary && <div className="execution-guide-summary">{row.summary}</div>}
                </td>
                <td className="xls-cell" style={{ verticalAlign: 'top' }}>
                  <div className="execution-guide-kv-line">
                    <span className="execution-guide-kv-label">진입</span>
                    <span className="execution-guide-kv-value">{row.entryLow != null && row.entryHigh != null ? `${formatKrw(row.entryLow)} ~ ${formatKrw(row.entryHigh)}` : '—'}</span>
                  </div>
                  <div className="execution-guide-kv-line">
                    <span className="execution-guide-kv-label">기준가</span>
                    <span className="execution-guide-kv-value">{row.entryRef != null ? formatKrw(row.entryRef) : '—'}</span>
                  </div>
                  <div className="execution-guide-kv-line">
                    <span className="execution-guide-kv-label">손절</span>
                    <span className="execution-guide-kv-value">{row.stopPrice != null ? formatKrw(row.stopPrice) : '—'}</span>
                  </div>
                  <div className="execution-guide-kv-line">
                    <span className="execution-guide-kv-label">목표1</span>
                    <span className="execution-guide-kv-value">{row.target1 != null ? formatKrw(row.target1) : '—'}{row.target1Pct != null ? ` (${formatNumber(row.target1Pct * 100, 1)}%)` : ''}</span>
                  </div>
                  {!compactView && (
                    <div className="execution-guide-kv-line">
                      <span className="execution-guide-kv-label">목표2</span>
                      <span className="execution-guide-kv-value">{row.target2 != null ? formatKrw(row.target2) : '—'}{row.target2Pct != null ? ` (${formatNumber(row.target2Pct * 100, 1)}%)` : ''}</span>
                    </div>
                  )}
                </td>
                <td className="xls-cell" style={{ verticalAlign: 'top' }}>
                  <div className="execution-guide-kv-line">
                    <span className="execution-guide-kv-label">예산</span>
                    <span className="execution-guide-kv-value">{formatKrw(row.plannedBudget)}</span>
                  </div>
                  <div className="execution-guide-kv-line">
                    <span className="execution-guide-kv-label">권장 수량</span>
                    <span className="execution-guide-kv-value">{row.qty.toLocaleString()}주</span>
                  </div>
                  {!compactView && (
                    <>
                      <div className="execution-guide-kv-line">
                        <span className="execution-guide-kv-label">1회 주문</span>
                        <span className="execution-guide-kv-value">{formatKrw(row.firstOrderAmount)}</span>
                      </div>
                      <div className="execution-guide-kv-line">
                        <span className="execution-guide-kv-label">손익비</span>
                        <span className="execution-guide-kv-value">{row.riskReward != null ? row.riskReward.toFixed(1) : '—'}</span>
                      </div>
                      <div className="execution-guide-kv-line">
                        <span className="execution-guide-kv-label">보유</span>
                        <span className="execution-guide-kv-value">{row.holdDays ? `${row.holdDays[0]}~${row.holdDays[1]}일` : '—'}</span>
                      </div>
                    </>
                  )}
                </td>
                <td className="xls-cell" style={{ verticalAlign: 'top' }}>
                  {row.warnings.length > 0 && (
                    <div className="execution-guide-warning">{row.warnings.join(' / ')}</div>
                  )}
                  {(compactView ? row.headlines.slice(0, 1) : row.headlines).length > 0 ? (
                    <ul className="execution-guide-headline-list">
                      {(compactView ? row.headlines.slice(0, 1) : row.headlines).map((headline, hIdx) => (
                        <li key={`${row.code}-h-${hIdx}`} className="caption execution-guide-headline-item">{headline}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="caption">뉴스 요약 없음</div>
                  )}
                  {compactView && row.headlines.length > 1 && (
                    <div className="caption" style={{ marginTop: 4 }}>외 {row.headlines.length - 1}건</div>
                  )}
                </td>
              </tr>
              ))}
              {!loading && rows.length === 0 && (
              <tr className="xls-row">
                <td colSpan={4} className="xls-cell" style={{ color: 'var(--color-text-tertiary)' }}>
                  종목 코드를 입력한 뒤 가이드 생성을 눌러 주세요.
                </td>
              </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div>총 계획 금액: {formatKrw(totalPlanned)}</div>
        <div>잔여 현금: {formatKrw(Math.max(0, totalCapital - totalPlanned))}</div>
        <div>출처: {sourceLabel}</div>
      </div>

      <ShareModal
        open={shareManager.open}
        onClose={shareManager.close}
        url={shareManager.info?.url}
        code={shareManager.info?.code}
        requiresCode={shareManager.requiresCode}
        expiresAt={shareManager.info?.expiresAt}
        shares={shareManager.list}
        loading={shareManager.loading}
        onRefresh={() => { void shareManager.loadList('실행가이드') }}
        includeAll={shareManager.includeAll}
        onChangeIncludeAll={shareManager.setIncludeAll}
        onRevoke={shareManager.revokeShare}
        onRevokeAll={shareManager.revokeAllShares}
        revokingId={shareManager.revokingId}
        revokingAll={shareManager.revokingAll}
      />
      </section>
    </section>
  )
}
