import { formatKrw, formatNumber } from '../../../lib/format'

export function clampValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

export function normalizeScoreFrom5(value: number | null | undefined): number {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return 0
  if (n > 5) return clampValue(n, 0, 100)
  return clampValue(n * 20, 0, 100)
}

export function gradeToPct(grade: unknown): number {
  const value = String(grade || '').trim().toUpperCase()
  if (value === 'A') return 92
  if (value === 'B') return 78
  if (value === 'C') return 60
  if (value === 'D') return 42
  return 50
}

export function pickFirstFiniteNumber(obj: any, keys: string[]): number | null {
  for (const key of keys) {
    const raw = obj?.[key]
    if (raw == null || raw === '') continue
    const value = Number(raw)
    if (Number.isFinite(value)) return value
  }
  return null
}

export function computeNetFlow(item: any): { net5d: number | null; net20d: number | null } {
  const foreign = pickFirstFiniteNumber(item, [
    'foreign_net_buy_5d',
    'foreignNetBuy5d',
    'foreign5d',
  ])
  const institution = pickFirstFiniteNumber(item, [
    'institution_net_buy_5d',
    'institutionNetBuy5d',
    'institution5d',
  ])
  const foreign20 = pickFirstFiniteNumber(item, [
    'foreign_net_buy_20d',
    'foreignNetBuy20d',
    'foreign20d',
  ])
  const institution20 = pickFirstFiniteNumber(item, [
    'institution_net_buy_20d',
    'institutionNetBuy20d',
    'institution20d',
  ])

  const net5d = foreign == null && institution == null
    ? null
    : (foreign ?? 0) + (institution ?? 0)
  const net20d = foreign20 == null && institution20 == null
    ? null
    : (foreign20 ?? 0) + (institution20 ?? 0)

  return { net5d, net20d }
}

export function formatCompactKrw(value: number | null | undefined): string {
  if (value == null) return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  const sign = n >= 0 ? '+' : '-'
  const abs = Math.abs(Math.round(n))
  if (abs >= 100_000_000) return `${sign}${formatNumber(abs / 100_000_000, abs >= 1_000_000_000 ? 1 : 0)}억원`
  if (abs >= 10_000) return `${sign}${formatNumber(Math.round(abs / 10_000))}만원`
  return `${sign}${formatNumber(abs)}원`
}

export function computeNetFlowScore(item: any): { score: number; label: string | null; net5d: number | null; net20d: number | null } {
  const flow = computeNetFlow(item)
  if (flow.net5d == null && flow.net20d == null) return { score: 50, label: null, net5d: null, net20d: null }

  const net5d = flow.net5d ?? 0
  const net20d = flow.net20d ?? 0
  const billions5d = net5d / 1_000_000_000
  const billions20d = net20d / 1_000_000_000
  const score = clampValue(50 + billions5d * 3.6 + billions20d * 1.4, 0, 100)
  const leadNet = flow.net5d ?? flow.net20d ?? 0
  const label = leadNet >= 0
    ? `수급 순유입(5D) ${formatKrw(Math.round(Math.abs(net5d)))}`
    : `수급 순유출(5D) ${formatKrw(Math.round(Math.abs(net5d)))}`
  return { score, label, net5d: flow.net5d, net20d: flow.net20d }
}

export function computeFlowAccelerationScore(net5d: number | null, net20d: number | null): { score: number; label: string | null } {
  if (net5d == null && net20d == null) return { score: 50, label: null }
  const daily5 = (net5d ?? 0) / 5
  const daily20 = (net20d ?? 0) / 20
  const delta = daily5 - daily20
  const score = clampValue(50 + (delta / 200_000_000) * 18 + ((net5d ?? 0) / 1_000_000_000) * 1.2, 0, 100)
  const label = delta >= 0
    ? `수급 가속(최근) +${formatKrw(Math.round(Math.abs(delta * 5)))}`
    : `수급 둔화(최근) -${formatKrw(Math.round(Math.abs(delta * 5)))}`
  return { score, label }
}

export function scoreSignalFreshness(ageDays: number | null | undefined, liteAgeDays: number | null | undefined): { score: number; label: string | null } {
  const strictAge = Number(ageDays)
  const liteAge = Number(liteAgeDays)
  if (Number.isFinite(strictAge) && strictAge >= 0) {
    const score = strictAge <= 0 ? 100 : strictAge <= 1 ? 92 : strictAge <= 3 ? 80 : strictAge <= 5 ? 68 : strictAge <= 10 ? 52 : 36
    return { score, label: `신호 신선도(D-${strictAge})` }
  }
  if (Number.isFinite(liteAge) && liteAge >= 0) {
    const score = liteAge <= 0 ? 92 : liteAge <= 1 ? 84 : liteAge <= 3 ? 72 : liteAge <= 5 ? 60 : liteAge <= 10 ? 46 : 32
    return { score, label: `라이트 신호(D-${liteAge})` }
  }
  return { score: 55, label: null }
}

export function computeOverheatRisk(intradayPct: number): number {
  const upRisk = Math.max(0, intradayPct - 4.2)
  const downRisk = Math.max(0, -intradayPct - 4.8)
  return clampValue(upRisk * 18 + downRisk * 10, 0, 100)
}

export function formatStageLabel(stage: unknown): string {
  const value = String(stage || '').trim().toLowerCase()
  if (value === 'breakout') return '리드 돌파'
  if (value === 'lead') return '리드 축적'
  return '일반'
}

export function getThemeBoost(name?: string | null, sector?: string | null): { score: number; labels: string[] } {
  const text = `${name || ''} ${sector || ''}`.toLowerCase()
  const tags: Array<{ score: number; label: string; tokens: string[] }> = [
    { score: 1.6, label: 'LG그룹/전장', tokens: ['lg', '엘지', '전장'] },
    { score: 2, label: '반도체/소부장', tokens: ['반도체', 'semiconductor', '소부장', 'hbm', '메모리'] },
    { score: 1.8, label: '로봇/자동화', tokens: ['로봇', 'robot', '자동화'] },
    { score: 1.4, label: '현대차그룹', tokens: ['현대차', '현대모비스', '오토에버', 'hl만도', '기아'] },
  ]

  let score = 0
  const labels: string[] = []
  for (const tag of tags) {
    if (tag.tokens.some((token) => text.includes(token))) {
      score += tag.score
      labels.push(tag.label)
    }
  }
  return { score, labels }
}
