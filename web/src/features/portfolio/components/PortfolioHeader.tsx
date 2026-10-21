import React from 'react'
import { Check } from 'lucide-react'
import Button from '../../../components/ui/Button'
import EconomicEventBadge from '../../../components/EconomicEventBadge'
import SheetHeaderBar from '../../../components/SheetHeaderBar'
import { formatKrwCompact } from '../../../lib/format'
import type { AccountFolder } from '../types'
import { accountLabel } from '../lib/accountKey'
import {
  ACCOUNT_SHEET_THRESHOLD, ALIAS_MAX_LENGTH, DEFAULT_TOP_LABEL, accountDotColor, aliasTaken, cleanAlias, displayAccountName,
  type AccountAliases,
} from '../lib/accountAliases'
import Modal from '../../../components/Modal'
import Input from '../../../components/ui/Input'
import type { HoldingRow } from '../types'
import { useToast } from '../../../components/ToastProvider'
import { buildQuantityText, COPY_GROUP_OPTIONS, type CopyGroupMode } from '../lib/share'

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

// 선택 표시는 회색 배경 대신 강조색 글자+체크로 — 회색 띠는 모달 머리말과 비슷해 보였다
const pickerRowStyle = (active: boolean): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 48, padding: '0 var(--space-4)',
  border: 'none', background: 'transparent',
  color: active ? 'var(--color-brand)' : 'var(--color-text-primary)', fontWeight: active ? 'var(--font-weight-bold)' : 'normal', fontSize: 'var(--font-size-sm)',
  textAlign: 'left', cursor: 'pointer',
})
const pickerCount = (count: number, active: boolean) => (
  <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
    <span className="caption muted">{count}종목</span>
    <Check size={16} aria-hidden style={{ visibility: active ? 'visible' : 'hidden', color: 'var(--color-brand)' }} />
  </span>
)

