import Button from '../../../components/ui/Button'
import Skeleton from '../../../components/Skeleton'
import { EmptyState } from '../../../components/StateViews'
import type { summarizeAccounts } from '../../../lib/holdingAction'
import type { TradeCostOptions } from '../lib/summary'
import type { HoldingStateKind } from '../lib/holdingState'
import HoldingCard from './HoldingCard'
import type { HoldingRow } from '../types'

type HoldingListProps = {
  loading: boolean
  error: string | null
  rows: HoldingRow[]
  evaluateHoldingState: (row: HoldingRow) => { state: HoldingStateKind; reasons: string[] }
  getPerformanceGrade: (row: HoldingRow) => 'A' | 'B' | 'C'
  accountSummary: ReturnType<typeof summarizeAccounts>
  addEntryMinScore: number
  includeCost: boolean
  tradeCostOpts: TradeCostOptions
  openTradeModal: (row: HoldingRow, side: 'buy' | 'sell') => void
  openMaintenanceModal: (mode: 'liquidateall' | 'holdingedit' | 'holdingrestore' | 'holdingdelete', row?: HoldingRow) => void
}

export default function HoldingList({
  loading,
  error,
  rows,
  evaluateHoldingState,
  getPerformanceGrade,
  accountSummary,
  addEntryMinScore,
  includeCost,
  tradeCostOpts,
  openTradeModal,
  openMaintenanceModal,
}: HoldingListProps) {
  return (
    <div className="cards-list portfolio-cards-list">
      {loading && rows.length === 0 && <div className="card portfolio-loading-card"><Skeleton lines={5} height={18} /></div>}

      {!loading && !error && rows.length === 0 && (
        <>
          <EmptyState
            title="보유 포지션 없음"
            description="상단 유지보수 > 계좌/보유 추가에서 계좌와 종목을 바로 등록할 수 있습니다."
          />
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 'var(--space-3)' }}>
            <Button variant="secondary" onClick={() => openMaintenanceModal('holdingrestore')} disabled={loading}>
              계좌/보유 추가 열기
            </Button>
          </div>
        </>
      )}

      {!error && rows.map((r: HoldingRow) => (
        <HoldingCard
          key={r.id}
          r={r}
          stateEvaluation={evaluateHoldingState(r)}
          grade={getPerformanceGrade(r)}
          accountSummary={accountSummary}
          addEntryMinScore={addEntryMinScore}
          includeCost={includeCost}
          tradeCostOpts={tradeCostOpts}
          openTradeModal={openTradeModal}
          openMaintenanceModal={openMaintenanceModal}
        />
      ))}
    </div>
  )
}
