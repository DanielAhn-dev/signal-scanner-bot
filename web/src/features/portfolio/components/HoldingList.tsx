import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import Button from '../../../components/ui/Button'
import Skeleton from '../../../components/Skeleton'
import { EmptyState } from '../../../components/StateViews'
import type { summarizeAccounts } from '../../../lib/holdingAction'
import { formatKrw, formatNumber } from '../../../lib/format'
import type { TradeCostOptions } from '../lib/summary'
import type { HoldingStateKind } from '../lib/holdingState'
import HoldingCard from './HoldingCard'
import { HOLDING_SORT_OPTIONS, type HoldingSortKey } from '../lib/holdingSort'
import { HOLDING_GROUP_OPTIONS, groupByAccount, groupByStock, type HoldingGroupMode } from '../lib/holdingGroups'
import { accountDotColor, displayAccountName, type AccountAliases } from '../lib/accountAliases'
import { holdingAccountKey } from '../lib/accountKey'
import type { AccountFolder, HoldingRow } from '../types'
import type { RealHoldingTotals } from '../lib/stockSizing'

type HoldingListProps = {
  loading: boolean
  error: string | null
  /** 이번 쪽에 보일 행(한 줄씩 보기) */
  rows: HoldingRow[]
  /** 필터·정렬한 전체 행 — 계좌별·종목별 묶음은 쪽을 나누지 않고 이걸 묶는다 */
  allRows: HoldingRow[]
  evaluateHoldingState: (row: HoldingRow) => { state: HoldingStateKind; reasons: string[] }
  getPerformanceGrade: (row: HoldingRow) => 'A' | 'B' | 'C'
  accountSummary: ReturnType<typeof summarizeAccounts>
  addEntryMinScore: number
  includeCost: boolean
  tradeCostOpts: TradeCostOptions
  openTradeModal: (row: HoldingRow, side: 'buy' | 'sell') => void
  openMaintenanceModal: (mode: 'liquidateall' | 'holdingedit' | 'holdingrestore' | 'holdingdelete', row?: HoldingRow, opts?: { accountKey?: string | null }) => void
  realTotals: RealHoldingTotals
  sortKey: HoldingSortKey
  onSortChange: (key: HoldingSortKey) => void
  /** 필터 후 전체 종목 수 — 2개 이상일 때만 정렬 버튼을 보인다 */
  total: number
  /** 묶어 보기 — 실제 계좌 전체 탭에서 계좌가 2개 이상일 때만 고를 수 있다(groupable) */
  groupable: boolean
  groupMode: HoldingGroupMode
  onGroupModeChange: (mode: HoldingGroupMode) => void
  accountFolders: AccountFolder[]
  aliases: AccountAliases
}

