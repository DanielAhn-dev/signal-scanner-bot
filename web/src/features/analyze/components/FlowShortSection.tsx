import React from 'react'
import { formatKrw, formatNumber } from '../../../lib/format'
import { formatFlowValue } from '../lib/flow'
import { formatDate, formatDateTime } from '../lib/dates'

export type FlowShortSectionProps = {
  result: any
  flow: any
  creditShort: any
  computedSma20: any
  computedSma50: any
  computedSma200: any
  computedEma20: any
  computedEma50: any
  computedEma200: any
  computedRsi14: any
  flowMetricLabel: string | null
  showExtendedIndicators: boolean
  setShowExtendedIndicators: React.Dispatch<React.SetStateAction<boolean>>
}

export default function FlowShortSection({
  result,
  flow,
  creditShort,
  computedSma20,
  computedSma50,
  computedSma200,
  computedEma20,
  computedEma50,
  computedEma200,
  computedRsi14,
  flowMetricLabel,
  showExtendedIndicators,
  setShowExtendedIndicators,
}: FlowShortSectionProps) {
  return (
    <>
        {/* ── 수급/기술 ── */}
        <div className="analyze-section-head">
          <div className="analyze-section-head__title">
            <div className="title-md">수급/기술</div>
          </div>
          <button
            className="btn btn-sm analyze-section-head__action"
            type="button"
            onClick={() => setShowExtendedIndicators((v) => !v)}
            aria-pressed={showExtendedIndicators}
          >
            {showExtendedIndicators ? '확장 지표 숨기기' : '확장 지표 보기'}
          </button>
        </div>
        <div className="cards-grid cols-3">
          {([
            result.foreign_ratio != null
              ? ['외국인 보유비율', formatNumber(result.foreign_ratio, 2) + '%']
              : null,
            flowMetricLabel && flow?.personal != null
              ? [`개인 순매수(${flowMetricLabel})`, formatFlowValue(flow.personal, flow?.metric)]
              : null,
            flowMetricLabel && flow?.foreign != null
              ? [`외국인 순매수(${flowMetricLabel})`, formatFlowValue(flow.foreign, flow?.metric)]
              : null,
            flowMetricLabel && flow?.institution != null
              ? [`기관 순매수(${flowMetricLabel})`, formatFlowValue(flow.institution, flow?.metric)]
              : null,
            ['SMA 20', computedSma20 != null ? formatKrw(computedSma20) : '—'],
            ['SMA 50', computedSma50 != null ? formatKrw(computedSma50) : '—'],
            ['SMA 200', computedSma200 != null ? formatKrw(computedSma200) : '—'],
            ['RSI 14', computedRsi14 != null ? formatNumber(computedRsi14, 1) : '—'],
            ...(showExtendedIndicators
              ? ([
                  ['EMA 20', computedEma20 != null ? formatKrw(computedEma20) : '—'],
                  ['EMA 50', computedEma50 != null ? formatKrw(computedEma50) : '—'],
                  ['EMA 200', computedEma200 != null ? formatKrw(computedEma200) : '—'],
                ] as [string, string][])
              : []),
          ].filter(Boolean) as [string, string][]).map(([label, val]) => (
            <div key={label}>
              <div className="stat-label">{label}</div>
              <div className="stat-value" style={{ fontSize: 'var(--font-size-base)', color: val === '—' ? 'var(--color-text-disabled)' : undefined }}>{val}</div>
            </div>
          ))}
        </div>
        <div className="caption" style={{ marginTop: 'var(--space-2)' }}>
          기술지표 기준일: {result.indicators_as_of ? formatDate(result.indicators_as_of) : '—'}
          {flow?.date ? ` · 수급 기준일: ${formatDate(flow.date)}` : ''}
        </div>

        {/* ── 공매도 / 신용 ── */}
        <div className="title-md" style={{ marginTop: 'var(--space-6)', marginBottom: 'var(--space-3)' }}>공매도 / 신용</div>
        <div className="cards-grid cols-3">
          {([
            {
              label: '신용비율',
              val: creditShort?.creditRatio != null ? formatNumber(creditShort.creditRatio, 2) + '%' : '—',
              hint: '신용잔고 ÷ 상장주식수',
              warn: creditShort?.creditRatio != null ? creditShort.creditRatio > 5 : false,
            },
            {
              label: '공매도 잔고비율',
              val: creditShort?.shortRatio != null ? formatNumber(creditShort.shortRatio, 2) + '%' : '—',
              hint: '공매도 잔고 ÷ 상장주식수',
              warn: creditShort?.shortRatio != null ? creditShort.shortRatio > 1 : false,
            },
            {
              label: '공매도 잔고(주)',
              val: creditShort?.shortBalance != null ? formatNumber(creditShort.shortBalance, 0) : '—',
              hint: '최근 KRX 신고 기준',
              warn: false,
            },
          ] as { label: string; val: string; hint: string; warn: boolean }[]).map(({ label, val, hint, warn }) => (
            <div key={label}>
              <div className="stat-label">{label}</div>
              <div className="stat-value" style={{
                fontSize: 'var(--font-size-base)',
                color: val === '—' ? 'var(--color-text-disabled)' : warn ? 'var(--color-error)' : undefined,
              }}>{val}</div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginTop: 2 }}>{hint}</div>
            </div>
          ))}
        </div>
        <div className="caption" style={{ marginTop: 'var(--space-2)' }}>
          {creditShort?.source === 'db' && `공매도/신용 기준일: ${creditShort.asOf ? formatDate(creditShort.asOf) : '—'}`}
          {creditShort?.source === 'live' && `공매도/신용 조회시각: ${creditShort.fetchedAt ? formatDateTime(creditShort.fetchedAt) : '—'} (실시간 스크래핑)`}
          {creditShort?.source === 'stale' && `공매도/신용 마지막 기준일: ${creditShort.staleAsOf ? formatDate(creditShort.staleAsOf) : '—'} · 오래된 데이터로 분석에서 제외`}
          {creditShort?.source === 'proxy' && '공매도/신용 실데이터 없음 · 프록시 리스크만 반영'}
          {!creditShort && '공매도/신용 데이터 없음'}
        </div>
        {creditShort?.staleReason && (
          <div className="caption" style={{ marginTop: 'var(--space-1)', color: 'var(--color-warning)' }}>
            주의: {creditShort.staleReason}
          </div>
        )}
    </>
  )
}
