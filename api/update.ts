import type { VercelRequest, VercelResponse } from '@vercel/node'

import updateMain from '../handlers/update/index'
import sectors from '../handlers/update/sectors'
import stocks from '../handlers/update/stocks'

type UpdateHandler = (req: VercelRequest, res: VercelResponse) => unknown | Promise<unknown>

const TASK_ROUTES: Record<string, UpdateHandler> = {
  sectors,
  stocks,
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
  if (!task) return updateMain(req, res)

  const fn = TASK_ROUTES[task]
  if (!fn) {
    return res.status(404).json({ ok: false, error: `Unknown /api/update task: ${task}` })
  }

  return fn(req, res)
}