const pctText = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : ''}${formatNumber(v, 2)}%`)
const pnlClass = (v: number) => `portfolio-group-pnl${v < 0 ? ' negative' : v > 0 ? ' positive' : ''}`

export default function HoldingList({
  loading,
  error,
  rows,
  allRows,
  evaluateHoldingState,
  getPerformanceGrade,
  accountSummary,
  addEntryMinScore,
  includeCost,
  tradeCostOpts,
  openTradeModal,
  openMaintenanceModal,
  realTotals,
  sortKey,
  onSortChange,
  total,
  groupable,
  groupMode,
  onGroupModeChange,
  accountFolders,
  aliases,
}: HoldingListProps) {
  // 접은 묶음(계좌 키·종목 코드) — 기본은 계좌는 펼침, 여러 계좌에 나눠 담은 종목은 접음
  const [collapsedAccounts, setCollapsedAccounts] = useState<Set<string>>(new Set())
  const [openStocks, setOpenStocks] = useState<Set<string>>(new Set())
  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }
  const nameOf = (r: HoldingRow) => {
    const key = holdingAccountKey(r)
    return displayAccountName(aliases, key, r.broker_name, r.account_name)
  }
  const costOpts = { includeCost, tradeCostOpts }
  const mode: HoldingGroupMode = groupable ? groupMode : 'flat'

  const card = (r: HoldingRow, opts?: { hideAccount?: boolean }) => (
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
      realTotals={realTotals}
      accountDisplay={nameOf(r)}
      hideAccount={opts?.hideAccount}
    />
  )

  return (
    <div className="cards-list portfolio-cards-list">
      {!error && (total > 1 || groupable) && (
        <div className="portfolio-list-toolbar">
          {groupable && (
            <div className="portfolio-sort-row" role="group" aria-label="보유 종목 묶어 보기">
              <span className="caption muted">보기</span>
              {HOLDING_GROUP_OPTIONS.map((o) => (
                <Button
                  key={o.key}
                  size="sm"
                  variant={mode === o.key ? 'primary' : 'secondary'}
                  aria-pressed={mode === o.key}
                  onClick={() => onGroupModeChange(o.key)}
                >
                  {o.label}
                </Button>
              ))}
            </div>
          )}
          {total > 1 && (
            <div className="portfolio-sort-row" role="group" aria-label="보유 종목 정렬">
              {groupable && <span className="caption muted">정렬</span>}
              {HOLDING_SORT_OPTIONS.map((o) => (
                <Button
                  key={o.key}
                  size="sm"
                  variant={sortKey === o.key ? 'primary' : 'secondary'}
                  aria-pressed={sortKey === o.key}
                  onClick={() => onSortChange(o.key)}
                >
                  {o.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
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

      {!error && mode === 'flat' && rows.map((r) => card(r))}

      {/* 계좌별: 계좌마다 접히는 묶음 + 소계. 묶음 안 카드에는 계좌 이름을 다시 쓰지 않는다 */}
      {!error && mode === 'account' && groupByAccount(allRows, accountFolders, costOpts).map((g) => {
        const collapsed = collapsedAccounts.has(g.key)
        const label = displayAccountName(aliases, g.key, g.brokerName, g.accountName)
        return (
          <section key={g.key} className="portfolio-group" aria-label={`${label} 보유`}>
            <div className="portfolio-group-head">
              <button
                type="button"
                className="portfolio-group-toggle"
                aria-expanded={!collapsed}
                onClick={() => setCollapsedAccounts((s) => toggle(s, g.key))}
              >
                {collapsed ? <ChevronRight size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
                <span className="portfolio-group-dot" style={{ background: accountDotColor(g.key) }} aria-hidden />
                <span className="portfolio-group-name">{label}</span>
                <span className="caption muted">{g.rows.length}종목</span>
              </button>
              <div className="portfolio-group-sums">
                <span className="portfolio-group-value">{formatKrw(g.value)}</span>
                <span className={pnlClass(g.pnl)}>{formatKrw(g.pnl)} ({pctText(g.pnlPct)})</span>
                <span className="caption muted">비중 {formatNumber(g.weightPct, 1)}%</span>
              </div>
              {g.key !== '|||' && (
                <Button size="sm" variant="ghost" onClick={() => openMaintenanceModal('holdingrestore', undefined, { accountKey: g.key })}>
                  이 계좌에 추가
                </Button>
              )}
            </div>
            {!collapsed && <div className="portfolio-group-body">{g.rows.map((r) => card(r, { hideAccount: true }))}</div>}
          </section>
        )
      })}

      {/* 종목별: 같은 종목을 합친 한 줄. 한 계좌에만 있으면 카드 그대로, 여러 계좌면 합계 줄 → 펼치면 계좌별 카드 */}
      {!error && mode === 'stock' && groupByStock(allRows, costOpts).map((g) => {
        if (g.rows.length === 1) return card(g.rows[0])
        const open = openStocks.has(g.code)
        return (
          <section key={g.code} className="portfolio-group" aria-label={`${g.name} 계좌별 보유`}>
            <div className="portfolio-group-head">
              <button
                type="button"
                className="portfolio-group-toggle"
                aria-expanded={open}
                onClick={() => setOpenStocks((s) => toggle(s, g.code))}
              >
                {open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
                <span className="portfolio-group-name">{g.name}</span>
                <span className="caption muted">{g.code} · {g.rows.length}개 계좌</span>
              </button>
              <div className="portfolio-group-sums">
                <span className="portfolio-group-value">{formatKrw(g.value)}</span>
                <span className={pnlClass(g.pnl)}>{formatKrw(g.pnl)} ({pctText(g.pnlPct)})</span>
                <span className="caption muted">
                  합계 {g.quantity.toLocaleString('ko-KR')}주{g.avgPrice != null ? ` · 평균가 ${formatKrw(Math.round(g.avgPrice))}` : ''}
                </span>
              </div>
            </div>
            <div className="portfolio-group-split caption muted">
              {g.rows.map((r) => `${nameOf(r)} ${Number(r.quantity || 0).toLocaleString('ko-KR')}주`).join(' · ')}
            </div>
            {open && <div className="portfolio-group-body">{g.rows.map((r) => card(r))}</div>}
          </section>
        )
      })}
    </div>
  )
}
