import { useSeedCapital } from '../../lib/useSeedCapital'
import { readSimulationPlan } from '../simulator/planStore'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../../lib/api'
import SheetHeaderBar from '../../components/SheetHeaderBar'
import EconomicEventBadge from '../../components/EconomicEventBadge'
import { useDetailed } from '../../stores/viewModeStore'
import { useToast } from '../../components/ToastProvider'
import { useShareManager } from '../../hooks/useShareManager'
import { useCurrentChatId } from '../../stores/profileStore'
import GuideInputCard from './components/GuideInputCard'
import AutoFinderCard from './components/AutoFinderCard'
import GuideTable from './components/GuideTable'
import GuideActions from './components/GuideActions'
import { EXECUTION_GUIDE_PENDING_KEY } from './constants'
import { getCandidateScoreByVersion, rankHighlightCandidate, rankScanCandidate } from './lib/candidateRank'
import { pickDiversifiedCandidates } from './lib/diversify'
import { buildGuideRow } from './lib/guideRow'
import { buildUiRequest } from './lib/request'
import { toExecutionGuideSnapshotText } from './lib/snapshotText'
import type { AutoCandidate, CandidateMode, GuideRow, RiskMode, ScoreVersion } from './types'
import { autoSourceLabelByMode, normalizeSourceLabel, parseCodes } from './lib/codes'

export default function ExecutionGuidePage() {
  const chatId = useCurrentChatId()
  const toast = useToast()
  const [codesText, setCodesText] = useState('')
  // 투자금: 시뮬레이터 계획 → 내 시드 순으로 채운다 (예전엔 1천만원 고정). 직접 입력하면 유지.
  const seedCapital = useSeedCapital()
  const [capital, setCapitalRaw] = useState('10000000')
  const capitalEditedRef = useRef(false)
  const setCapital = (v: string) => {
    capitalEditedRef.current = true
    setCapitalRaw(v)
  }
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
  const [compactViewChoice, setCompactView] = useState(false)
  const detailed = useDetailed()
  // 간단히 보기에서는 핵심(진입·손절·목표·수량)만 보인다
  const compactView = compactViewChoice || !detailed
  const [showAutoFinder, setShowAutoFinder] = useState(false)
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

      const request = await buildUiRequest('/api/ui/report-pdf?topic=실행가이드', chatId)
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
      toast.show('실행가이드 PDF 다운로드 완료')
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
      } else if (!urlCodes) {
        // 5단계 시뮬레이터에서 "다음"으로 오면 넘겨받은 종목이 없어 빈 화면이었다 — 최근 시뮬레이터 계획을 이어받는다
        const plan = readSimulationPlan()
        const planCodes = (plan?.items ?? []).map((row) => String(row.code || '')).filter((code) => code && code !== 'CASH')
        if (planCodes.length > 0) {
          setCodesText(parseCodes(planCodes.join(',')).join(', '))
          setSourceLabel('시뮬레이터 계획')
          setHydratedByPending(true)
        }
        if (plan && plan.totalCapital > 0 && !capitalEditedRef.current) setCapitalRaw(String(plan.totalCapital))
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    // 시뮬레이터 계획의 투자금이 없을 때만 시드로
    if (seedCapital && !capitalEditedRef.current && !(readSimulationPlan()?.totalCapital ?? 0)) setCapitalRaw(String(seedCapital))
  }, [seedCapital])

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

          let newsRes: any = null
          if (includeNews) {
            newsRes = await apiFetch(`/api/ui/news?q=${encodeURIComponent(code)}&page=1&pageSize=3`, {
              cacheMs: 30_000,
              timeoutMs: 10_000,
            }).catch(() => null)
          }

          return buildGuideRow({ code, stockRes, newsRes, includeNews, riskMode, budgetPerName, slots })
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

      <GuideInputCard
        codesText={codesText}
        setCodesText={setCodesText}
        capital={capital}
        setCapital={setCapital}
        maxWeightPct={maxWeightPct}
        setMaxWeightPct={setMaxWeightPct}
        splitCount={splitCount}
        setSplitCount={setSplitCount}
        riskMode={riskMode}
        setRiskMode={setRiskMode}
        sourceLabel={sourceLabel}
        setSourceLabel={setSourceLabel}
        includeNews={includeNews}
        setIncludeNews={setIncludeNews}
        loading={loading}
        generatedAt={generatedAt}
        compactViewChoice={compactViewChoice}
        setCompactView={setCompactView}
        codeList={codeList}
        buildGuide={buildGuide}
      />

      <AutoFinderCard
        codesText={codesText}
        setCodesText={setCodesText}
        setSourceLabel={setSourceLabel}
        autoCandidates={autoCandidates}
        autoLoading={autoLoading}
        autoError={autoError}
        candidateMode={candidateMode}
        setCandidateMode={setCandidateMode}
        scoreVersion={scoreVersion}
        setScoreVersion={setScoreVersion}
        showAutoFinder={showAutoFinder}
        setShowAutoFinder={setShowAutoFinder}
        visibleAutoCandidates={visibleAutoCandidates}
        loadAutoCandidates={loadAutoCandidates}
        useAutoCandidatesAsCodes={useAutoCandidatesAsCodes}
      />

      {error && <div className="card" style={{ color: 'var(--color-error)' }}>{error}</div>}

      <GuideTable
        loading={loading}
        rows={rows}
        compactView={compactView}
      />

      <GuideActions
        sourceLabel={sourceLabel}
        rows={rows}
        snapshotReady={snapshotReady}
        lastSnapshotAt={lastSnapshotAt}
        pdfLoading={pdfLoading}
        shareManager={shareManager}
        openExecutionGuideShare={openExecutionGuideShare}
        openExecutionGuideShareManager={openExecutionGuideShareManager}
        downloadExecutionGuidePdf={downloadExecutionGuidePdf}
        totalPlanned={totalPlanned}
        totalCapital={totalCapital}
      />
      </section>
    </section>
  )
}
