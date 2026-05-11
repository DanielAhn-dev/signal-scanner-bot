/**
 * CandleChart — lightweight-charts 기반 인터랙티브 캔들 차트
 * OhlcvCandle[] 배열을 받아 캔들스틱 + 볼륨 차트를 렌더링한다.
 */
import React, { useEffect, useRef } from 'react'
import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts'
import type { OhlcvCandle } from '../lib/types'

type Props = {
  candles: OhlcvCandle[]
  entryLow?: number | null
  entryHigh?: number | null
  stopLoss?: number | null
  target1?: number | null
  tradeSignal?: string | null
  symbolLabel?: string | null
  showMaEmaOverlay?: boolean
  showTradeMarkers?: boolean
  showForceLine?: boolean
  showLegend?: boolean
  height?: number
}

function toTimestamp(dateStr: string): number {
  // YYYY-MM-DD or YYYYMMDD → Unix seconds
  const normalized = dateStr.length === 8
    ? `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`
    : dateStr
  return Math.floor(new Date(normalized).getTime() / 1000)
}

type TimeValue = { time: any; value: number }

function computeSmaLine(candles: OhlcvCandle[], period: number): TimeValue[] {
  if (period <= 0) return []
  const out: TimeValue[] = []
  const queue: number[] = []
  let sum = 0
  for (const c of candles) {
    const close = Number(c.close)
    if (!Number.isFinite(close)) continue
    queue.push(close)
    sum += close
    if (queue.length > period) {
      sum -= queue.shift() || 0
    }
    if (queue.length === period) {
      out.push({
        time: toTimestamp(c.date) as any,
        value: Number((sum / period).toFixed(2)),
      })
    }
  }
  return out
}

function computeEmaLine(candles: OhlcvCandle[], period: number): TimeValue[] {
  if (period <= 0 || candles.length < period) return []
  const closes = candles.map((c) => Number(c.close)).filter((v) => Number.isFinite(v))
  if (closes.length < period) return []

  const k = 2 / (period + 1)
  let ema = closes.slice(0, period).reduce((acc, v) => acc + v, 0) / period
  const out: TimeValue[] = []

  for (let i = period - 1; i < candles.length; i += 1) {
    const close = Number(candles[i]?.close)
    if (!Number.isFinite(close)) continue
    if (i > period - 1) {
      ema = close * k + ema * (1 - k)
    }
    out.push({
      time: toTimestamp(candles[i].date) as any,
      value: Number(ema.toFixed(2)),
    })
  }

  return out
}

function computeForceLine(candles: OhlcvCandle[]): {
  center: TimeValue[]
  upper: TimeValue[]
  lower: TimeValue[]
} {
  if (!candles.length) return { center: [], upper: [], lower: [] }

  const center: TimeValue[] = []
  const upper: TimeValue[] = []
  const lower: TimeValue[] = []

  let cumPv = 0
  let cumVol = 0
  const trQueue: number[] = []
  let trSum = 0

  for (let i = 0; i < candles.length; i += 1) {
    const c = candles[i]
    const high = Number(c.high)
    const low = Number(c.low)
    const close = Number(c.close)
    const vol = Number(c.volume)
    if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) continue

    const typical = (high + low + close) / 3
    const safeVol = Number.isFinite(vol) && vol > 0 ? vol : 1
    cumPv += typical * safeVol
    cumVol += safeVol
    const avg = cumVol > 0 ? cumPv / cumVol : close

    const prevClose = i > 0 ? Number(candles[i - 1].close) : close
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose))
    trQueue.push(tr)
    trSum += tr
    if (trQueue.length > 14) {
      trSum -= trQueue.shift() || 0
    }
    const atr = trQueue.length ? trSum / trQueue.length : 0
    const band = atr * 1.2
    const time = toTimestamp(c.date) as any

    center.push({ time, value: Number(avg.toFixed(2)) })
    upper.push({ time, value: Number((avg + band).toFixed(2)) })
    lower.push({ time, value: Number((avg - band).toFixed(2)) })
  }

  return { center, upper, lower }
}

