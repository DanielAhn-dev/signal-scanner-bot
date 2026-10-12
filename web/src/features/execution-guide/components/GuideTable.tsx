import React from 'react'
import { formatKrw, formatNumber } from '../../../lib/format'
import { formatRowDataAsOf } from '../lib/news'
import type { GuideRow } from '../types'

export type GuideTableProps = {
  loading: boolean
  rows: GuideRow[]
  compactView: boolean
}

export default function GuideTable({
  loading,
  rows,
  compactView,
}: GuideTableProps) {
  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="xls-scroll-frame execution-guide-table-wrap" style={{ ['--xls-table-min-width' as any]: '980px' }}>
        <table className="xls-table execution-guide-table" style={{ width: 'max-content', minWidth: '100%', tableLayout: 'auto' }}>
        <colgroup>
          <col style={{ width: compactView ? '25%' : '24%' }} />
          <col style={{ width: compactView ? '26%' : '28%' }} />
          <col style={{ width: compactView ? '19%' : '20%' }} />
          <col style={{ width: compactView ? '30%' : '28%' }} />
        </colgroup>
        <thead>
          <tr className="xls-header-row">
            <th className="xls-th">종목</th>
            <th className="xls-th">진입/손절/목표</th>
            <th className="xls-th">수량/주문</th>
            <th className="xls-th">가이드</th>
          </tr>
        </thead>
          <tbody>
            {loading && (
            <tr className="xls-row">
              <td colSpan={4} className="xls-cell" style={{ color: 'var(--color-text-secondary)' }}>
                종목 분석과 뉴스를 조합해 실행 가이드를 생성 중입니다.
              </td>
            </tr>
            )}
            {!loading && rows.map((row, idx) => (
            <tr key={row.code} className={`xls-row${idx % 2 ? ' xls-row--even' : ''}`}>
              <td className="xls-cell" style={{ verticalAlign: 'top' }}>
                <div className="execution-guide-stock-title">{row.name} ({row.code})</div>
                <div className="execution-guide-kv-line">
                  <span className="execution-guide-kv-label">데이터일자</span>
                  <span className="execution-guide-kv-value">{formatRowDataAsOf(row.marketDataDate, row.newsDataDate)}</span>
                </div>
                <div className="execution-guide-kv-line">
                  <span className="execution-guide-kv-label">점수/판정</span>
                  <span className="execution-guide-kv-value">{row.score != null ? formatNumber(row.score, 1) : '—'} / {row.statusLabel || '—'}</span>
                </div>
                {row.summary && <div className="execution-guide-summary">{row.summary}</div>}
              </td>
              <td className="xls-cell" style={{ verticalAlign: 'top' }}>
                <div className="execution-guide-kv-line">
                  <span className="execution-guide-kv-label">진입</span>
                  <span className="execution-guide-kv-value">{row.entryLow != null && row.entryHigh != null ? `${formatKrw(row.entryLow)} ~ ${formatKrw(row.entryHigh)}` : '—'}</span>
                </div>
                <div className="execution-guide-kv-line">
                  <span className="execution-guide-kv-label">기준가</span>
                  <span className="execution-guide-kv-value">{row.entryRef != null ? formatKrw(row.entryRef) : '—'}</span>
                </div>
                <div className="execution-guide-kv-line">
                  <span className="execution-guide-kv-label">손절</span>
                  <span className="execution-guide-kv-value">{row.stopPrice != null ? formatKrw(row.stopPrice) : '—'}</span>
                </div>
                <div className="execution-guide-kv-line">
                  <span className="execution-guide-kv-label">목표1</span>
                  <span className="execution-guide-kv-value">{row.target1 != null ? formatKrw(row.target1) : '—'}{row.target1Pct != null ? ` (${formatNumber(row.target1Pct * 100, 1)}%)` : ''}</span>
                </div>
                {!compactView && (
                  <div className="execution-guide-kv-line">
                    <span className="execution-guide-kv-label">목표2</span>
                    <span className="execution-guide-kv-value">{row.target2 != null ? formatKrw(row.target2) : '—'}{row.target2Pct != null ? ` (${formatNumber(row.target2Pct * 100, 1)}%)` : ''}</span>
                  </div>
                )}
              </td>
              <td className="xls-cell" style={{ verticalAlign: 'top' }}>
                <div className="execution-guide-kv-line">
                  <span className="execution-guide-kv-label">예산</span>
                  <span className="execution-guide-kv-value">{formatKrw(row.plannedBudget)}</span>
                </div>
                <div className="execution-guide-kv-line">
                  <span className="execution-guide-kv-label">권장 수량</span>
                  <span className="execution-guide-kv-value">{row.qty.toLocaleString()}주</span>
                </div>
                {!compactView && (
                  <>
                    <div className="execution-guide-kv-line">
                      <span className="execution-guide-kv-label">1회 주문</span>
                      <span className="execution-guide-kv-value">{formatKrw(row.firstOrderAmount)}</span>
                    </div>
                    <div className="execution-guide-kv-line">
                      <span className="execution-guide-kv-label">손익비</span>
                      <span className="execution-guide-kv-value">{row.riskReward != null ? row.riskReward.toFixed(1) : '—'}</span>
                    </div>
                    <div className="execution-guide-kv-line">
                      <span className="execution-guide-kv-label">보유</span>
                      <span className="execution-guide-kv-value">{row.holdDays ? `${row.holdDays[0]}~${row.holdDays[1]}일` : '—'}</span>
                    </div>
                  </>
                )}
              </td>
              <td className="xls-cell" style={{ verticalAlign: 'top' }}>
                {row.warnings.length > 0 && (
                  <div className="execution-guide-warning">{row.warnings.join(' / ')}</div>
                )}
                {(compactView ? row.headlines.slice(0, 1) : row.headlines).length > 0 ? (
                  <ul className="execution-guide-headline-list">
                    {(compactView ? row.headlines.slice(0, 1) : row.headlines).map((headline, hIdx) => (
                      <li key={`${row.code}-h-${hIdx}`} className="caption execution-guide-headline-item">{headline}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="caption">뉴스 요약 없음</div>
                )}
                {compactView && row.headlines.length > 1 && (
                  <div className="caption" style={{ marginTop: 4 }}>외 {row.headlines.length - 1}건</div>
                )}
              </td>
            </tr>
            ))}
            {!loading && rows.length === 0 && (
            <tr className="xls-row">
              <td colSpan={4} className="xls-cell" style={{ color: 'var(--color-text-tertiary)' }}>
                종목 코드를 입력한 뒤 가이드 생성을 눌러 주세요.
              </td>
            </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
