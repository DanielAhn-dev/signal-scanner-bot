import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../../lib/api'
import { normalizeJobState, renderRunSummary } from '../lib/jobs'
import type { JobSnapshot } from '../types'

/**
 * 요청한 작업(job_id)을 2초마다 다시 조회한다. 완료/실패하면 감시를 끝내고 이력·KPI·인사이트를 다시 불러오며,
 * 자동사이클 드라이런이 끝나면 승인 대기를 등록한다(같은 job은 한 번만).
 */
export function useJobWatcher(input: {
  loadActivity: () => void | Promise<void>
  loadDashboard: () => void | Promise<void>
  loadAutoCycleInsights: () => void | Promise<void>
  toast: { show: (message: string) => void }
}) {
  const { loadActivity, loadDashboard, loadAutoCycleInsights, toast } = input
  const [pendingDryRunApproval, setPendingDryRunApproval] = useState<{ jobId: string; summary: string } | null>(null)
  const [bannerDismissedForJobId, setBannerDismissedForJobId] = useState<string | null>(null)
  const [liveJobs, setLiveJobs] = useState<Record<string, JobSnapshot>>({})
  const [watchingJobIds, setWatchingJobIds] = useState<string[]>([])
  const [selectedDryRunJobId, setSelectedDryRunJobId] = useState<string | null>(null)
  const [expandedJobIds, setExpandedJobIds] = useState<string[]>([])

  const addWatchingJob = useCallback((jobId: string) => {
    setWatchingJobIds(prev => (prev.includes(jobId) ? prev : [...prev, jobId]))
  }, [])

  const refreshJobSnapshot = useCallback(async (jobId: string, silent = false) => {
    try {
      const json = await apiFetch(`/api/ui/operations?view=job&job_id=${encodeURIComponent(jobId)}`, {
        cacheMs: 0,
        timeoutMs: 15_000,
      })
      const snapshot = (json?.data || null) as JobSnapshot | null
      if (!snapshot?.job) return

      setLiveJobs(prev => ({ ...prev, [jobId]: snapshot }))

      const state = normalizeJobState(snapshot.job.status)
      if (state === 'done' || state === 'failed') {
        setWatchingJobIds(prev => prev.filter(id => id !== jobId))
        setTimeout(loadActivity, 500)
        setTimeout(loadDashboard, 600)
        setTimeout(loadAutoCycleInsights, 700)

        if (state === 'failed' && !silent) {
          toast.show(`작업 실패: ${snapshot.job.error || '원인 미상'}`)
        }

        const payload = snapshot.job.payload || {}
        const isAutocycleDryRun = String(payload.task || '') === 'virtualAutoTrade' && payload.dry_run !== false
        if (state === 'done' && isAutocycleDryRun) {
          setPendingDryRunApproval(prev => {
            if (prev?.jobId === jobId) return prev
            return { jobId, summary: renderRunSummary(snapshot.latest_run) }
          })
        }
      }
    } catch (e: any) {
      if (!silent) {
        toast.show('실시간 상태 조회 실패: ' + String(e?.message || e))
      }
    }
  }, [loadActivity, loadAutoCycleInsights, loadDashboard, toast])

  useEffect(() => {
    if (watchingJobIds.length === 0) return
    const timer = window.setInterval(() => {
      for (const jobId of watchingJobIds) {
        void refreshJobSnapshot(jobId, true)
      }
    }, 2000)
    return () => window.clearInterval(timer)
  }, [refreshJobSnapshot, watchingJobIds])

  const liveJobItems = useMemo(() => {
    return Object.values(liveJobs).sort((a, b) => {
      const left = Date.parse(String(a?.job?.created_at || '')) || 0
      const right = Date.parse(String(b?.job?.created_at || '')) || 0
      return right - left
    })
  }, [liveJobs])

  const selectedDryRunSnapshot = useMemo(() => {
    if (!selectedDryRunJobId) return null
    return liveJobs[selectedDryRunJobId] || null
  }, [liveJobs, selectedDryRunJobId])

  return {
    pendingDryRunApproval, setPendingDryRunApproval, bannerDismissedForJobId, setBannerDismissedForJobId,
    watchingJobIds, addWatchingJob, refreshJobSnapshot, liveJobItems,
    selectedDryRunJobId, setSelectedDryRunJobId, selectedDryRunSnapshot, expandedJobIds, setExpandedJobIds,
  }
}
