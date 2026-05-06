import React, { useEffect, useState } from 'react'
import Modal from './Modal'
import Skeleton from './Skeleton'
import { apiFetch } from '../lib/api'

type DetailSeriesRow = {
  date: string
  close: number | null
  high: number | null
  low: number | null
  open: number | null
  volume: number | null
  value: number | null
}

type DetailMeta = {
  latest: DetailSeriesRow | null
  profile: {
    market_cap?: number | null
    per?: number | null
    pbr?: number | null
    eps?: number | null
    bps?: number | null
    roe?: number | null
    debt_ratio?: number | null
    fundamentals_as_of?: string | null
    foreign_ratio?: number | null
  } | null
  flow: {
    date?: string | null
    foreign?: number | null
    institution?: number | null
  } | null
}

type Props = {
  code?: string
  name?: string
  isOpen: boolean
  onClose: () => void
}

function asNum(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function formatDateKst(v: unknown): string {
  if (!v) return '-'
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatNumber(v: unknown, decimals?: number): string {
  const n = asNum(v)
  if (n == null) return '-'
  if (decimals != null) {
    return n.toLocaleString('ko-KR', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  }
  return n.toLocaleString('ko-KR')
}

function formatWon(v: unknown): string {
  const n = asNum(v)
  if (n == null) return '-'
  return `${n.toLocaleString('ko-KR')}원`
}

export default function StockDetailModal({ code, name, isOpen, onClose }: Props) {
  const [detailData, setDetailData] = useState<DetailSeriesRow[] | null>(null)
  const [detailMeta, setDetailMeta] = useState<DetailMeta | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen || !code) return

    let disposed = false
    const run = async () => {
      setLoading(true)
      setError(null)
      setDetailData(null)
      setDetailMeta(null)

      try {
        const res = await apiFetch(`/api/ui/stock-latest?code=${encodeURIComponent(code)}`, {
          cacheMs: 0,
          timeoutMs: 10_000,
        })

        const data = res?.data ?? []
        const normalized = Array.isArray(data)
          ? data.map((it: any) => ({
              date: formatDateKst(it.date ?? it.timestamp ?? null),
              open: asNum(it.open ?? it.o),
              close: asNum(it.close ?? it.c),
              high: asNum(it.high ?? it.h),
              low: asNum(it.low ?? it.l),
              volume: asNum(it.volume ?? it.v),
              value: asNum(it.value ?? it.amount ?? it.trading_value),
            }))
          : []

        if (disposed) return
        setDetailData(normalized)
        setDetailMeta({
          latest: res?.latest
            ? {
                date: formatDateKst(res.latest.date),
                open: asNum(res.latest.open),
                close: asNum(res.latest.close),
                high: asNum(res.latest.high),
                low: asNum(res.latest.low),
                volume: asNum(res.latest.volume),
                value: asNum(res.latest.value),
              }
            : normalized[0] ?? null,
          profile: res?.profile ?? null,
          flow: res?.flow ?? null,
        })
      } catch (e: any) {
        if (disposed) return
        setError(String(e?.message || e))
        setDetailData([])
      } finally {
        if (!disposed) setLoading(false)
      }
    }

    void run()
    return () => {
      disposed = true
    }
  }, [isOpen, code])

  return (
    <Modal
      isOpen={isOpen}
      title={code ? `${name || code} (${code}) 시세` : '종목 시세'}
      onClose={onClose}
      size="sm"
    >
      {loading && <Skeleton lines={6} height={14} />}
      {!loading && error && <div className="muted">조회 실패: {error}</div>}
      {!loading && !error && detailData?.length === 0 && (
        <div className="muted">시세 데이터 없음</div>
      )}
      {!loading && !error && detailData && detailData.length > 0 && (
        <div className="dbview-detail-list">
          {detailMeta?.latest && (
            <div className="dbview-detail-summary">
              <div className="dbview-detail-summary-head">최신 기준 {detailMeta.latest.date}</div>
              <div className="dbview-detail-summary-grid">
                <div>종가 <strong>{formatNumber(detailMeta.latest.close)}</strong></div>
                <div className="caption muted">시가 {formatNumber(detailMeta.latest.open)}</div>
                <div className="caption muted">고가 {formatNumber(detailMeta.latest.high)}</div>
                <div className="caption muted">저가 {formatNumber(detailMeta.latest.low)}</div>
                <div className="caption muted">거래량 {formatNumber(detailMeta.latest.volume)}</div>
                <div className="caption muted">거래대금 {formatWon(detailMeta.latest.value)}</div>
              </div>
            </div>
          )}

          {(detailMeta?.profile || detailMeta?.flow) && (
            <div className="dbview-detail-summary-grid dbview-detail-meta-grid">
              <div className="caption muted">시총 {formatWon(detailMeta?.profile?.market_cap)}</div>
              <div className="caption muted">PER {formatNumber(detailMeta?.profile?.per, 2)}</div>
              <div className="caption muted">PBR {formatNumber(detailMeta?.profile?.pbr, 2)}</div>
              <div className="caption muted">EPS {formatNumber(detailMeta?.profile?.eps)}</div>
              <div className="caption muted">BPS {formatNumber(detailMeta?.profile?.bps)}</div>
              <div className="caption muted">ROE {detailMeta?.profile?.roe == null ? '-' : `${formatNumber(detailMeta.profile.roe, 2)}%`}</div>
              <div className="caption muted">부채비율 {detailMeta?.profile?.debt_ratio == null ? '-' : `${formatNumber(detailMeta.profile.debt_ratio, 2)}%`}</div>
              <div className="caption muted">외국인지분율 {detailMeta?.profile?.foreign_ratio == null ? '-' : `${formatNumber(detailMeta.profile.foreign_ratio, 2)}%`}</div>
              <div className="caption muted">수급(외국인) {formatNumber(detailMeta?.flow?.foreign)}</div>
              <div className="caption muted">수급(기관) {formatNumber(detailMeta?.flow?.institution)}</div>
              <div className="caption muted">재무기준일 {detailMeta?.profile?.fundamentals_as_of ? formatDateKst(detailMeta.profile.fundamentals_as_of) : '-'}</div>
              <div className="caption muted">수급기준일 {detailMeta?.flow?.date ? formatDateKst(detailMeta.flow.date) : '-'}</div>
            </div>
          )}

          {detailData.map((d: DetailSeriesRow, i: number) => (
            <div key={i} className="dbview-detail-row">
              <span className="caption muted">{d.date}</span>
              <span>종가 <strong>{formatNumber(d.close)}</strong></span>
              <span className="caption muted">시 {formatNumber(d.open)} / 고 {formatNumber(d.high)} / 저 {formatNumber(d.low)}</span>
              <span className="caption muted">거래량 {formatNumber(d.volume)}</span>
              <span className="caption muted">거래대금 {formatWon(d.value)}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
