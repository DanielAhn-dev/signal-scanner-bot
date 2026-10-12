import { useState } from 'react'
import { useShareManager } from '../../../hooks/useShareManager'
import { buildUiRequest } from '../lib/request'
import type { GuideRow } from '../types'

/** 공유 링크 만들기·관리와 리포트 PDF 다운로드. 스냅샷이 없으면 먼저 저장한다. */
export function useGuideShare(input: {
  chatId: string
  toast: { show: (message: string) => void }
  rows: GuideRow[]
  codeList: string[]
  generatedAt: string | null
  setGeneratedAt: React.Dispatch<React.SetStateAction<string | null>>
  snapshotReady: boolean
  setSnapshotReady: React.Dispatch<React.SetStateAction<boolean>>
  setLastSnapshotAt: React.Dispatch<React.SetStateAction<string | null>>
  persistGuideSnapshot: (payload: { generatedAtIso: string; rows: GuideRow[]; codeList: string[]; sourceLabel?: string }) => Promise<boolean>
  setError: React.Dispatch<React.SetStateAction<string | null>>
}) {
  const { chatId, toast, rows, codeList, generatedAt, setGeneratedAt, snapshotReady, setSnapshotReady, setLastSnapshotAt, persistGuideSnapshot, setError } = input
  const [pdfLoading, setPdfLoading] = useState(false)
  const shareManager = useShareManager({
    endpoint: '/api/ui/report-share',
    scopeKey: 'topic',
    requiresCode: true,
  })

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

  return { shareManager, pdfLoading, openExecutionGuideShare, openExecutionGuideShareManager, downloadExecutionGuidePdf }
}
