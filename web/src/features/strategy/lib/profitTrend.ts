import { COLOR_NEGATIVE, COLOR_NEGATIVE_BG, COLOR_POSITIVE, COLOR_POSITIVE_BG } from '../constants'
import type { ActivityRow } from '../types'
import { buildLinePath, calculateMovingAverage } from './chartMath'

export function buildProfitTrend(activityRows: ActivityRow[]) {
  const realizedRows = [...activityRows]
    .filter((row) => row.side === 'SELL' && Number.isFinite(Number(row.pnl_amount)))
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

  let cumulative = 0
  const series = realizedRows.map((row, index) => {
    cumulative += Number(row.pnl_amount || 0)
    return {
      id: row.id || `${row.code}-${index}`,
      label: row.stock_name || row.code || '-',
      date: new Date(row.created_at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }),
      value: cumulative,
    }
  })

  if (series.length === 0) {
    return {
      points: [] as Array<{ id: string; x: number; y: number; label: string; date: string; value: number }>,
      movingAvgPoints: [] as Array<{ x: number; y: number }>,
      path: '',
      maPath: '',
      baselineY: 84,
      lastValue: 0,
      fillSegments: [] as Array<{ start: number; end: number; color: string }>,
      segments: [] as Array<{ x1: number; y1: number; x2: number; y2: number; color: string }>,
      projectionPoints: [] as Array<{ x: number; y: number }>,
      tradeBars: [] as Array<{ x: number; amount: number; isPositive: boolean; barW: number; barH: number; barBaseY: number; label: string; date: string; rectY: number }>,
    }
  }

  const width = 560
  const height = 168
  const paddingX = 18
  const paddingY = 16
  const values = series.map((item) => item.value)
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values)
  const range = Math.max(1, max - min)

  const points = series.map((item, index) => {
    const x = series.length === 1
      ? width / 2
      : paddingX + (index / (series.length - 1)) * (width - paddingX * 2)
    const y = paddingY + ((max - item.value) / range) * (height - paddingY * 2)
    return { ...item, x, y }
  })

  // 이동평균선 (3-point MA)
  const maValues = calculateMovingAverage(values, Math.min(3, Math.max(1, Math.floor(series.length / 3))))
  const movingAvgPoints = series.map((item, index) => {
    const x = series.length === 1
      ? width / 2
      : paddingX + (index / (series.length - 1)) * (width - paddingX * 2)
    const y = paddingY + ((max - maValues[index]) / range) * (height - paddingY * 2)
    return { x, y }
  })

  // 구간별 배경색
  const fillSegments: Array<{ start: number; end: number; color: string }> = []
  for (let i = 0; i < points.length - 1; i++) {
    const currIsPositive = values[i] >= 0
    const nextIsPositive = values[i + 1] >= 0
    if (currIsPositive !== nextIsPositive) {
      // 경계 지점에서 컬러 전환
      const color = values[i + 1] >= 0 ? COLOR_POSITIVE_BG : COLOR_NEGATIVE_BG
      fillSegments.push({ start: i, end: i + 1, color })
    } else {
      const color = currIsPositive ? COLOR_POSITIVE_BG : COLOR_NEGATIVE_BG
      fillSegments.push({ start: i, end: i + 1, color })
    }
  }

  // 구간별 색상 세그먼트 (각 구간의 중간값 기준)
  const segments = points.slice(0, -1).map((p, i) => {
    const next = points[i + 1]!
    const midValue = (values[i] + values[i + 1]) / 2
    return { x1: p.x, y1: p.y, x2: next.x, y2: next.y, color: midValue >= 0 ? COLOR_POSITIVE : COLOR_NEGATIVE }
  })

  // 선형 추세 기반 예상선 (최근 3거래 전망)
  const projectionPoints: Array<{ x: number; y: number }> = []
  if (points.length >= 2) {
    const stepX = (points[points.length - 1]!.x - points[0]!.x) / Math.max(points.length - 1, 1)
    const avgDeltaVal = (values[values.length - 1] - values[0]) / Math.max(values.length - 1, 1)
    for (let i = 1; i <= 3; i++) {
      const projVal = values[values.length - 1] + avgDeltaVal * i
      const projY = paddingY + ((max - projVal) / range) * (height - paddingY * 2)
      projectionPoints.push({
        x: points[points.length - 1]!.x + stepX * i,
        y: Math.max(paddingY / 2, Math.min(height - paddingY / 2, projY)),
      })
    }
  }

  // 거래별 손익 막대 데이터
  const barBaseY = 44
  const barPad = 8
  const barMaxAbs = Math.max(1, ...realizedRows.map((r) => Math.abs(Number(r.pnl_amount || 0))))
  const barBandH = barBaseY - barPad
  const barW = Math.max(4, Math.min(14, ((width - paddingX * 2) / Math.max(realizedRows.length, 1)) * 0.65))
  const tradeBars = realizedRows.map((row, i) => {
    const x = realizedRows.length === 1
      ? width / 2
      : paddingX + (i / (realizedRows.length - 1)) * (width - paddingX * 2)
    const amount = Number(row.pnl_amount || 0)
    const isPositive = amount >= 0
    const barH = Math.max(2, (Math.abs(amount) / barMaxAbs) * barBandH)
    return {
      x, amount, isPositive, barW, barH, barBaseY,
      label: row.stock_name || row.code || '-',
      date: new Date(row.created_at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }),
      rectY: isPositive ? barBaseY - barH : barBaseY,
    }
  })

  return {
    points,
    movingAvgPoints,
    path: buildLinePath(points),
    maPath: buildLinePath(movingAvgPoints),
    baselineY: paddingY + ((max - 0) / range) * (height - paddingY * 2),
    lastValue: points[points.length - 1]?.value ?? 0,
    fillSegments,
    segments,
    projectionPoints,
    tradeBars,
  }
}