export default function CandleChart({
  candles,
  entryLow,
  entryHigh,
  stopLoss,
  target1,
  tradeSignal,
  symbolLabel,
  showMaEmaOverlay = true,
  showTradeMarkers = true,
  showForceLine = false,
  showLegend = true,
  height = 340,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick', any> | null>(null)
  const volSeriesRef = useRef<ISeriesApi<'Histogram', any> | null>(null)

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return

    const el = containerRef.current
    const isDark = document.documentElement.classList.contains('dark') ||
      window.matchMedia('(prefers-color-scheme: dark)').matches

    const bg = isDark ? '#0b1220' : '#fbfdff'
    const textColor = isDark ? '#9fb1c7' : '#5f6f86'
    const gridColor = isDark ? 'rgba(148,163,184,0.14)' : 'rgba(120,138,161,0.16)'
    const upColor = '#22ab94'
    const downColor = '#f7525f'

    const chart = createChart(el, {
      width: el.clientWidth,
      height,
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: bg }, textColor },
      grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: isDark ? 'rgba(148,163,184,0.55)' : 'rgba(100,116,139,0.45)', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#0ea5e9' },
        horzLine: { color: isDark ? 'rgba(148,163,184,0.55)' : 'rgba(100,116,139,0.45)', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#0ea5e9' },
      },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.2 } },
      localization: {
        locale: 'ko-KR',
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        fixLeftEdge: true,
      },
      handleScroll: true,
      handleScale: true,
    })

    chartRef.current = chart

    // 캔들 시리즈
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor,
      downColor,
      borderVisible: false,
      wickUpColor: upColor,
      wickDownColor: downColor,
      priceLineVisible: true,
      lastValueVisible: true,
    })
    candleSeriesRef.current = candleSeries

    // 볼륨 시리즈 (보조, 오버레이 방식)
    const volSeries = chart.addSeries(HistogramSeries, {
      color: '#26a69a',
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    })
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } })
    volSeriesRef.current = volSeries

    // 데이터 (오름차순 정렬)
    const sorted = [...candles].sort((a, b) => a.date.localeCompare(b.date))
    const candleData = sorted.map((c) => ({
      time: toTimestamp(c.date) as any,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }))
    const volData = sorted.map((c) => ({
      time: toTimestamp(c.date) as any,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(34,171,148,0.36)' : 'rgba(247,82,95,0.36)',
    }))

    candleSeries.setData(candleData)
    volSeries.setData(volData)

    if (showMaEmaOverlay) {
      const lineSpecs = [
        { label: 'SMA20', period: 20, type: 'sma' as const, color: '#f59e0b', width: 2 },
        { label: 'SMA50', period: 50, type: 'sma' as const, color: '#2dd4bf', width: 2 },
        { label: 'SMA200', period: 200, type: 'sma' as const, color: '#3b82f6', width: 2 },
        { label: 'EMA20', period: 20, type: 'ema' as const, color: '#fb923c', width: 1 },
        { label: 'EMA50', period: 50, type: 'ema' as const, color: '#34d399', width: 1 },
        { label: 'EMA200', period: 200, type: 'ema' as const, color: '#818cf8', width: 1 },
      ]

      for (const spec of lineSpecs) {
        const lineData =
          spec.type === 'sma'
            ? computeSmaLine(sorted, spec.period)
            : computeEmaLine(sorted, spec.period)
        if (!lineData.length) continue
        const lineSeries = chart.addSeries(LineSeries, {
          color: spec.color,
          lineWidth: spec.width,
          lineStyle: spec.type === 'ema' ? LineStyle.Dotted : LineStyle.Solid,
          title: spec.label,
          lastValueVisible: true,
          priceLineVisible: false,
        })
        lineSeries.setData(lineData)
      }
    }

    if (showForceLine) {
      const force = computeForceLine(sorted)
      if (force.center.length) {
        const centerSeries = chart.addSeries(LineSeries, {
          color: '#14b8a6',
          lineWidth: 3,
          lineStyle: LineStyle.Solid,
          title: '세력선',
          lastValueVisible: true,
          priceLineVisible: false,
        })
        centerSeries.setData(force.center)
      }
      if (force.upper.length) {
        const upperSeries = chart.addSeries(LineSeries, {
          color: 'rgba(20,184,166,0.55)',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          title: '세력 상단밴드',
          lastValueVisible: true,
          priceLineVisible: false,
        })
        upperSeries.setData(force.upper)
      }
      if (force.lower.length) {
        const lowerSeries = chart.addSeries(LineSeries, {
          color: 'rgba(20,184,166,0.55)',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          title: '세력 하단밴드',
          lastValueVisible: true,
          priceLineVisible: false,
        })
        lowerSeries.setData(force.lower)
      }
    }

    // 가격 라인 — 진입/손절/목표
    if (entryLow != null) {
      candleSeries.createPriceLine({ price: entryLow, color: '#22c55e', lineWidth: 1, lineStyle: 1, title: '진입 하단' })
    }
    if (entryHigh != null) {
      candleSeries.createPriceLine({ price: entryHigh, color: '#22c55e', lineWidth: 1, lineStyle: 1, title: '진입 상단' })
    }
    if (stopLoss != null) {
      candleSeries.createPriceLine({ price: stopLoss, color: '#ef4444', lineWidth: 1, lineStyle: 1, title: '손절' })
    }
    if (target1 != null) {
      candleSeries.createPriceLine({ price: target1, color: '#3b82f6', lineWidth: 1, lineStyle: 1, title: '목표1' })
    }

    if (showTradeMarkers && sorted.length) {
      const recent = sorted.slice(-20)
      const recentLows = recent.map((c) => Number(c.low)).filter((v) => Number.isFinite(v))
      const recentHighs = recent.map((c) => Number(c.high)).filter((v) => Number.isFinite(v))
      const support = recentLows.length ? Math.min(...recentLows) : null
      const resistance = recentHighs.length ? Math.max(...recentHighs) : null

      if (support != null) {
        candleSeries.createPriceLine({
          price: support,
          color: 'rgba(16,185,129,0.8)',
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          title: '지지',
        })
      }
      if (resistance != null) {
        candleSeries.createPriceLine({
          price: resistance,
          color: 'rgba(239,68,68,0.8)',
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          title: '저항',
        })
      }

      const markers: any[] = []
      const status = String(tradeSignal || '').toLowerCase()
      const last = sorted[sorted.length - 1]
      const lastTime = toTimestamp(last.date) as any

      if (status === 'strong_buy' || status === 'buy' || status === 'buy-now' || status === 'buy-on-pullback') {
        markers.push({
          time: lastTime,
          position: 'belowBar',
          color: '#22c55e',
          shape: 'arrowUp',
          text: status === 'strong_buy' || status === 'buy-now' ? '강력매수' : '매수',
        })
      }

      if (target1 != null) {
        const hitTarget = [...sorted].reverse().find((c) => Number(c.high) >= Number(target1))
        if (hitTarget) {
          markers.push({
            time: toTimestamp(hitTarget.date) as any,
            position: 'aboveBar',
            color: '#3b82f6',
            shape: 'arrowDown',
            text: '익절',
          })
        }
      }

      if (stopLoss != null) {
        const hitStop = [...sorted].reverse().find((c) => Number(c.low) <= Number(stopLoss))
        if (hitStop) {
          markers.push({
            time: toTimestamp(hitStop.date) as any,
            position: 'belowBar',
            color: '#ef4444',
            shape: 'arrowDown',
            text: '손절',
          })
        }
      }

      if (!markers.length && (status === 'partial_sell' || status === 'sell')) {
        markers.push({
          time: lastTime,
          position: 'aboveBar',
          color: status === 'partial_sell' ? '#3b82f6' : '#ef4444',
          shape: 'arrowDown',
          text: status === 'partial_sell' ? '익절' : '매도',
        })
      }

      if (markers.length) {
        createSeriesMarkers(candleSeries, markers)
      }
    }

    chart.timeScale().fitContent()

    // 리사이즈 옵저버
    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth })
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
    }
  }, [
    candles,
    entryLow,
    entryHigh,
    stopLoss,
    target1,
    tradeSignal,
    showMaEmaOverlay,
    showTradeMarkers,
    showForceLine,
    height,
  ])

  if (candles.length === 0) return null

  const signalLabel = (() => {
    const s = String(tradeSignal || '').toLowerCase()
    if (s === 'strong_buy' || s === 'buy-now') return '강력매수'
    if (s === 'buy' || s === 'buy-on-pullback') return '매수'
    if (s === 'partial_sell') return '익절'
    if (s === 'sell') return '손절/매도'
    if (s === 'watch') return '관망'
    return '대기'
  })()

  return (
    <div style={{ position: 'relative', width: '100%', height, borderRadius: 10, overflow: 'hidden', background: 'var(--color-bg-surface)' }}>
      <div
        ref={containerRef}
        style={{ width: '100%', height }}
      />
      {showLegend && (
        <div
          style={{
            position: 'absolute',
            top: 10,
            left: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: '8px 10px',
            borderRadius: 10,
            background: 'rgba(15,23,42,0.64)',
            color: '#e5edf7',
            backdropFilter: 'blur(4px)',
            pointerEvents: 'none',
            maxWidth: '64%',
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0.2 }}>
            {symbolLabel || 'CHART'} · {signalLabel}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {showMaEmaOverlay && <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 999, background: 'rgba(245,158,11,0.22)' }}>SMA/EMA</span>}
            {showTradeMarkers && <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 999, background: 'rgba(59,130,246,0.22)' }}>신호 마커</span>}
            {showForceLine && <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 999, background: 'rgba(20,184,166,0.22)' }}>세력선 밴드</span>}
          </div>
        </div>
      )}
    </div>
  )
}
