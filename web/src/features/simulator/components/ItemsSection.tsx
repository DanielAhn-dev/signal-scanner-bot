import React from 'react'
import ItemCard from './ItemCard'
import { formatKrw } from '../../../lib/format'
import AnchoredDropdown from '../../../components/AnchoredDropdown'
import { EmptyState } from '../../../components/StateViews'
import type { calcPositionStatus } from '../telegramFormat'
import type { HighlightPlanItem } from '../planStore'
import type { calcItemMeta } from '../lib/summary'

export type ItemsSectionProps = {
  totalCapital: number
  items: HighlightPlanItem[]
  expandedIdx: number | null
  setExpandedIdx: React.Dispatch<React.SetStateAction<number | null>>
  addSearch: string
  setAddSearch: React.Dispatch<React.SetStateAction<string>>
  addResults: any[]
  setAddResults: React.Dispatch<React.SetStateAction<any[]>>
  setAddFocused: React.Dispatch<React.SetStateAction<boolean>>
  addWrapRef: React.RefObject<HTMLDivElement>
  itemMeta: ReturnType<typeof calcItemMeta>
  statusMeta: ReturnType<typeof calcPositionStatus>[]
  updateItem: (idx: number, patch: Partial<HighlightPlanItem>) => void
  addRow: (stock?: { code: string; name: string }) => void
  removeRow: (idx: number) => void
  showAddDropdown: boolean
}

export default function ItemsSection({
  totalCapital,
  items,
  expandedIdx,
  setExpandedIdx,
  addSearch,
  setAddSearch,
  addResults,
  setAddResults,
  setAddFocused,
  addWrapRef,
  itemMeta,
  statusMeta,
  updateItem,
  addRow,
  removeRow,
  showAddDropdown,
}: ItemsSectionProps) {
  return (
    <div className="sim-section">
      <div className="sim-section-head">
        <div>
          <span className="sim-section-label">종목별 집행안</span>
          <span className="sim-section-count">{items.length}개</span>
        </div>
      </div>

      {/* 종목 검색 추가 */}
      <div className="sim-add-wrap" ref={addWrapRef}>
        <div className="sim-add-input-row">
          <svg className="sim-add-icon" width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M8 5v6M5 8h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            className="sim-add-input"
            placeholder="종목명 또는 코드로 검색 후 추가"
            value={addSearch}
            onChange={(e) => setAddSearch(e.target.value)}
            onFocus={() => setAddFocused(true)}
            onBlur={() => setTimeout(() => setAddFocused(false), 150)}
          />
          {addSearch && (
            <button className="sim-add-clear" onClick={() => { setAddSearch(''); setAddResults([]) }}>×</button>
          )}
          <button className="sim-btn sim-btn--ghost sim-btn--sm" onClick={() => addRow()}>빈 행 추가</button>
        </div>
        {showAddDropdown && (
          <AnchoredDropdown anchorRef={addWrapRef} className="sim-add-dropdown">
            {addResults.length === 0
              ? <div className="sim-add-empty">검색 결과 없음</div>
              : addResults.slice(0, 6).map((s: any) => (
                <button key={s.code} className="sim-add-result" onClick={() => addRow({ code: String(s.code), name: String(s.name ?? s.code) })}>
                  <span className="sim-add-result-name">{s.name ?? s.code}</span>
                  <span className="sim-add-result-code">{s.code}</span>
                  <span className="sim-add-result-action">+ 추가</span>
                </button>
              ))
            }
          </AnchoredDropdown>
        )}
      </div>

      {/* ── 이번 주 집행 요약 ── */}
      {items.filter(i => i.code !== 'CASH').length > 0 && (() => {
        const signals = statusMeta.filter((_s, i) => items[i]?.code !== 'CASH')
        const takeProfitItems = signals.filter(s => s.status === 'take_profit')
        const nearProfitItems = signals.filter(s => s.status === 'near_profit')
        const stopLossItems = signals.filter(s => s.status === 'stop_loss')
        const nearStopItems = signals.filter(s => s.status === 'near_stop')
        const holdItems = signals.filter(s => s.status === 'hold')
        const hasAnySignal = takeProfitItems.length > 0 || stopLossItems.length > 0
        const realizedOnSignal = items
          .filter((_, i) => items[i]?.code !== 'CASH' && (statusMeta[i]?.status === 'take_profit' || statusMeta[i]?.status === 'stop_loss'))
          .reduce((acc, _, i) => acc + (statusMeta[i]?.unrealizedKrw ?? 0), 0)
        const hasPositions = items.some(i => i.code !== 'CASH' && (i.buyPrice ?? 0) > 0 && (i.shares ?? 0) > 0)
        if (!hasPositions) return null
        return (
          <div className="sim-weekly-summary">
            <div className="sim-weekly-summary-head">
              <span className="sim-weekly-summary-title">이번 주 집행 신호</span>
              {hasAnySignal && (
                <span className={`sim-weekly-realized ${realizedOnSignal >= 0 ? 'sim-pos' : 'sim-neg'}`}>
                  신호대로 실행 시 {realizedOnSignal >= 0 ? '+' : ''}{formatKrw(realizedOnSignal)}
                </span>
              )}
            </div>
            <div className="sim-weekly-signals">
              {takeProfitItems.length > 0 && (
                <span className="sim-signal-tag sim-signal-tag--profit">익절 신호 {takeProfitItems.length}종목</span>
              )}
              {nearProfitItems.length > 0 && (
                <span className="sim-signal-tag sim-signal-tag--near-profit">목표가 근접 {nearProfitItems.length}종목</span>
              )}
              {nearStopItems.length > 0 && (
                <span className="sim-signal-tag sim-signal-tag--near-stop">손절가 근접 {nearStopItems.length}종목</span>
              )}
              {stopLossItems.length > 0 && (
                <span className="sim-signal-tag sim-signal-tag--stop">손절 신호 {stopLossItems.length}종목</span>
              )}
              {holdItems.length > 0 && (
                <span className="sim-signal-tag sim-signal-tag--hold">보유 유지 {holdItems.length}종목</span>
              )}
            </div>
          </div>
        )
      })()}

      {items.length === 0
        ? <EmptyState title="집행안이 비어 있습니다" description="위 검색창으로 종목을 추가하세요." />
        : (
          <div className="sim-stock-list">
            {items.map((row, idx) => {
              const meta = itemMeta[idx]
              const isOpen = expandedIdx === idx

              return (
                <ItemCard
                  key={`${row.code || 'row'}-${idx}`}
                  row={row}
                  idx={idx}
                  totalCapital={totalCapital}
                  meta={meta}
                  status={statusMeta[idx]}
                  isOpen={isOpen}
                  setExpandedIdx={setExpandedIdx}
                  updateItem={updateItem}
                  removeRow={removeRow}
                />
              )
            })}
          </div>
        )
      }
    </div>
  )
}
