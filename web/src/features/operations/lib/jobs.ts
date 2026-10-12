import type { AutoTradeRun, JobPayload, LiveJobState, TimelineEvent } from '../types'

export function normalizeJobState(raw: string): LiveJobState {
  const value = String(raw || '').toLowerCase()
  if (value === 'running') return 'running'
  if (value === 'done') return 'done'
  if (value === 'failed') return 'failed'
  return 'queued'
}

export function resolveTaskLabel(payload: JobPayload | null): string {
  const task = String(payload?.task || '')
  if (task === 'virtualAutoTrade') {
    return payload?.dry_run === false ? '자동사이클 실제 실행' : '자동사이클 점검(dry-run)'
  }
  if (task === 'virtualAutoTradeIntraday') return '순차트리거(장중)'
  return task ? `작업: ${task}` : '작업'
}

export function renderRunSummary(run: AutoTradeRun | null): string {
  if (!run) return '실행 요약 대기 중'
  const summary = run.summary || {}
  const buys = Number(summary.buys ?? summary.buyCount ?? 0)
  const sells = Number(summary.sells ?? summary.sellCount ?? 0)
  const skipped = Number(summary.skipped ?? summary.skippedCount ?? 0)
  const errors = Number(summary.errors ?? summary.errorCount ?? 0)
  return `매수 ${buys} · 매도 ${sells} · 스킵 ${skipped} · 오류 ${errors}`
}

export function progressFill(status: LiveJobState): string {
  if (status === 'queued') return '24%'
  if (status === 'running') return '66%'
  return '100%'
}

export function getTimelineMeta(event: TimelineEvent): { icon: string; color: string; bg: string } {
  if (event.kind === 'queued') return { icon: 'Q', color: '#6B7280', bg: '#F3F4F6' }
  if (event.kind === 'running' || event.kind === 'run_started') return { icon: 'R', color: '#0052DB', bg: '#EBF3FF' }
  if (event.kind === 'trade') return { icon: 'T', color: '#0F766E', bg: '#E8F7F3' }
  const failed = /실패|error/i.test(event.label)
  if (failed) return { icon: '!', color: '#D0313E', bg: '#FFF0F1' }
  return { icon: 'D', color: '#2563EB', bg: '#EDF4FF' }
}

export function normalizeStep(value: unknown): 'intraday' | 'ready' {
  return String(value || '').toLowerCase() === 'ready' ? 'ready' : 'intraday'
}
