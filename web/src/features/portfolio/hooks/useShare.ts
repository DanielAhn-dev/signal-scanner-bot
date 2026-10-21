import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch, invalidateCache } from '../../../lib/api'
import { useToast } from '../../../components/ToastProvider'
import type { PortfolioShareHistoryItem } from '../types'
import { pickLatestActiveShare } from '../lib/share'
import { confirmDialog } from '../../../components/ConfirmDialog'

/** scope: 공유할 계좌 — 실제 계좌와 가상(실험) 계좌는 한 장에 섞지 않는다 */
export function useShare(scope: 'real' | 'virtual' = 'real') {
  const toast = useToast()
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [sharedSummaryUrl, setSharedSummaryUrl] = useState('')
  const [shareExpiresAt, setShareExpiresAt] = useState('')
  const [shareTtlHours, setShareTtlHours] = useState<number>(48)
  const [shareCreating, setShareCreating] = useState(false)
  const [shareHistory, setShareHistory] = useState<PortfolioShareHistoryItem[]>([])
  const [shareHistoryLoading, setShareHistoryLoading] = useState(false)
  const [revokingShareId, setRevokingShareId] = useState('')
  const [deletingShareId, setDeletingShareId] = useState('')
  // 모달을 열 때 자동 생성은 한 번만. 실패하면 shareCreating이 바뀌며 효과가 다시 돌아
  // 공유 링크 생성 POST가 모달이 열려 있는 동안 반복됐다. 다시 만들기는 버튼으로 한다.
  const autoCreateTriedRef = useRef(false)

  const captureGeneratedAt = useMemo(
    () => new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date()),
    [shareModalOpen],
  )

  const createPublicShareUrl = useCallback(async () => {
    if (shareCreating) return
    setShareCreating(true)
    try {
      const json = await apiFetch('/api/ui/portfolio-share', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 12_000,
        body: JSON.stringify({ ttlHours: shareTtlHours, scope }),
      })
      const url = String(json?.url || '')
      if (!url) throw new Error('공유 URL 생성에 실패했습니다')
      setSharedSummaryUrl(url)
      setShareExpiresAt(String(json?.expiresAt || ''))
      toast.show('공유 URL이 생성되었습니다')
      invalidateCache('/api/ui/portfolio-share')
      const historyJson = await apiFetch('/api/ui/portfolio-share?all=1&limit=10', {
        cacheMs: 0,
        timeoutMs: 10_000,
      })
      setShareHistory(Array.isArray(historyJson?.data) ? historyJson.data : [])
    } catch (e: any) {
      toast.show(String(e?.message || e || '공유 URL 생성 실패'))
    } finally {
      setShareCreating(false)
    }
  }, [shareCreating, shareTtlHours, scope, toast])

  const loadShareHistory = useCallback(async (opts?: { silent?: boolean }) => {
    setShareHistoryLoading(true)
    try {
      const json = await apiFetch('/api/ui/portfolio-share?all=1&limit=10', {
        cacheMs: 0,
        timeoutMs: 10_000,
      })
      const list = Array.isArray(json?.data) ? json.data : []
      setShareHistory(list)
      return list as PortfolioShareHistoryItem[]
    } catch (e: any) {
      if (!opts?.silent) toast.show(String(e?.message || e || '공유 이력 조회 실패'))
      return [] as PortfolioShareHistoryItem[]
    } finally {
      setShareHistoryLoading(false)
    }
  }, [toast])

  const revokeShare = useCallback(async (shareId: string) => {
    if (!shareId || revokingShareId) return
    setRevokingShareId(shareId)
    try {
      const json = await apiFetch('/api/ui/portfolio-share', {
        method: 'DELETE',
        cacheMs: 0,
        timeoutMs: 10_000,
        body: JSON.stringify({ shareId }),
      })
      if (json?.error) throw new Error(String(json.error))
      toast.show('공유 링크를 철회했습니다')
      if (sharedSummaryUrl) {
        const target = shareHistory.find((item) => item.shareId === shareId)
        if (target?.url === sharedSummaryUrl) {
          setSharedSummaryUrl('')
          setShareExpiresAt('')
        }
      }
      const updated = await loadShareHistory()
      const active = pickLatestActiveShare(updated)
      if (active?.url) {
        setSharedSummaryUrl(active.url)
        setShareExpiresAt(String(active.expiresAt || ''))
      } else {
        setSharedSummaryUrl('')
        setShareExpiresAt('')
      }
    } catch (e: any) {
      toast.show(String(e?.message || e || '공유 링크 철회 실패'))
    } finally {
      setRevokingShareId('')
    }
  }, [revokingShareId, toast, sharedSummaryUrl, shareHistory, loadShareHistory])

  const deleteShare = useCallback(async (shareId: string) => {
    if (!shareId || deletingShareId) return
    const ok = await confirmDialog({ message: '이 공유 기록을 목록에서 삭제할까요? 삭제 후 복구할 수 없습니다.', confirmLabel: '삭제', danger: true })
    if (!ok) return

    setDeletingShareId(shareId)
    try {
      const json = await apiFetch('/api/ui/portfolio-share', {
        method: 'DELETE',
        cacheMs: 0,
        timeoutMs: 10_000,
        body: JSON.stringify({ shareId, hard: true }),
      })
      if (json?.error) throw new Error(String(json.error))

      toast.show('공유 기록을 삭제했습니다')
      const updated = await loadShareHistory()
      const active = pickLatestActiveShare(updated)
      if (active?.url) {
        setSharedSummaryUrl(active.url)
        setShareExpiresAt(String(active.expiresAt || ''))
      } else {
        setSharedSummaryUrl('')
        setShareExpiresAt('')
      }
    } catch (e: any) {
      toast.show(String(e?.message || e || '공유 기록 삭제 실패'))
    } finally {
      setDeletingShareId('')
    }
  }, [deletingShareId, toast, loadShareHistory])

  const copyPortfolioShareUrl = async () => {
    if (!sharedSummaryUrl) {
      toast.show('먼저 공유 URL을 생성해 주세요')
      return
    }
    try {
      await navigator.clipboard.writeText(sharedSummaryUrl)
      toast.show('공유 URL을 복사했습니다')
    } catch {
      toast.show('공유 URL 복사에 실패했습니다')
    }
  }

  useEffect(() => {
    if (!shareModalOpen) {
      autoCreateTriedRef.current = false
      return
    }

    let cancelled = false
    ;(async () => {
      const history = await loadShareHistory({ silent: true })
      if (cancelled) return

      const active = pickLatestActiveShare(history)
      if (active?.url) {
        setSharedSummaryUrl(active.url)
        setShareExpiresAt(String(active.expiresAt || ''))
        return
      }

      if (!shareCreating && !autoCreateTriedRef.current) {
        autoCreateTriedRef.current = true
        await createPublicShareUrl()
      }
    })()

    return () => {
      cancelled = true
    }
  }, [shareModalOpen, shareCreating, createPublicShareUrl, loadShareHistory])

  return {
    shareModalOpen,
    setShareModalOpen,
    captureGeneratedAt,
    sharedSummaryUrl,
    shareExpiresAt,
    shareTtlHours,
    setShareTtlHours,
    shareCreating,
    shareHistory,
    shareHistoryLoading,
    revokingShareId,
    deletingShareId,
    createPublicShareUrl,
    loadShareHistory,
    revokeShare,
    deleteShare,
    copyPortfolioShareUrl,
  }
}

export type ShareState = ReturnType<typeof useShare>
