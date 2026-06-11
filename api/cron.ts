import type { VercelRequest, VercelResponse } from '@vercel/node'

import cronMain from '../handlers/cron/index'
import briefing from '../handlers/cron/briefing'
import report from '../handlers/cron/report'
import scoreSync from '../handlers/cron/scoreSync'
import strategyGateRefresh from '../handlers/cron/strategyGateRefresh'
import virtualAutoTrade from '../handlers/cron/virtualAutoTrade'
import integrityAudit from '../handlers/cron/integrityAudit'

type CronHandler = (req: VercelRequest, res: VercelResponse) => unknown | Promise<unknown>

const TASK_ROUTES: Record<string, CronHandler> = {
  briefing,
  report,
  scoreSync,
  strategyGateRefresh,
  virtualAutoTrade,
  integrityAudit,
}

function normalizeTask(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return String(value[0] || '').trim()
  return String(value || '').trim()
}

export const config = {
  maxDuration: 60,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const task = normalizeTask(req.query.task)
  if (!task) return cronMain(req, res)

  const fn = TASK_ROUTES[task]
  if (!fn) {
    return res.status(404).json({ ok: false, error: `Unknown /api/cron task: ${task}` })
  }

  return fn(req, res)
}
