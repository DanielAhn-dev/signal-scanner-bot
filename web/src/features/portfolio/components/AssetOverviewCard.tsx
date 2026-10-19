import { formatKrwCompact, formatNumber } from '../../../lib/format'
import type { AccountFolder } from '../types'
import { accountLabel } from '../lib/accountKey'
import { ALLOCATION_COLORS, type AllocationRow } from '../lib/allocation'

type AssetOverviewCardProps = {
  selectedAccountKey: string
  accountFolders: AccountFolder[]
  initialCapital: number
  totalEvaluationValue: number
  dbVirtualCash: number | null
  estimatedCash: number
  totalAssetValue: number
  allocationChartStyle: string
  allocationRows: AllocationRow[]
  dbSeedCapital: number | null
}

/** 비중 목록에서 누른 종목의 보유 카드로 스크롤 (다른 페이지에 있어 카드가 없으면 아무 일도 하지 않는다) */
function scrollToHolding(code: string) {
  const el = document.querySelector(`[data-holding-code="${CSS.escape(code)}"]`)
  if (!el) return
  el.dispatchEvent(new Event('holding-expand'))
  // 펼쳐져 높이가 바뀐 다음 위치로 이동
  requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}

export default function AssetOverviewCard({
  selectedAccountKey,
  accountFolders,
  initialCapital,
  totalEvaluationValue,
  dbVirtualCash,
  estimatedCash,
  totalAssetValue,
  allocationChartStyle,
  allocationRows,
  dbSeedCapital,
}: AssetOverviewCardProps) {
  // 시드·현금은 실험(가상) 계좌에만 있다 — 실제 계좌 탭에는 보유 평가금과 비중만
  const isVirtual = selectedAccountKey === 'virtual'
  return (
    <div className="card mb-4 portfolio-asset-overview-card">
      <div className="portfolio-asset-overview-head">
        <div>
          <div className="title-md">{isVirtual ? '가상 계좌 자산 구성' : '내 계좌 종목 비중'}</div>
          <div className="caption muted">
            {selectedAccountKey === 'real'
              ? '직접 매매하는 계좌 전부의 보유 평가금과 종목별 비중입니다. 예수금은 이 앱에 입력하지 않아 빠져 있습니다.'
              : isVirtual
                ? '[가상] 봇이 내 계획대로 사고파는 가상 계좌의 시드, 평가금, 현금, 종목별 비중입니다.'
                : `${accountLabel(
                    accountFolders.find(f => f.key === selectedAccountKey)?.brokerName,
                    accountFolders.find(f => f.key === selectedAccountKey)?.accountName
                  )} 계좌의 보유 평가금과 종목별 비중입니다.`
            }
          </div>
        </div>
      </div>

      <div className="portfolio-asset-overview-body">

          <div className="portfolio-asset-metrics">
            {isVirtual && (
            <div className="portfolio-asset-metric">
              <div className="portfolio-capture-label">시드 자본금</div>
              <div className="portfolio-capture-value">{formatKrwCompact(initialCapital)}</div>
            </div>
            )}
            <div className="portfolio-asset-metric">
              <div className="portfolio-capture-label">보유 평가금</div>
              <div className="portfolio-capture-value">{formatKrwCompact(totalEvaluationValue)}</div>
            </div>
            {isVirtual && (<>
            <div className="portfolio-asset-metric">
              <div className="portfolio-capture-label">
                {dbVirtualCash != null ? '잔여 현금 (자동매매)' : '추정 예수금'}
              </div>
              <div className={`portfolio-capture-value ${(dbVirtualCash ?? estimatedCash) < 0 ? 'negative' : ''}`}>
                {formatKrwCompact(dbVirtualCash ?? estimatedCash)}
              </div>
            </div>
            <div className="portfolio-asset-metric">
              <div className="portfolio-capture-label">총 자산(보유 평가금 + 예수금)</div>
              <div className={`portfolio-capture-value ${totalAssetValue < 0 ? 'negative' : 'positive'}`}>{formatKrwCompact(totalAssetValue)}</div>
            </div>
            </>)}
          </div>

          <div className="portfolio-allocation-wrap">
            <div className="portfolio-allocation-chart-wrap">
              <div className="portfolio-allocation-chart" style={{ background: allocationChartStyle }} />
              <div className="portfolio-allocation-chart-center">
                <div className="portfolio-allocation-center-label">{isVirtual ? '총 자산' : '보유 평가금'}</div>
                <div className="portfolio-allocation-center-value">{formatKrwCompact(totalAssetValue)}</div>
              </div>
            </div>

            <div className="portfolio-allocation-list">
              {allocationRows.length === 0 ? (
                <div className="caption muted">비중을 계산할 데이터가 없습니다.</div>
              ) : (
                allocationRows.map((row, idx) => (
                  <button
                    type="button"
                    key={`${row.code}-${idx}`}
                    className="portfolio-allocation-item"
                    disabled={row.code === 'CASH'}
                    onClick={() => scrollToHolding(row.code)}
                  >
                    <div className="portfolio-allocation-item-name">
                      <span className="portfolio-allocation-dot" style={{ background: ALLOCATION_COLORS[idx % ALLOCATION_COLORS.length] }} />
                      <span>{row.name}</span>
                    </div>
                    <div className="portfolio-allocation-item-values">
                      <span>{formatNumber(row.ratio, 1)}%</span>
                      <span className="muted">{formatKrwCompact(row.value)}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
          {isVirtual && <div className="caption muted" style={{ marginTop: 'var(--space-2)' }}>
            {dbSeedCapital != null
              ? '시드 자본금은 설정 화면에서 변경할 수 있습니다. 자동매매 예산과 잔여 현금도 설정에서 관리하세요.'
              : '시드 자본금을 설정 화면에서 입력하면 자동매매 예산이 정확하게 계산됩니다.'}
          </div>}
        </div>
    </div>
  )
}
