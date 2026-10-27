import { useState } from 'react'
import { formatNumber } from '../../../lib/format'
import { useAmountMask } from '../../../stores/amountMaskStore'
import type { AccountFolder } from '../types'
import { accountLabel } from '../lib/accountKey'
import { ALLOCATION_COLORS, ALLOCATION_OTHER_CODE, type AllocationRow } from '../lib/allocation'

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
  const [showRest, setShowRest] = useState(false)
  const m = useAmountMask()
  const other = allocationRows.find((r) => r.code === ALLOCATION_OTHER_CODE)
  // 목록만 펼친다 — 도넛은 '그 외'로 묶인 그대로(색이 수십 개로 쪼개지면 읽을 수 없다)
  const listRows = showRest && other?.rest ? [...allocationRows.filter((r) => r !== other), ...other.rest] : allocationRows
  return (
    <div className="card mb-4 portfolio-asset-overview-card">
      <div className="portfolio-asset-overview-head">
        <div>
          <div className="title-md">{isVirtual ? '가상 계좌 자산 구성' : '내 계좌 종목 비중'}</div>
          <div className="caption muted">
            {selectedAccountKey === 'real'
              ? '직접 매매하는 계좌 전부의 보유 평가금과 종목별 비중입니다. 예수금은 위 카드와 계좌 화면에서 봅니다.'
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

          {/* 실제 계좌는 보유 평가금 하나뿐이라 도넛 가운데 숫자와 겹쳤다(위에 동떨어진 상자) — 가상 계좌만 지표 줄 */}
          {isVirtual && (
          <div className="portfolio-asset-metrics">
            <div className="portfolio-asset-metric">
              <div className="portfolio-capture-label">시드 자본금</div>
              <div className="portfolio-capture-value">{m.compact(initialCapital)}</div>
            </div>
            <div className="portfolio-asset-metric">
              <div className="portfolio-capture-label">보유 평가금</div>
              <div className="portfolio-capture-value">{m.compact(totalEvaluationValue)}</div>
            </div>
            <div className="portfolio-asset-metric">
              <div className="portfolio-capture-label">
                {dbVirtualCash != null ? '잔여 현금 (자동매매)' : '추정 예수금'}
              </div>
              <div className={`portfolio-capture-value ${m.tone((dbVirtualCash ?? estimatedCash) < 0 ? 'negative' : '')}`}>
                {m.compact(dbVirtualCash ?? estimatedCash)}
              </div>
            </div>
            <div className="portfolio-asset-metric">
              <div className="portfolio-capture-label">총 자산(보유 평가금 + 예수금)</div>
              <div className={`portfolio-capture-value ${m.tone(totalAssetValue < 0 ? 'negative' : 'positive')}`}>{m.compact(totalAssetValue)}</div>
            </div>
          </div>
          )}

          <div className={showRest ? 'portfolio-allocation-wrap is-expanded' : 'portfolio-allocation-wrap'}>
            <div className="portfolio-allocation-chart-wrap">
              <div className="portfolio-allocation-chart" style={{ background: allocationChartStyle }} />
              <div className="portfolio-allocation-chart-center">
                <div className="portfolio-allocation-center-label">{isVirtual ? '총 자산' : '보유 평가금'}</div>
                {/* 실제 계좌는 시드가 없어 totalAssetValue(평가금 + 추정 현금 = 평가금 − 매수금)가 음수로 나왔다 */}
                <div className="portfolio-allocation-center-value">{m.compact(isVirtual ? totalAssetValue : totalEvaluationValue)}</div>
              </div>
            </div>

            <div className="portfolio-allocation-list">
              {allocationRows.length === 0 ? (
                <div className="caption muted">비중을 계산할 데이터가 없습니다.</div>
              ) : (
                listRows.map((row, idx) => (
                  <button
                    type="button"
                    key={`${row.code}-${idx}`}
                    className="portfolio-allocation-item"
                    disabled={row.code === 'CASH'}
                    aria-expanded={row.code === ALLOCATION_OTHER_CODE ? false : undefined}
                    onClick={() => (row.code === ALLOCATION_OTHER_CODE ? setShowRest(true) : scrollToHolding(row.code))}
                  >
                    <div className="portfolio-allocation-item-name">
                      <span className="portfolio-allocation-dot" style={{ background: ALLOCATION_COLORS[idx % ALLOCATION_COLORS.length] }} />
                      <span>{row.name}{row.code === ALLOCATION_OTHER_CODE ? ' · 더보기' : ''}</span>
                      {row.quantity != null && row.quantity > 0 && (
                        <span className="portfolio-allocation-qty">{formatNumber(row.quantity)}주</span>
                      )}
                    </div>
                    <div className="portfolio-allocation-item-values">
                      <span>{formatNumber(row.ratio, 1)}%</span>
                      <span className="muted">{m.compact(row.value)}</span>
                    </div>
                  </button>
                ))
              )}
              {showRest && other && (
                <button type="button" className="portfolio-allocation-item" aria-expanded onClick={() => setShowRest(false)}>
                  <div className="portfolio-allocation-item-name"><span>접기 (상위 {allocationRows.length - 1}개만 보기)</span></div>
                </button>
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
