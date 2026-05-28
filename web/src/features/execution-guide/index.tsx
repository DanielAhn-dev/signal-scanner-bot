import React, { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { formatKrw, formatNumber } from '../../lib/format'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import SheetHeaderBar from '../../components/SheetHeaderBar'
import EconomicEventBadge from '../../components/EconomicEventBadge'
import ShareModal from '../../components/ShareModal'
import { useShareManager } from '../../hooks/useShareManager'
import { useCurrentChatId } from '../../stores/profileStore'

const EXECUTION_GUIDE_PENDING_KEY = 'execution_guide_pending_v1'

type RiskMode = 'conservative' | 'neutral' | 'aggressive'

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
  confidencePct: number | null
  liquidity: number | null
  intradayChangePct: number | null
  reason: string
}

function toExecutionGuideSnapshotText(input: {
  generatedAtIso: string
  sourceLabel: string
  codeList: string[]
  capital: string
  maxWeightPct: string
  splitCount: string
  riskMode: RiskMode
  includeNews: boolean
  autoCandidates: AutoCandidate[]
  rows: GuideRow[]
}): string {
  const lines: string[] = []
  const generatedAtText = new Date(input.generatedAtIso).toLocaleString('ko-KR')
  lines.push('<b>실행 가이드 리포트</b>')
  lines.push(`생성시각: ${generatedAtText}`)
  lines.push(`출처: ${input.sourceLabel}`)
  lines.push(`코드 ${input.codeList.length}개: ${input.codeList.join(', ') || '-'}`)
  lines.push('')
  lines.push('<b>설정</b>')
  lines.push(`• 총 투자금: ${formatKrw(Math.max(0, Number(input.capital || 0)))}`)
  lines.push(`• 종목당 최대 비중: ${Math.max(1, Math.min(100, Number(input.maxWeightPct || 25)))}%`)
  lines.push(`• 분할 횟수: ${Math.max(1, Number(input.splitCount || 2))}`)
  lines.push(`• 리스크 모드: ${input.riskMode}`)
  lines.push(`• 뉴스 요약 포함: ${input.includeNews ? '예' : '아니오'}`)

  if (input.autoCandidates.length > 0) {
    lines.push('')
    lines.push('<b>자동 추천 후보 TOP</b>')
    for (const item of input.autoCandidates.slice(0, 8)) {
      lines.push(`• ${item.name}(${item.code}) [${item.source === 'highlights' ? '집행우선' : '눌림목'}] 점수 ${formatNumber(item.score, 1)} · ${item.reason}`)
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
      lines.push(`  - 손절: ${row.stopPrice != null ? formatKrw(row.stopPrice) : '—'}`)
      lines.push(`  - 목표1/목표2: ${row.target1 != null ? formatKrw(row.target1) : '—'} / ${row.target2 != null ? formatKrw(row.target2) : '—'}`)
      lines.push(`  - 예산/수량: ${formatKrw(row.plannedBudget)} / ${row.qty.toLocaleString()}주`)
      if (row.warnings.length > 0) lines.push(`  - 주의: ${row.warnings.join(' / ')}`)
      if (row.headlines.length > 0) {
        for (const headline of row.headlines.slice(0, 3)) {
          lines.push(`    · ${headline}`)
        }
      }
    }
  }
  return lines.join('\n')
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

function getThemeBoost(name?: string | null, sector?: string | null): { score: number; labels: string[] } {
  const text = `${name || ''} ${sector || ''}`.toLowerCase()
  const tags: Array<{ score: number; label: string; tokens: string[] }> = [
    { score: 12, label: 'LG그룹/전장', tokens: ['lg', '엘지', '전장'] },
    { score: 14, label: '반도체/소부장', tokens: ['반도체', 'semiconductor', '소부장', 'hbm', '메모리'] },
    { score: 12, label: '로봇/자동화', tokens: ['로봇', 'robot', '자동화'] },
    { score: 10, label: '현대차그룹', tokens: ['현대차', '현대모비스', '오토에버', 'hl만도', '기아'] },
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

function rankScanCandidate(item: any): AutoCandidate {
  const entryPct = normalizeScoreFrom5(item?.entry_score)
  const trendPct = normalizeScoreFrom5(item?.trend_score)
  const warnPct = normalizeScoreFrom5(item?.warn_score)
  const liquidity = Number(item?.liquidity ?? 0)
  const liquidityPct =
    liquidity >= 100_000_000_000 ? 100 :
    liquidity >= 30_000_000_000 ? 85 :
    liquidity >= 10_000_000_000 ? 70 :
    liquidity >= 3_000_000_000 ? 55 :
    liquidity >= 1_000_000_000 ? 40 : 20
  const intraday = Number(item?.intraday_change_pct ?? 0)
  const intradayFit = clampValue(100 - Math.abs(intraday - 2.0) * 16, 0, 100)
  const baseScore = entryPct * 0.34 + trendPct * 0.18 + (100 - warnPct) * 0.2 + liquidityPct * 0.2 + intradayFit * 0.08

  const theme = getThemeBoost(item?.name, item?.sector_id)
  const finalScore = clampValue(baseScore + theme.score, 0, 100)
  const reasons = [
    `거래대금 ${formatKrw(liquidity)}`,
    `당일변동 ${Number.isFinite(intraday) ? `${formatNumber(intraday, 2)}%` : '—'}`,
  ]
  if (theme.labels.length > 0) reasons.push(`테마 ${theme.labels.join(', ')}`)

  return {
    code: String(item?.code || ''),
    name: String(item?.name || item?.code || ''),
    source: 'scan',
    sector: item?.sector_id ? String(item.sector_id) : null,
    score: finalScore,
    confidencePct: null,
    liquidity: Number.isFinite(liquidity) ? liquidity : null,
    intradayChangePct: Number.isFinite(intraday) ? intraday : null,
    reason: reasons.join(' · '),
  }
}

function rankHighlightCandidate(item: any): AutoCandidate {
  const confidence = Number(item?.confidence_pct ?? 0)
  const baseScore = clampValue(Number.isFinite(confidence) ? confidence : 0, 0, 100)
  const theme = getThemeBoost(item?.name, item?.sector_id)
  const finalScore = clampValue(baseScore + theme.score * 0.6, 0, 100)

  const reasons = [
    `전략 ${String(item?.strategy_label || '집행우선')}`,
    `신뢰도 ${Number.isFinite(confidence) ? `${formatNumber(confidence, 1)}%` : '—'}`,
  ]
  if (theme.labels.length > 0) reasons.push(`테마 ${theme.labels.join(', ')}`)

  return {
    code: String(item?.code || ''),
    name: String(item?.name || item?.code || ''),
    source: 'highlights',
    sector: item?.sector_id ? String(item.sector_id) : null,
    score: finalScore,
    confidencePct: Number.isFinite(confidence) ? confidence : null,
    liquidity: null,
    intradayChangePct: null,
    reason: reasons.join(' · '),
  }
}

export default function ExecutionGuidePage() {
  const chatId = useCurrentChatId()
  const [codesText, setCodesText] = useState('')
  const [capital, setCapital] = useState('10000000')
  const [maxWeightPct, setMaxWeightPct] = useState('25')
  const [splitCount, setSplitCount] = useState('2')
  const [riskMode, setRiskMode] = useState<RiskMode>('neutral')
  const [sourceLabel, setSourceLabel] = useState('manual')
  const [includeNews, setIncludeNews] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<GuideRow[]>([])
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [hydratedByPending, setHydratedByPending] = useState(false)
  const [autoCandidates, setAutoCandidates] = useState<AutoCandidate[]>([])
  const [autoLoading, setAutoLoading] = useState(false)
  const [autoError, setAutoError] = useState<string | null>(null)
  const [compactView, setCompactView] = useState(false)
  const [snapshotReady, setSnapshotReady] = useState(false)
  const shareManager = useShareManager({
    endpoint: '/api/ui/report-share',
    scopeKey: 'topic',
    requiresCode: true,
  })

  const persistGuideSnapshot = async (payload: { generatedAtIso: string; rows: GuideRow[] }): Promise<boolean> => {
    if (payload.rows.length === 0) return false
    const bodyText = toExecutionGuideSnapshotText({
      generatedAtIso: payload.generatedAtIso,
      sourceLabel,
      codeList,
      capital,
      maxWeightPct,
      splitCount,
      riskMode,
      includeNews,
      autoCandidates,
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
    if (!snapshotReady) return
    await shareManager.createShare('실행가이드', { topic: '실행가이드' })
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
      if (urlSource) setSourceLabel(urlSource)

      const pendingRaw = sessionStorage.getItem(EXECUTION_GUIDE_PENDING_KEY)
      if (pendingRaw) {
        const parsed = JSON.parse(pendingRaw) as { codes?: string[]; source?: string }
        if (Array.isArray(parsed?.codes) && parsed.codes.length > 0) {
          setCodesText(parseCodes(parsed.codes.join(',')).join(', '))
          setHydratedByPending(true)
        }
        if (parsed?.source) setSourceLabel(String(parsed.source))
        sessionStorage.removeItem(EXECUTION_GUIDE_PENDING_KEY)
      }
    } catch {
      // ignore
    }
  }, [])

  const codeList = useMemo(() => parseCodes(codesText), [codesText])

  const buildGuide = async () => {
    if (codeList.length === 0) {
      setError('종목 코드를 1개 이상 입력해 주세요.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const totalCapital = Math.max(0, Number(capital || 0))
      const maxWeight = Math.max(1, Math.min(100, Number(maxWeightPct || 25)))
      const slots = Math.max(1, Number(splitCount || 2))
      const budgetPerName = Math.floor(Math.min(totalCapital / codeList.length, totalCapital * (maxWeight / 100)))

      const fetched = await Promise.all(
        codeList.map(async (code) => {
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
          if (includeNews) {
            const newsRes = await apiFetch(`/api/ui/news?q=${encodeURIComponent(code)}&page=1&pageSize=3`, {
              cacheMs: 30_000,
              timeoutMs: 10_000,
            }).catch(() => null)
            headlines = Array.isArray(newsRes?.data)
              ? newsRes.data.map((item: any) => String(item?.title || '')).filter(Boolean).slice(0, 3)
              : []
          }

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
            plannedBudget: budgetPerName,
            qty,
            firstOrderAmount,
          } satisfies GuideRow
        }),
      )

      setRows(fetched)
      const nextGeneratedAt = new Date().toISOString()
      setGeneratedAt(nextGeneratedAt)
      const saved = await persistGuideSnapshot({ generatedAtIso: nextGeneratedAt, rows: fetched })
      setSnapshotReady(saved)
    } catch (e: any) {
      setError(e?.message || String(e))
      setRows([])
      setSnapshotReady(false)
    } finally {
      setLoading(false)
    }
  }

  const totalPlanned = useMemo(() => rows.reduce((acc, row) => acc + (row.entryRef && row.qty > 0 ? row.entryRef * row.qty : 0), 0), [rows])
  const totalCapital = Math.max(0, Number(capital || 0))

  const loadAutoCandidates = async () => {
    setAutoLoading(true)
    setAutoError(null)
    try {
      const [highlightsRes, scanRes] = await Promise.all([
        apiFetch('/api/ui/scan-highlights', { cacheMs: 30_000, timeoutMs: 30_000 }).catch(() => null),
        apiFetch('/api/ui/scan-candidates?limit=120&cacheMs=0', { cacheMs: 0, timeoutMs: 30_000 }).catch(() => null),
      ])

      const highlightItems = Array.isArray(highlightsRes?.data) ? highlightsRes.data : []
      const scanItems = Array.isArray(scanRes?.data) ? scanRes.data : []
      const ranked = [
        ...highlightItems.map(rankHighlightCandidate),
        ...scanItems.map(rankScanCandidate),
      ].filter((item) => item.code)

      if (ranked.length === 0) {
        setAutoCandidates([])
        setAutoError('자동 후보를 찾지 못했습니다. 스캔 데이터 동기화 후 다시 시도해 주세요.')
        return
      }

      const merged = new Map<string, AutoCandidate>()
      for (const row of ranked) {
        const prev = merged.get(row.code)
        if (!prev || row.score > prev.score) {
          merged.set(row.code, row)
        }
      }

      const sorted = [...merged.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, 16)

      setAutoCandidates(sorted)
      if (codeList.length === 0 && sorted.length > 0) {
        setCodesText(sorted.slice(0, 6).map((row) => row.code).join(', '))
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
    const next = autoCandidates.slice(0, 8).map((row) => row.code).join(', ')
    setCodesText(next)
    setSourceLabel('auto-scan')
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
        <table className="xls-table" style={{ width: '100%', tableLayout: 'fixed' }}>
          <tbody>
            <tr className="xls-row xls-row--even">
              <td className="xls-cell" style={{ padding: '8px 10px' }}>
                <SheetHeaderBar
                  title="실행 가이드"
                  subtitle="종목을 직접 고르지 않아도, 스캔/집행우선 데이터에서 자동 후보를 찾아 진입·청산 계획으로 변환합니다."
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
            <div className="caption">눌림목/집행우선 데이터를 합쳐 거래대금·변동성·테마(반도체/소부장/로봇/현대차그룹/LG계열) 기반으로 우선순위를 제시합니다.</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={loadAutoCandidates} disabled={autoLoading}>
              {autoLoading ? '후보 탐색 중…' : '자동 후보 찾기'}
            </Button>
            <Button variant="secondary" onClick={useAutoCandidatesAsCodes} disabled={autoCandidates.length === 0}>
              상위 후보 코드 반영
            </Button>
            <Button size="sm" onClick={buildGuide} disabled={loading || codeList.length === 0}>
              {loading ? '생성 중…' : '가이드 생성'}
            </Button>
            {snapshotReady && (
              <Button size="sm" variant="secondary" onClick={openExecutionGuideShare} disabled={shareManager.creating}>
                {shareManager.creating ? '공유 준비 중…' : '공유'}
              </Button>
            )}
          </div>
        </div>

        {autoError && <div className="caption" style={{ color: 'var(--color-error)', marginTop: 8 }}>{autoError}</div>}

        {autoCandidates.length > 0 && (
          <div style={{ marginTop: 'var(--space-2)', display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            {autoCandidates.map((row) => (
              <button
                key={`${row.code}-${row.source}`}
                type="button"
                onClick={() => {
                  const next = new Set(parseCodes(codesText))
                  next.add(row.code)
                  setCodesText([...next].join(', '))
                  setSourceLabel('auto-scan')
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
                  <span className="scan-grade-badge scan-grade-a" style={{ fontSize: 11 }}>{formatNumber(row.score, 1)}</span>
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
            rows={3}
            placeholder="005930, 000660, 272210"
          />

          <div className="execution-guide-form-grid" style={{ display: 'grid', gap: 'var(--space-2)', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            <Input label="총 투자금" value={capital} onChange={(e) => setCapital(e.target.value)} />
            <Input label="종목당 최대 비중(%)" value={maxWeightPct} onChange={(e) => setMaxWeightPct(e.target.value)} />
            <Input label="분할 횟수" value={splitCount} onChange={(e) => setSplitCount(e.target.value)} />
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

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="xls-table execution-guide-table" style={{ width: '100%', tableLayout: 'fixed' }}>
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
        revokingId={shareManager.revokingId}
      />
      </section>
    </section>
  )
}
