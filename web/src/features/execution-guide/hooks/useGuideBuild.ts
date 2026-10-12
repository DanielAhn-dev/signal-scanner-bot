import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../../lib/api'
import { getCandidateScoreByVersion } from '../lib/candidateRank'
import { autoSourceLabelByMode } from '../lib/codes'
import { buildGuideRow } from '../lib/guideRow'
import { toExecutionGuideSnapshotText } from '../lib/snapshotText'
import type { AutoCandidate, CandidateMode, GuideRow, RiskMode, ScoreVersion } from '../types'

/** 가이드 생성: 종목별 조회 → 행 만들기 → 스냅샷 저장. 이어받은 종목이면 한 번 자동 생성한다. */
export function useGuideBuild(input: {
  chatId: string
  codeList: string[]
  setCodesText: React.Dispatch<React.SetStateAction<string>>
  capital: string
  maxWeightPct: string
  splitCount: string
  riskMode: RiskMode
  includeNews: boolean
  sourceLabel: string
  setSourceLabel: React.Dispatch<React.SetStateAction<string>>
  hydratedByPending: boolean
  setHydratedByPending: React.Dispatch<React.SetStateAction<boolean>>
  autoCandidates: AutoCandidate[]
  setAutoCandidates: React.Dispatch<React.SetStateAction<AutoCandidate[]>>
  visibleAutoCandidates: AutoCandidate[]
  fetchAutoCandidates: () => Promise<AutoCandidate[]>
  candidateMode: CandidateMode
  scoreVersion: ScoreVersion
  setError: React.Dispatch<React.SetStateAction<string | null>>
}) {
  const {
    chatId, codeList, setCodesText, capital, maxWeightPct, splitCount, riskMode, includeNews, sourceLabel, setSourceLabel,
    hydratedByPending, setHydratedByPending, autoCandidates, setAutoCandidates, visibleAutoCandidates, fetchAutoCandidates,
    candidateMode, scoreVersion, setError,
  } = input
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<GuideRow[]>([])
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [snapshotReady, setSnapshotReady] = useState(false)
  const [lastSnapshotAt, setLastSnapshotAt] = useState<string | null>(null)

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

  useEffect(() => {
    if (!hydratedByPending) return
    if (loading) return
    if (rows.length > 0) return
    if (codeList.length === 0) return
    void buildGuide()
    setHydratedByPending(false)
  }, [hydratedByPending, loading, rows.length, codeList.length])

  return {
    loading, rows, generatedAt, setGeneratedAt, snapshotReady, setSnapshotReady, lastSnapshotAt, setLastSnapshotAt,
    persistGuideSnapshot, buildGuide, totalPlanned,
  }
}
