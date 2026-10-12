export function formatKrwShort(value: number): string {
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  if (abs >= 100_000_000) return `${sign}${(abs / 100_000_000).toFixed(1)}억`
  if (abs >= 10_000) return `${sign}${Math.round(abs / 10_000).toLocaleString('ko-KR')}만`
  return `${sign}${Math.round(abs).toLocaleString('ko-KR')}원`
}

export function buildLinePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return ''
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
}

export function calculateMovingAverage(values: number[], window: number): number[] {
  const result: number[] = []
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1)
    const subset = values.slice(start, i + 1)
    const avg = subset.reduce((a, b) => a + b, 0) / subset.length
    result.push(avg)
  }
  return result
}
