import React from 'react'
import Button from '../../../components/ui/Button'
import EconomicEventBadge from '../../../components/EconomicEventBadge'
import SheetHeaderBar from '../../../components/SheetHeaderBar'
import { formatKrwCompact } from '../../../lib/format'
import type { AccountFolder } from '../types'
import { accountLabel } from '../lib/accountKey'
import type { HoldingRow } from '../types'

function AccountTab({ active, onClick, title, children }: { active: boolean; onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button
      className={`portfolio-tab ${active ? 'active' : ''}`}
      onClick={onClick}
      style={{ padding: 'var(--space-2) var(--space-3)', border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: active ? 'var(--font-weight-bold)' : 'normal', color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)', borderBottom: active ? '2px solid var(--color-primary)' : 'none', fontSize: 'var(--font-size-sm)', whiteSpace: 'nowrap', flexShrink: 0 }}
      title={title}
    >
      {children}
    </button>
  )
}

type PortfolioHeaderProps = {
  subtitle: string
  onNavigateToCalendar: () => void
  loading: boolean
  refreshing: boolean
  allRows: HoldingRow[]
  holdingAll: HoldingRow[]
  onRefresh: () => void
  onOpenShare: () => void
  onOpenMaintenance: (mode: 'liquidateall' | 'holdingedit' | 'holdingrestore' | 'holdingdelete') => void
  selectedAccountKey: string
  onSelectAccount: (key: string) => void
  accountFolders: AccountFolder[]
  virtualCount: number
  summaryCount: number
  totalInvested: number
  adjustedUnrealized: number
  selectedAccountLabel: string
  serverTotal: number | null
  includeCost: boolean
  totalTradeCost: number
}

export default function PortfolioHeader({
  subtitle,
  onNavigateToCalendar,
  loading,
  refreshing,
  allRows,
  holdingAll,
  onRefresh,
  onOpenShare,
  onOpenMaintenance,
  selectedAccountKey,
  onSelectAccount,
  accountFolders,
  virtualCount,
  summaryCount,
  totalInvested,
  adjustedUnrealized,
  selectedAccountLabel,
  serverTotal,
  includeCost,
  totalTradeCost,
}: PortfolioHeaderProps) {
  return (
    <div className="portfolio-head-sheet">
    <table className="xls-table xls-fit" style={{ width: '100%', tableLayout: 'fixed' }}>
      <colgroup>
        <col style={{ width: '18%' }} />
        <col style={{ width: '18%' }} />
        <col style={{ width: '16%' }} />
        <col style={{ width: '16%' }} />
        <col style={{ width: '16%' }} />
        <col style={{ width: '16%' }} />
      </colgroup>
      <tbody>
        <tr className="xls-row xls-row--even">
          <td className="xls-cell" colSpan={6} style={{ padding: '8px 10px' }}>
            <SheetHeaderBar
              title="포트폴리오"
              subtitle={subtitle}
              action={<EconomicEventBadge onNavigateToCalendar={onNavigateToCalendar} />}
            />
          </td>
        </tr>
        <tr className="xls-row xls-row--even">
          <td className="xls-cell" colSpan={6} style={{ padding: '8px 10px' }}>
            <div className="portfolio-head-row">
              <div className="portfolio-head-controls">
                <Button variant="secondary" onClick={onRefresh} disabled={loading || refreshing}>
                  {refreshing ? '새로고침 중...' : '새로고침'}
                </Button>
                <span className="portfolio-total-pill">
                  {allRows.length > 0 ? `총 ${allRows.length}개` : '포지션 집계 준비중'}
                </span>
                <Button variant="secondary" onClick={onOpenShare} disabled={loading || holdingAll.length === 0}>공유 요약 보기</Button>
              </div>
              <div className="portfolio-head-maintenance" role="group" aria-label="포트폴리오 유지보수 작업">
                <span className="caption muted" style={{ whiteSpace: 'nowrap' }}>유지보수</span>
                <Button variant="secondary" size="sm" onClick={() => onOpenMaintenance('holdingrestore')} disabled={loading}>
                  계좌/보유 추가
                </Button>
                <Button variant="secondary" size="sm" onClick={() => onOpenMaintenance('liquidateall')} disabled={loading || holdingAll.length === 0}>
                  전체매도
                </Button>
              </div>
            </div>
          </td>
        </tr>
        <tr className="xls-row">
          <td className="xls-cell" colSpan={6} style={{ padding: '8px 10px' }}>
            <div className="portfolio-account-tabs" style={{ display: 'flex', gap: 'var(--space-1)', padding: '0', overflowX: 'auto' }}>
              <AccountTab active={selectedAccountKey === 'all'} onClick={() => onSelectAccount('all')}>전체</AccountTab>
              <AccountTab active={selectedAccountKey === 'virtual'} onClick={() => onSelectAccount('virtual')}>가상매매 ({virtualCount})</AccountTab>
              {accountFolders.map((account) => (
                <AccountTab
                  key={account.key}
                  active={selectedAccountKey === account.key}
                  onClick={() => onSelectAccount(account.key)}
                  title={`${accountLabel(account.brokerName, account.accountName)} (${account.count})`}
                >
                  {accountLabel(account.brokerName, account.accountName)} ({account.count})
                </AccountTab>
              ))}
            </div>
          </td>
        </tr>
        <tr className="xls-row xls-row--even portfolio-summary-row portfolio-summary-row--label">
          <td className="xls-cell" colSpan={2} style={{ fontSize: 13, fontWeight: 600 }}>보유 종목</td>
          <td className="xls-cell" colSpan={2} style={{ fontSize: 13, fontWeight: 600 }}>현재 실제 매수금</td>
          <td className="xls-cell" colSpan={2} style={{ fontSize: 13, fontWeight: 600 }}>평가손익 합계</td>
        </tr>
        <tr className="xls-row portfolio-summary-row portfolio-summary-row--value">
          <td className="xls-cell portfolio-cell-num" colSpan={2} style={{ fontSize: 18, fontWeight: 700 }}>{summaryCount}</td>
          <td className="xls-cell portfolio-cell-num" colSpan={2} style={{ fontSize: 18, fontWeight: 700 }}>{formatKrwCompact(totalInvested)}</td>
          <td className="xls-cell portfolio-cell-num" colSpan={2} style={{ fontSize: 18, fontWeight: 700 }}>
            <span className={adjustedUnrealized < 0 ? 'negative' : 'positive'}>{formatKrwCompact(adjustedUnrealized, { showPositiveSign: true })}</span>
          </td>
        </tr>
        <tr className="xls-row xls-row--even portfolio-summary-row portfolio-summary-row--note">
          <td className="xls-cell" colSpan={2} style={{ color: 'var(--color-text-tertiary)', fontSize: 11 }}>
            {selectedAccountLabel}
            {serverTotal != null && allRows.length < serverTotal ? ` · 전체 집계 중 (${allRows.length}/${serverTotal})` : ''}
          </td>
          <td className="xls-cell portfolio-cell-num" colSpan={2} style={{ color: 'var(--color-text-tertiary)', fontSize: 11 }}>보유 수량×평균 매수가</td>
          <td className="xls-cell portfolio-cell-num" colSpan={2} style={{ color: 'var(--color-text-tertiary)', fontSize: 11 }}>
            {includeCost
              ? `비용 ${formatKrwCompact(Math.round(totalTradeCost))} 차감`
              : '보유 포지션 기준'}
          </td>
        </tr>
      </tbody>
    </table>
    </div>
  )
}
