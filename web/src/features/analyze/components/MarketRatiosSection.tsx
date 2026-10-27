import React from 'react'
import { formatKrw, formatNumber } from '../../../lib/format'
import { DIVIDER } from './Divider'
import { formatDate } from '../lib/dates'

export type MarketRatiosSectionProps = {
  result: any
}

export default function MarketRatiosSection({
  result,
}: MarketRatiosSectionProps) {
  return (
    <>
        {/* ── 시장 데이터 ── */}
        <div className="cards-grid cols-2">
          {([
            ['날짜', formatDate(result.date)],
            ['시가', result.open != null ? formatKrw(result.open) : '—'],
            ['고가', result.high != null ? formatKrw(result.high) : '—'],
            ['저가', result.low != null ? formatKrw(result.low) : '—'],
            ['거래량', result.volume != null ? formatNumber(result.volume, 0) : '—'],
            ['시가총액', result.market_cap != null ? formatKrw(result.market_cap) : '—'],
          ] as [string, string][]).map(([label, val]) => (
            <div key={label}>
              <div className="stat-label">{label}</div>
              <div className="stat-value" style={{ fontSize: 'var(--font-size-lg)', color: val === '—' ? 'var(--color-text-disabled)' : undefined }}>{val}</div>
            </div>
          ))}
        </div>

        {DIVIDER}

        {/* ── 투자지표 ── */}
        <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>투자지표</div>
        <div className="cards-grid cols-3">
          {([
            { label: 'PER', val: result.per != null ? formatNumber(result.per, 2) : '—' },
            { label: 'PBR', val: result.pbr != null ? formatNumber(result.pbr, 2) : '—' },
            {
              label: 'PEG',
              val: result.peg != null ? formatNumber(result.peg, 2) : '—',
              tag: result?.peg_meta?.label ?? null,
              hint:
                result?.peg_meta?.growthPct != null
                  ? `${result?.peg_meta?.growthBasis === 'net_income_forward'
                    ? '순이익 선행성장률'
                    : result?.peg_meta?.growthBasis === 'op_income'
                    ? '영업이익성장률'
                    : result?.peg_meta?.growthBasis === 'sales'
                      ? '매출성장률'
                      : '순이익성장률'} ${formatNumber(result.peg_meta.growthPct, 2)}% 기반`
                  : '성장률 데이터 부족 시 신뢰도 낮음',
            },
            { label: 'EPS', val: result.eps != null ? formatKrw(result.eps) : '—' },
            { label: 'BPS', val: result.bps != null ? formatKrw(result.bps) : '—' },
            { label: 'ROE', val: result.roe != null ? formatNumber(result.roe, 2) + '%' : '—' },
            { label: '부채비율', val: result.debt_ratio != null ? formatNumber(result.debt_ratio, 2) + '%' : '—' },
            {
              // 봇 신규 매수 제외 기준과 같은 판정 (src/services/fundamentalQualityGate.ts)
              label: '봇 실적 관문',
              val:
                result?.fundamental_gate?.status === 'pass'
                  ? '통과'
                  : result?.fundamental_gate?.status === 'fail'
                    ? '봇 매수 제외'
                    : result?.fundamental_gate?.status === 'unknown'
                      ? '판정 불가'
                      : '—',
              hint:
                result?.fundamental_gate?.status === 'pass'
                  ? '최근 4분기 흑자 · 최근 분기 영업이익이 1년 전보다 증가'
                  : result?.operating_loss_streak
                    ? `최근 ${result.operating_loss_streak.quarters}분기 연속 영업적자 — 검증(상위 300, 2017~)에서 60거래일 −20% 이하 손실이 평소보다 약 14%p 잦았음(중소형·미국 종목에서도 같은 방향). 매도 신호가 아닌 주의 표시`
                    : result?.fundamental_gate?.reason ?? '적자·영업이익 감소 종목은 8년 검증에서 평균보다 부진',
            },
          ] as { label: string; val: string; tag?: string | null; hint?: string }[]).map(({ label, val, tag, hint }) => (
            <div key={label}>
              <div className="stat-label" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                <span>{label}</span>
                {tag && (
                  <span
                    style={{
                      fontSize: 'var(--font-size-xs)',
                      padding: '1px 6px',
                      borderRadius: 999,
                      background:
                        tag === '실데이터'
                          ? 'var(--color-success-bg)'
                          : tag === '추정치'
                            ? 'var(--color-warning-bg)'
                            : 'var(--color-error-bg)',
                      color:
                        tag === '실데이터'
                          ? 'var(--color-success)'
                          : tag === '추정치'
                            ? 'var(--color-warning)'
                            : 'var(--color-error)',
                    }}
                  >
                    {tag}
                  </span>
                )}
              </div>
              <div className="stat-value" style={{ fontSize: 'var(--font-size-base)', color: val === '—' ? 'var(--color-text-disabled)' : undefined }}>{val}</div>
              {hint && (
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                  {hint}
                </div>
              )}
            </div>
          ))}
        </div>
        {result.fundamentals_as_of && (
          <div className="caption" style={{ marginTop: 'var(--space-2)' }}>
            재무 기준일: {formatDate(result.fundamentals_as_of)}
          </div>
        )}

        {DIVIDER}
    </>
  )
}