type PortfolioHeaderProps = {
  aliases: AccountAliases
  onRenameAccount: (key: string, name: string) => void
  subtitle: string
  onNavigateToCalendar: () => void
  loading: boolean
  refreshing: boolean
  allRows: HoldingRow[]
  holdingAll: HoldingRow[]
  copyRows: HoldingRow[]
  onRefresh: () => void
  onOpenShare: () => void
  onOpenMaintenance: (mode: 'liquidateall' | 'holdingedit' | 'holdingrestore' | 'holdingdelete') => void
  selectedAccountKey: string
  onSelectAccount: (key: string) => void
  accountFolders: AccountFolder[]
  virtualCount: number
  realCount: number
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
  copyRows,
  onRefresh,
  onOpenShare,
  onOpenMaintenance,
  selectedAccountKey,
  onSelectAccount,
  accountFolders,
  aliases,
  onRenameAccount,
  virtualCount,
  realCount,
  summaryCount,
  totalInvested,
  adjustedUnrealized,
  selectedAccountLabel,
  serverTotal,
  includeCost,
  totalTradeCost,
}: PortfolioHeaderProps) {
  const toast = useToast()
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [renameKey, setRenameKey] = React.useState<string | null>(null)
  const [renameDraft, setRenameDraft] = React.useState('')
  const [renameError, setRenameError] = React.useState('')
  const useSheet = accountFolders.length >= ACCOUNT_SHEET_THRESHOLD
  const selectedFolder = accountFolders.find((f) => f.key === selectedAccountKey) ?? null
  const folderName = (f: { key: string; brokerName: string; accountName: string }) => displayAccountName(aliases, f.key, f.brokerName, f.accountName)
  // 이름 바꾸기 대상: 실험 계좌 → 'virtual', 폴더 선택 → 그 폴더, 그 외 → 위쪽 '내 계좌' 탭
  const renameTargetKey = selectedAccountKey === 'virtual' ? 'virtual' : selectedFolder ? selectedFolder.key : 'real'
  const defaultNameOf = (key: string) => {
    if (key === 'real' || key === 'virtual') return DEFAULT_TOP_LABEL[key]
    const f = accountFolders.find((x) => x.key === key)
    return f ? accountLabel(f.brokerName, f.accountName) : ''
  }
  const openRename = (key: string) => {
    setRenameKey(key)
    setRenameDraft(aliases[key] || '')
    setRenameError('')
  }
  const saveRename = () => {
    if (!renameKey) return
    const labels: Record<string, string> = { real: DEFAULT_TOP_LABEL.real, virtual: DEFAULT_TOP_LABEL.virtual }
    for (const f of accountFolders) labels[f.key] = accountLabel(f.brokerName, f.accountName)
    // 위쪽 탭끼리, 폴더끼리 겹치지 않게 같은 묶음 안에서만 비교한다
    const group = renameKey === 'real' || renameKey === 'virtual'
      ? { real: labels.real, virtual: labels.virtual }
      : Object.fromEntries(accountFolders.map((f) => [f.key, labels[f.key]]))
    if (aliasTaken(aliases, renameKey, renameDraft, group)) {
      setRenameError('같은 이름의 계좌가 이미 있습니다. 다른 이름을 써 주세요')
      return
    }
    onRenameAccount(renameKey, cleanAlias(renameDraft))
    setRenameKey(null)
  }
  const [copyMode, setCopyMode] = React.useState<CopyGroupMode>(() => {
    try {
      const saved = localStorage.getItem('portfolio.copyMode')
      return COPY_GROUP_OPTIONS.some((o) => o.value === saved) ? (saved as CopyGroupMode) : 'role'
    } catch { return 'role' }
  })
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
                <Button
                  variant="secondary"
                  disabled={loading || copyRows.length === 0}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(buildQuantityText(copyRows, copyMode))
                      toast.show('보유 종목을 복사했습니다')
                    } catch {
                      toast.show('복사에 실패했습니다')
                    }
                  }}
                >수량 복사</Button>
                <select
                  className="input"
                  aria-label="복사할 때 묶는 기준"
                  value={copyMode}
                  onChange={(e) => {
                    const v = e.target.value as CopyGroupMode
                    setCopyMode(v)
                    try { localStorage.setItem('portfolio.copyMode', v) } catch { /* 저장 못 해도 동작에는 영향 없음 */ }
                  }}
                >
                  {COPY_GROUP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="portfolio-head-maintenance" role="group" aria-label="포트폴리오 유지보수 작업">
                <span className="caption muted" style={{ whiteSpace: 'nowrap' }}>유지보수</span>
                <Button variant="secondary" size="sm" onClick={() => onOpenMaintenance('holdingrestore')} disabled={loading}>
                  계좌/보유 추가
                </Button>
                {/* 전체매도는 가상(실험) 계좌만 — 실계좌는 증권사에서 판 뒤 종목별로 기록한다 */}
                {selectedAccountKey === 'virtual' && (
                  <Button variant="secondary" size="sm" onClick={() => onOpenMaintenance('liquidateall')} disabled={loading || virtualCount === 0}>
                    가상 전체매도
                  </Button>
                )}
              </div>
            </div>
          </td>
        </tr>
        <tr className="xls-row">
          <td className="xls-cell" colSpan={6} style={{ padding: '8px 10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <div className="portfolio-account-tabs" style={{ display: 'flex', gap: 'var(--space-1)', padding: '0', overflowX: 'auto', flex: 1, minWidth: 0 }}>
                <AccountTab active={selectedAccountKey !== 'virtual'} onClick={() => onSelectAccount('real')}>{aliases.real || DEFAULT_TOP_LABEL.real} ({realCount})</AccountTab>
                <AccountTab active={selectedAccountKey === 'virtual'} onClick={() => onSelectAccount('virtual')}>{aliases.virtual || DEFAULT_TOP_LABEL.virtual} ({virtualCount})</AccountTab>
              </div>
              <Button variant="secondary" size="sm" style={{ flexShrink: 0, whiteSpace: 'nowrap' }} onClick={() => openRename(renameTargetKey)}>
                이름 바꾸기
              </Button>
            </div>
            {selectedAccountKey !== 'virtual' && accountFolders.length > 1 && !useSheet && (
            <div className="portfolio-account-tabs portfolio-account-tabs--sub" role="group" aria-label="실제 계좌 고르기" style={{ display: 'flex', gap: 'var(--space-1)', padding: '0', overflowX: 'auto' }}>
              <AccountTab active={selectedAccountKey === 'real'} onClick={() => onSelectAccount('real')}>전부</AccountTab>
              {accountFolders.map((account) => (
                <AccountTab
                  key={account.key}
                  active={selectedAccountKey === account.key}
                  onClick={() => onSelectAccount(account.key)}
                  title={`${folderName(account)} (${account.count})`}
                >
                  <span aria-hidden style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: accountDotColor(account.key), marginRight: 6 }} />
                  {folderName(account)} ({account.count})
                </AccountTab>
              ))}
            </div>
            )}
            {selectedAccountKey !== 'virtual' && accountFolders.length > 1 && useSheet && (
              <button
                type="button"
                className="portfolio-account-picker"
                aria-haspopup="dialog"
                onClick={() => setPickerOpen(true)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', minHeight: 44, marginTop: 'var(--space-2)', padding: '0 var(--space-3)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'transparent', color: 'var(--color-text-primary)', fontSize: 'var(--font-size-sm)', cursor: 'pointer' }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedFolder && <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: accountDotColor(selectedFolder.key), flexShrink: 0 }} />}
                  {selectedFolder ? `${folderName(selectedFolder)} (${selectedFolder.count})` : `모든 계좌 (${realCount})`}
                </span>
                <span className="caption muted" style={{ flexShrink: 0 }}>계좌 {accountFolders.length}개 · 고르기</span>
              </button>
            )}
            <Modal isOpen={pickerOpen} onClose={() => setPickerOpen(false)} title="계좌 고르기" size="sm">
              {/* 모달 안쪽 여백을 상쇄해 목록을 가장자리까지 채운다(모달 공통 여백은 그대로) */}
              <div role="listbox" aria-label="실제 계좌" style={{ display: 'flex', flexDirection: 'column', maxHeight: '60vh', overflowY: 'auto', margin: 'calc(-1 * var(--space-4)) calc(-1 * var(--spacing-card-lg)) calc(-1 * var(--spacing-card-lg))' }}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selectedAccountKey === 'real'}
                  onClick={() => { onSelectAccount('real'); setPickerOpen(false) }}
                  style={{ ...pickerRowStyle(selectedAccountKey === 'real'), borderBottom: '1px solid var(--color-border)' }}
                >
                  <span>모든 계좌</span>{pickerCount(realCount, selectedAccountKey === 'real')}
                </button>
                {accountFolders.map((account) => (
                  <div key={account.key} style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--color-border)', paddingRight: 'var(--space-3)' }}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selectedAccountKey === account.key}
                      onClick={() => { onSelectAccount(account.key); setPickerOpen(false) }}
                      style={{ ...pickerRowStyle(selectedAccountKey === account.key), flex: 1, minWidth: 0 }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <span aria-hidden style={{ width: 10, height: 10, borderRadius: '50%', background: accountDotColor(account.key), flexShrink: 0 }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{folderName(account)}</span>
                      </span>
                      {pickerCount(account.count, selectedAccountKey === account.key)}
                    </button>
                    <Button variant="ghost" size="sm" style={{ flexShrink: 0 }} onClick={() => { setPickerOpen(false); openRename(account.key) }}>수정</Button>
                  </div>
                ))}
              </div>
            </Modal>
            <Modal isOpen={renameKey !== null} onClose={() => setRenameKey(null)} title="계좌 이름 바꾸기" size="sm" closeOnBackdrop={false}>
              <div style={{ padding: 'var(--space-3)' }}>
                <div className="muted" style={{ marginBottom: 'var(--space-2)', wordBreak: 'keep-all' }}>
                  화면에 보이는 이름만 바뀝니다. 보유 종목과 증권사·계좌명 기록은 그대로입니다.
                </div>
                <Input
                  label="표시 이름"
                  value={renameDraft}
                  maxLength={ALIAS_MAX_LENGTH}
                  placeholder={renameKey ? defaultNameOf(renameKey) : ''}
                  onChange={(e: any) => { setRenameDraft(String(e?.target?.value || '')); setRenameError('') }}
                />
                {renameError && <div className="negative caption" style={{ marginTop: 4 }}>{renameError}</div>}
                <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', marginTop: 'var(--space-3)' }}>
                  <Button variant="secondary" onClick={() => { if (renameKey) { onRenameAccount(renameKey, ''); setRenameKey(null) } }}>기본 이름으로</Button>
                  <Button onClick={saveRename}>저장</Button>
                </div>
              </div>
            </Modal>
            {selectedAccountKey === 'virtual' && (
              <div className="caption muted" style={{ padding: '4px var(--space-3) 0', wordBreak: 'keep-all' }}>
                가상 계좌는 봇이 &lsquo;내 계획&rsquo;대로 자동으로 사고팝니다. 내가 직접 사는 내 계좌와 합치지 않습니다.
              </div>
            )}
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
