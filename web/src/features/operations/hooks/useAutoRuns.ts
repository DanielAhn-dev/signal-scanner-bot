import { useCallback, useRef, useState } from 'react'
import { apiFetch } from '../../../lib/api'
import { normalizeStep } from '../lib/jobs'
import type { JobSnapshot, OpStatus } from '../types'

/**
 * 자동사이클(드라이런/실제 실행/학습)과 순차 트리거 요청, 실패 작업 재시도. 서버에 실행 요청을 보내는 동작이다.
 * `retryJob`이 두 실행 함수를 직접 부르므로 같은 훅에 둔다.
 */
export function useAutoRuns(input: {
  toast: { show: (message: string) => void }
  addWatchingJob: (jobId: string) => void
  refreshJobSnapshot: (jobId: string, silent?: boolean) => Promise<void>
  setPendingDryRunApproval: React.Dispatch<React.SetStateAction<{ jobId: string; summary: string } | null>>
  setBannerDismissedForJobId: React.Dispatch<React.SetStateAction<string | null>>
}) {
  const { toast, addWatchingJob, refreshJobSnapshot, setPendingDryRunApproval, setBannerDismissedForJobId } = input
  const [autocycleStatus, setAutocycleStatus] = useState<OpStatus>('idle')
  const [autotriggerStatus, setAutotriggerStatus] = useState<OpStatus>('idle')
  const [autotriggerStep, setAutotriggerStep] = useState<'intraday' | 'ready'>('intraday')
  const [autotriggerResult, setAutotriggerResult] = useState<string | null>(null)
  // 재진입 가드: disabled={status==='loading'}만으로는 모바일 연타에 실행 요청이 두 번 갈 수 있다
  const autocycleInFlightRef = useRef(false)
  const autotriggerInFlightRef = useRef(false)

  const runAutocycle = async (dryRun: boolean, learning = false) => {
    if (autocycleInFlightRef.current) return
    autocycleInFlightRef.current = true
    setAutocycleStatus('loading')
    try {
      const json = await apiFetch('/api/ui/operations', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 60_000,
        body: JSON.stringify({
          mode: 'autocycle',
          dry_run: dryRun,
          trigger_mode: learning ? 'learning' : 'auto',
        }),
      })
      if (json?.error) throw new Error(String(json.error))
      const jobId = String(json?.job_id || '').trim()
      if (!jobId) throw new Error('job_id가 비어 있습니다.')
      const label = `${learning ? '학습 ' : ''}${dryRun ? '점검(dry-run)' : '실행'}`
      if (json?.execution_error) {
        setAutocycleStatus('error')
      } else {
        setAutocycleStatus('done')
      }
      if (!dryRun) setPendingDryRunApproval(null)
      if (dryRun && !learning) setBannerDismissedForJobId(null)
      addWatchingJob(jobId)
      void refreshJobSnapshot(jobId, false)
      toast.show(`자동사이클 ${label} 등록 완료`)
    } catch (e: any) {
      setAutocycleStatus('error')
      toast.show(`자동사이클 요청 실패: ${String(e?.message || e)}`)
    } finally {
      autocycleInFlightRef.current = false
    }
  }

  const runAutotrigger = async (stepOverride?: 'intraday' | 'ready') => {
    if (autotriggerInFlightRef.current) return
    autotriggerInFlightRef.current = true
    const stepToRun = stepOverride || autotriggerStep
    setAutotriggerStatus('loading')
    setAutotriggerResult(null)
    try {
      const json = await apiFetch('/api/ui/operations', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 60_000,
        body: JSON.stringify({ mode: 'autotrigger', step: stepToRun, dry_run: true }),
      })
      if (json?.error) throw new Error(String(json.error))
      const jobId = String(json?.job_id || '').trim()
      if (!jobId) throw new Error('job_id가 비어 있습니다.')
      if (json?.execution_error) {
        setAutotriggerResult(`순차트리거(${stepToRun}) 실행 실패 - ${String(json.execution_error)}`)
        setAutotriggerStatus('error')
      } else {
        setAutotriggerResult(`순차트리거(${stepToRun}) 요청 등록 완료 - job_id: ${jobId}`)
        setAutotriggerStatus('done')
      }
      addWatchingJob(jobId)
      void refreshJobSnapshot(jobId, false)
      toast.show('순차트리거 등록 완료')
    } catch (e: any) {
      setAutotriggerResult(String(e?.message || e))
      setAutotriggerStatus('error')
    } finally {
      autotriggerInFlightRef.current = false
    }
  }

  const retryJob = useCallback(async (snapshot: JobSnapshot) => {
    const payload = snapshot.job.payload || {}
    const task = String(payload.task || '')
    if (task === 'virtualAutoTrade') {
      const dryRun = payload.dry_run !== false
      await runAutocycle(dryRun, String(payload.trigger_mode || '').toLowerCase() === 'learning')
      return
    }
    if (task === 'virtualAutoTradeIntraday') {
      const step = normalizeStep(payload.step)
      setAutotriggerStep(step)
      await runAutotrigger(step)
      return
    }
    toast.show('재시도를 지원하지 않는 작업입니다.')
  }, [toast])

  return { autocycleStatus, autotriggerStatus, autotriggerStep, setAutotriggerStep, autotriggerResult, runAutocycle, runAutotrigger, retryJob }
}
