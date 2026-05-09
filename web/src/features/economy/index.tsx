import React, { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { formatNumber } from '../../lib/format'
import Button from '../../components/ui/Button'
import Skeleton from '../../components/Skeleton'
import { ErrorState } from '../../components/StateViews'

interface MarketIndex {
  name: string
  price: number
  change: number
  changeRate: number
}

interface EconomyData {
  indices: {
    kospi?: MarketIndex
    kosdaq?: MarketIndex
    vix?: MarketIndex
    sp500?: MarketIndex
    nasdaq?: MarketIndex
    usdkrw?: MarketIndex
    gold?: MarketIndex
    us10y?: MarketIndex
    meta?: { fetchedAt?: string }
  }
  fetchedAt?: string
}

const INDICATORS: Array<{ label: string; desc: string; cmd: string; key: keyof EconomyData['indices']; isPercent?: boolean; isFx?: boolean }> = [
  { label: 'KOSPI', desc: '국내 대형주 지수. 시장 방향성 기준', cmd: '/kospi', key: 'kospi' },
  { label: 'KOSDAQ', desc: '국내 중소형/기술주 지수', cmd: '/kosdaq', key: 'kosdaq' },
  { label: 'VIX', desc: '공포지수. 20↑ 변동성 주의, 30↑ 위험', cmd: '/economy', key: 'vix' },
  { label: 'S&P 500', desc: '미국 대형주 500 지수', cmd: '/economy', key: 'sp500' },
  { label: 'NASDAQ', desc: '미국 기술주 중심 지수', cmd: '/economy', key: 'nasdaq' },
  { label: '원/달러', desc: '환율. 달러 강세 시 외국인 수급 약화', cmd: '/economy', key: 'usdkrw', isFx: true },
  { label: '금(Gold)', desc: '안전자산. 불확실성 지표', cmd: '/economy', key: 'gold' },
  { label: '국고채 10Y', desc: '금리 방향성. 상승 시 주식 밸류에이션 압박', cmd: '/economy', key: 'us10y', isPercent: true },
]

function formatPrice(index: MarketIndex, opts?: { isPercent?: boolean; isFx?: boolean }): string {
  if (opts?.isPercent) return `${formatNumber(index.price, 2)}%`
  if (opts?.isFx) return formatNumber(index.price, 2)
  return formatNumber(index.price)
}

export default function EconomyPage() {
  const [data, setData] = useState<EconomyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const endpoints = [
        '/api/market-overview',
        '/api/ui/market-overview',
        '/api/ui?route=market-overview',
      ]

      let result: any = null
      let lastError: unknown = null

      for (const endpoint of endpoints) {
        try {
          result = await apiFetch(endpoint, {
            cacheMs: 30_000,
            timeoutMs: 20_000,
            retries: 0,
          })
          break
        } catch (e) {
          lastError = e
        }
      }

      if (!result?.data) {
        throw lastError || new Error('economy data fetch failed')
      }

      setData(result.data)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  if (error) {
    return (
      <section className="container-app">
        <div className="flex-between mb-4">
          <h1 className="title-xl" style={{ marginBottom: 0 }}>글로벌 경제지표</h1>
          <Button variant="secondary" onClick={load} disabled={loading}>새로고침</Button>
        </div>
        <ErrorState message={error} onRetry={load} />
      </section>
    )
  }

  if (loading || !data) {
    return (
      <section className="container-app">
        <div className="flex-between mb-4">
          <h1 className="title-xl" style={{ marginBottom: 0 }}>글로벌 경제지표</h1>
          <Button variant="secondary" onClick={load} disabled={loading}>새로고침</Button>
        </div>
        <div className="card">
          <Skeleton lines={10} height={14} />
        </div>
      </section>
    )
  }

  const fetchedAt = data.indices.meta?.fetchedAt || data.fetchedAt

  return (
    <section className="container-app">
      <div className="flex-between mb-4">
        <h1 className="title-xl" style={{ marginBottom: 0 }}>글로벌 경제지표</h1>
        <Button variant="secondary" onClick={load} disabled={loading}>새로고침</Button>
      </div>

      <div className="card mb-4">
        <div className="muted">
          텔레그램 <code>/economy</code>에 대응하는 실시간 지표입니다.
          {fetchedAt ? ` 마지막 갱신: ${new Date(fetchedAt).toLocaleString('ko-KR')}` : ''}
        </div>
      </div>

      <div className="cards-grid cols-2">
        {INDICATORS.map(ind => (
          <div key={ind.label} className="card">
            <div className="stat-label">{ind.label}</div>
            <div className="stat-value" style={{ fontSize: 'var(--font-size-2xl)' }}>
              {data.indices[ind.key] ? formatPrice(data.indices[ind.key]!, { isPercent: ind.isPercent, isFx: ind.isFx }) : '—'}
            </div>
            <div
              className="stat-sub"
              style={{
                color:
                  data.indices[ind.key] && data.indices[ind.key]!.changeRate > 0
                    ? 'var(--color-stock-up)'
                    : data.indices[ind.key] && data.indices[ind.key]!.changeRate < 0
                      ? 'var(--color-stock-down)'
                      : 'var(--color-text-secondary)',
              }}
            >
              {data.indices[ind.key]
                ? `${data.indices[ind.key]!.changeRate >= 0 ? '+' : ''}${formatNumber(data.indices[ind.key]!.changeRate, 2)}%`
                : ind.desc}
            </div>
            <div className="stat-sub">{ind.desc}</div>
            <div className="caption mt-2" style={{ marginTop: 'var(--space-2)' }}>
              텔레그램: <code>{ind.cmd}</code>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
