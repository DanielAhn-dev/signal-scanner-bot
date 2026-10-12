import type { ActivityRow } from '../types'
import { buildLinePath } from './chartMath'

export function buildRollingWinRate(activityRows: ActivityRow[]) {
  const sellRows = [...activityRows]
    .filter((row) => row.side === 'SELL' && Number.isFinite(Number(row.pnl_amount)))
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  if (sellRows.length < 3) return { points: [] as Array<{ x: number; y: number; winRate: number }>, path: '', avgWinRate: 0 }
  const windowSize = Math.min(5, Math.max(2, Math.floor(sellRows.length / 2)))
  const wWidth = 560; const wPadX = 18; const wPadY = 8; const wH = 60
  const pts = sellRows.slice(windowSize - 1).map((_, i) => {
    const win = sellRows.slice(i, i + windowSize).filter((r) => Number(r.pnl_amount || 0) > 0).length
    const winRate = Math.round((win / windowSize) * 100)
    const tradeIdx = i + windowSize - 1
    const x = sellRows.length <= 1 ? wWidth / 2 : wPadX + (tradeIdx / (sellRows.length - 1)) * (wWidth - wPadX * 2)
    const y = wPadY + ((100 - winRate) / 100) * (wH - wPadY * 2)
    return { x, y, winRate }
  })
  const avgWinRate = pts.length > 0 ? Math.round(pts.reduce((s, p) => s + p.winRate, 0) / pts.length) : 0
  return { points: pts, path: buildLinePath(pts), avgWinRate }
}
