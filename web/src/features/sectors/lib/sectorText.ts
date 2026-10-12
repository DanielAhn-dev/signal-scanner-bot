import type { Sector, Tab } from '../types'
import { formatKoreanMoney, toNum } from './format'

export function buildMetricsSummary(s: Sector): string | null {
  const core = toNum(s.metrics?.core_count)
  const stock = toNum(s.metrics?.stock_count)
  const inst5d = toNum(s.metrics?.flow_inst_5d)
  const parts: string[] = []
  if (core != null) parts.push(`핵심 ${Math.round(core)}종목`)
  if (stock != null) parts.push(`전체 ${Math.round(stock)}종목`)
  if (inst5d != null) {
    const dir = inst5d > 0 ? "기관↑" : inst5d < 0 ? "기관↓" : "기관-"
    parts.push(`${dir} ${formatKoreanMoney(inst5d)}원`)
  }
  return parts.length > 0 ? parts.join(" · ") : null
}

export function buildSectorReason(s: Sector, tab: Tab): string {
  const score = s.score ?? 0
  const change = s.change_rate ?? 0
  const inst5d = toNum(s.metrics?.flow_inst_5d)
  const scoreText = score >= 75
    ? "점수 상위권으로 주도 강도가 높은 구간입니다"
    : score >= 55
      ? "점수가 기준선(55점) 이상이라 추세가 유지되는 구간입니다"
      : "점수는 낮지만 단기 모멘텀을 체크할 구간입니다"

  const changeText = change > 0
    ? `단기 등락률이 +${change.toFixed(2)}%로 우상향 흐름입니다`
    : change < 0
      ? `단기 등락률이 ${change.toFixed(2)}%로 변동성 확인이 필요합니다`
      : "단기 등락률은 보합권입니다"

  const flowText = inst5d == null
    ? "수급 데이터는 제한적으로 제공됩니다"
    : inst5d > 0
      ? `기관 수급이 최근 5일 ${formatKoreanMoney(inst5d)}원 순유입입니다`
      : inst5d < 0
        ? `기관 수급이 최근 5일 ${formatKoreanMoney(Math.abs(inst5d))}원 순유출입니다`
        : "기관 수급이 최근 5일 중립입니다"

  if (tab === "promising") return `${scoreText}. ${flowText}.`
  return `${changeText}. ${flowText}.`
}
