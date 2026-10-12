import { useSeedCapital } from '../../lib/useSeedCapital'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { readSimulationPlan } from '../simulator/planStore'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { formatKrw, formatKstDateTime, formatNumber } from '../../lib/format'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import SheetHeaderBar from '../../components/SheetHeaderBar'
import EconomicEventBadge from '../../components/EconomicEventBadge'
import ShareModal from '../../components/ShareModal'
import Detail from '../../components/ui/Detail'
import { useDetailed } from '../../stores/viewModeStore'
import { useToast } from '../../components/ToastProvider'
import { useShareManager } from '../../hooks/useShareManager'
import { useCurrentChatId } from '../../stores/profileStore'
import { EXECUTION_GUIDE_PENDING_KEY } from './constants'
import { getCandidateScoreByVersion, rankHighlightCandidate, rankScanCandidate } from './lib/candidateRank'
import { formatFlowBadgeLabel, pickDiversifiedCandidates } from './lib/diversify'
import { buildGuideRow } from './lib/guideRow'
import { buildUiRequest } from './lib/request'
import { toExecutionGuideSnapshotText } from './lib/snapshotText'
import type { AutoCandidate, CandidateMode, GuideRow, RiskMode, ScoreVersion } from './types'
import { autoSourceLabelByMode, normalizeSourceLabel, parseCodes } from './lib/codes'
import { formatRowDataAsOf } from './lib/news'

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

      <div className="card" style={{ padding: 'var(--space-3)' }}>
        <div className="title-md">매매 계획 만들기</div>
        <div className="caption" style={{ marginTop: 4 }}>종목 코드를 입력하고 가이드 생성을 누르면 진입/손절/목표 계획이 만들어집니다.</div>

        <div className="execution-guide-form-block" style={{ marginTop: 'var(--space-3)', display: 'grid', gap: 'var(--space-3)' }}>
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
            <Detail><Input label="추천 출처" value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} /></Detail>
            <div className="ui-field" style={{ display: 'flex', alignItems: 'flex-end' }}>
              <Button onClick={buildGuide} disabled={loading || codeList.length === 0} style={{ width: '100%', minHeight: 38 }}>
                {loading ? '가이드 생성 중…' : '가이드 생성'}
              </Button>
            </div>
          </div>
        </div>

        <div className="execution-guide-meta-row" style={{ marginTop: 'var(--space-3)', display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
          <Detail>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={includeNews} onChange={(e) => setIncludeNews(e.target.checked)} />
              뉴스 상위 3건 요약 포함
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={compactViewChoice} onChange={(e) => setCompactView(e.target.checked)} />
              핵심만 보기
            </label>
          </Detail>
          <span className="caption">코드 {codeList.length}개</span>
          {generatedAt && <span className="caption">생성시각 {formatKstDateTime(generatedAt)}</span>}
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

      <Detail>
      <div>
        <Button variant="ghost" onClick={() => setShowAutoFinder((v) => !v)}>
          {showAutoFinder ? <>자동 후보 찾기 접기 <ChevronUp size={14} aria-hidden /></> : <>{`자동 후보 찾기 (고급)${autoCandidates.length > 0 ? ` · ${autoCandidates.length}건` : ''}`} <ChevronDown size={14} aria-hidden /></>}
        </Button>
      </div>

      {(showAutoFinder || autoCandidates.length > 0 || autoLoading) && (
      <div className="card" style={{ padding: 'var(--space-3)' }}>
        <div className="flex-between" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <div>
            <div className="title-md">자동 후보 찾기</div>
            <div className="caption">눌림목/집행우선 데이터를 합쳐 퀵점수·적응점수·리드단계·수급액(5D/20D)·거래대금 중심으로 우선순위를 제시합니다.</div>
          </div>
        </div>

        <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
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
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={loadAutoCandidates} disabled={autoLoading}>
              {autoLoading ? '후보 탐색 중…' : '자동 후보 찾기 실행'}
            </Button>
            <Button variant="secondary" onClick={useAutoCandidatesAsCodes} disabled={autoCandidates.length === 0}>
              상위 후보 코드 반영
            </Button>
          </div>
        </div>

        <div className="caption" style={{ marginTop: 8 }}>
          자동 후보 모드: {candidateMode === 'multibagger' ? '멀티배거(수급 20D·리드·상승여력 강화)' : candidateMode === 'swing' ? '스윙(눌림·추세·안전성·20D수급 우선 / 당일급등 제외)' : '밸런스(단기 집행 안정성 중심)'}
          {' · '}점수 버전: {scoreVersion === 'v2' ? 'v2(후보점수-리스크 분리)' : 'legacy(기존 가중합)'}
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
                  후보점수 {row.upsideSignal != null ? formatNumber(row.upsideSignal, 1) : '—'} · 리스크 {row.riskSignal != null ? formatNumber(row.riskSignal, 1) : '—'}
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
      </div>
      )}
      </Detail>

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

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <div>총 계획 금액: {formatKrw(totalPlanned)}</div>
          <div>잔여 현금: {formatKrw(Math.max(0, totalCapital - totalPlanned))}</div>
          <div>출처: {sourceLabel}</div>
        </div>
        <Detail><div className="caption muted">
          스냅샷: {snapshotReady ? '준비됨' : '미준비'}
          {lastSnapshotAt ? ` · 최근 저장 ${formatKstDateTime(lastSnapshotAt)}` : ''}
        </div></Detail>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
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
