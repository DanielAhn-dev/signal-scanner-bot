import Collapsible from '../../../components/ui/Collapsible'
import { formatNumber } from '../../../lib/format'
import type { MacroRisk } from '../lib/macroRisk'

type MacroCardProps = {
  macroLoading: boolean
  macroRiskLevel: MacroRisk
}

export default function MacroCard({
  macroLoading,
  macroRiskLevel,
}: MacroCardProps) {
  return (
    <Collapsible
      className="mb-4 portfolio-macro-card"
      title="거시 반영 어드바이저 (금리·유가·CPI)"
      hint={macroLoading ? '거시지표 로딩 중...' : `${macroRiskLevel.diagnosis} · 정책 ${macroRiskLevel.label}`}
    >
      <div className="caption muted" style={{ marginBottom: 'var(--space-2)' }}>
        {macroLoading
          ? '거시지표 로딩 중...'
          : `${macroRiskLevel.diagnosis} · 정책 ${macroRiskLevel.label} · 추가매수 기준 +${macroRiskLevel.addScorePenalty}점 · 부분익절 기준 -${macroRiskLevel.partialTakeProfitBonus}%p`}
      </div>
      <div className="portfolio-macro-grid">
        <div className="portfolio-macro-metric"><span>미국10년물</span><strong>{macroRiskLevel.us10y != null ? `${formatNumber(macroRiskLevel.us10y, 2)}%` : '—'}</strong></div>
        <div className="portfolio-macro-metric"><span>WTI유가</span><strong>{macroRiskLevel.wtiOil != null ? `$${formatNumber(macroRiskLevel.wtiOil, 1)}` : '—'}</strong></div>
        <div className="portfolio-macro-metric"><span>CPI YoY</span><strong>{macroRiskLevel.cpiYoy != null ? `${formatNumber(macroRiskLevel.cpiYoy, 2)}%` : '미설정'}</strong></div>
      </div>
    </Collapsible>
  )
}
