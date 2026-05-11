/**
 * CandleChart — lightweight-charts 기반 인터랙티브 캔들 차트
 * OhlcvCandle[] 배열을 받아 캔들스틱 + 볼륨 차트를 렌더링한다.
 */
import React, { useEffect, useRef } from 'react'
import {
  createChart,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type CandlestickSeriesOptions,
  type HistogramSeriesOptions,
} from 'lightweight-charts'
import type { OhlcvCandle } from '../lib/types'

type Props = {
  candles: OhlcvCandle[]
  entryLow?: number | null
  entryHigh?: number | null
  stopLoss?: number | null
  target1?: number | null
  height?: number
}

function toTimestamp(dateStr: string): number {
  // YYYY-MM-DD or YYYYMMDD → Unix seconds
  const normalized = dateStr.length === 8
    ? `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`
    : dateStr
  return Math.floor(new Date(normalized).getTime() / 1000)
}

export default function CandleChart({ candles, entryLow, entryHigh, stopLoss, target1, height = 340 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return

    const el = containerRef.current
    const isDark = document.documentElement.classList.contains('dark') ||
      window.matchMedia('(prefers-color-scheme: dark)').matches

    const bg = isDark ? '#0f172a' : '#ffffff'
    const textColor = isDark ? '#94a3b8' : '#64748b'
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'

    const chart = createChart(el, {
      width: el.clientWidth,
      height,
      layout: { background: { type: ColorType.Solid, color: bg }, textColor },
      grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: false },
      handleScroll: true,
      handleScale: true,
    })

    chartRef.current = chart

    // 캔들 시리즈
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    } as Partial<CandlestickSeriesOptions>)
    candleSeriesRef.current = candleSeries

    // 볼륨 시리즈 (보조, 오버레이 방식)
    const volSeries = chart.addHistogramSeries({
      color: '#26a69a',
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    } as Partial<HistogramSeriesOptions>)
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
      color: c.close >= c.open ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)',
    }))

    candleSeries.setData(candleData)
    volSeries.setData(volData)

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
  }, [candles, entryLow, entryHigh, stopLoss, target1, height])

  if (candles.length === 0) return null

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height, borderRadius: 8, overflow: 'hidden', background: 'var(--color-bg-surface)' }}
    />
  )
}
