import React from 'react'
import { Search, Link2, HelpCircle } from 'lucide-react'
import Button from '../../../components/ui/Button'
import StockSearchInput from '../../../components/StockSearchInput'
import SheetHeaderBar from '../../../components/SheetHeaderBar'
import EconomicEventBadge from '../../../components/EconomicEventBadge'
import type { StockItem } from '../../../lib/stockCache'

export type SearchHeaderProps = {
  query: string
  setQuery: React.Dispatch<React.SetStateAction<string>>
  result: any
  loading: boolean
  recentSearches: Array<{ code: string; name: string }>
  analyze: (code?: string) => void | Promise<void>
  handleStockSelect: (stock: StockItem) => void
  onShareAnalyze: () => void | Promise<void>
  addResultToSimulator: () => void
  sendResultToExecutionGuide: () => void
  onNavigate: ((route: string) => void) | undefined
}

export default function SearchHeader({
  query,
  setQuery,
  result,
  loading,
  recentSearches,
  analyze,
  handleStockSelect,
  onShareAnalyze,
  addResultToSimulator,
  sendResultToExecutionGuide,
  onNavigate,
}: SearchHeaderProps) {
  return (
      <table className="xls-table xls-card-table analyze-sheet__meta-table" style={{ width: '100%', tableLayout: 'fixed', marginBottom: 'var(--space-4)' }}>
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
                title="종목 분석"
                action={<EconomicEventBadge onNavigateToCalendar={() => onNavigate?.('economy')} />}
              />
            </td>
          </tr>
          <tr className="xls-row" style={{ position: 'relative', zIndex: 30 }}>
            <td
              className="xls-cell"
              colSpan={6}
              style={{
                padding: '8px 10px',
                overflow: 'visible',
                position: 'relative',
                zIndex: 30,
              }}
            >
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'nowrap', alignItems: 'center' }}>
                <div style={{ flex: '1 1 0', minWidth: 0 }}>
                  <StockSearchInput
                    value={query}
                    onChange={setQuery}
                    onSelect={handleStockSelect}
                    onSubmit={(v) => { void analyze(v) }}
                    placeholder="종목 코드(예: 005930) 또는 한글명(예: 삼성전자)"
                    disabled={loading}
                  />
                </div>
                <Button
                  variant="primary"
                  onClick={() => analyze()}
                  disabled={loading || !query.trim()}
                  aria-label="분석"
                  title="분석"
                  style={{ padding: '0 0.75rem', flexShrink: 0 }}
                >
                  {loading
                    ? <span style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                    : <Search size={16} />}
                </Button>
                <Button
                  variant="secondary"
                  onClick={onShareAnalyze}
                  disabled={loading || !result?.code}
                  aria-label="링크 공유"
                  title="링크 공유"
                  style={{ padding: '0 0.75rem', flexShrink: 0 }}
                >
                  <Link2 size={16} />
                </Button>
                <button
                  type="button"
                  aria-label="검색 도움말"
                  title={'종목 코드(6자리) 또는 종목명으로 검색합니다.\n텔레그램 /analyze 에 대응합니다.'}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '0 var(--space-1)',
                    color: 'var(--color-text-tertiary)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    flexShrink: 0,
                    lineHeight: 1,
                  }}
                >
                  <HelpCircle size={16} />
                </button>
              </div>
            </td>
          </tr>
          {recentSearches.length > 0 && (
            <tr className="xls-row xls-row--even">
              <td className="xls-cell" colSpan={2} style={{ color: 'var(--color-text-secondary)', fontSize: 11, fontWeight: 600 }}>
                최근 조회
              </td>
              <td className="xls-cell" colSpan={4} style={{ padding: '8px 10px' }}>
                <div
                  style={{
                    display: 'flex',
                    gap: 'var(--space-1)',
                    overflowX: 'auto',
                    WebkitOverflowScrolling: 'touch',
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none',
                    flexWrap: 'nowrap',
                  }}
                >
                  {recentSearches.map(s => (
                    <button
                      key={s.code}
                      className="tag"
                      style={{ flexShrink: 0 }}
                      onClick={() => { setQuery(s.code); void analyze(s.code) }}
                      title={s.code}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </td>
            </tr>
          )}
          {/* 흐름 4→5·6: 예전엔 분석 뒤 누를 게 없어 여기서 흐름이 끊겼다 */}
          {result?.code && !loading && (
            <tr className="xls-row">
              <td className="xls-cell" colSpan={2} style={{ color: 'var(--color-text-secondary)', fontSize: 11, fontWeight: 600 }}>
                다음 단계
              </td>
              <td className="xls-cell" colSpan={4} style={{ padding: '6px 10px' }}>
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <Button size="sm" onClick={() => addResultToSimulator()}>5 시뮬레이터에 추가</Button>
                  <Button size="sm" variant="secondary" onClick={() => sendResultToExecutionGuide()}>6 실행가이드로</Button>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
  )
}
