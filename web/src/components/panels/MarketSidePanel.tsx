/**
 * MarketSidePanel — 좌측 고정 패널: 실시간 시세
 * /api/ui/market-overview의 indices 데이터를 스프레드시트로 표시
 */
import { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { RefreshCw, Plus } from 'lucide-react'

type MarketIndex = {
  name?: string
  price?: number | null
  change?: number | null
  changeRate?: number | null
  source?: string | null
  rating?: string | null
  score?: number | null
}

type MarketData = {
  indices?: {
    kospi?: MarketIndex
    kosdaq?: MarketIndex
    sp500?: MarketIndex
    nasdaq?: MarketIndex
    dow?: MarketIndex
    vix?: MarketIndex
    usdkrw?: MarketIndex
    gold?: MarketIndex
    silver?: MarketIndex
    copper?: MarketIndex
    wtiOil?: MarketIndex
    bitcoin?: MarketIndex
    fearGreed?: { score: number; rating: string }
    us10y?: MarketIndex
  }
}

function fmtPrice(v: number | null | undefined): string {
  if (v == null) return ''
  if (v > 1_000_000) return v.toLocaleString('ko-KR')
  if (v > 1000) return v.toLocaleString('ko-KR', { maximumFractionDigits: 2 })
  return v.toFixed(2)
}

function fmtRate(v: number | null | undefined): string {
  if (v == null) return ''
  const s = v > 0 ? '+' : ''
  return `${s}${v.toFixed(2)}%`
}

type Row = {
  label: string
  price: string
  daily: string
  source: string
  up: boolean
  down: boolean
}

function buildRows(data: MarketData | null): Row[] {
  if (!data?.indices) return []
  const { kospi, kosdaq, sp500, nasdaq, dow, vix, usdkrw, gold, wtiOil, bitcoin, us10y, fearGreed } = data.indices

  const mkRow = (label: string, idx: MarketIndex | undefined, src = ''): Row | null => {
    if (!idx) return null
    const rate = idx.changeRate ?? 0
    return {
      label,
      price: fmtPrice(idx.price),
      daily: fmtRate(idx.changeRate),
      source: idx.source ?? src,
      up: rate > 0,
      down: rate < 0,
    }
  }

  const rows: (Row | null)[] = [
    mkRow('코스피',   kospi,   'Naver'),
    mkRow('코스닥',   kosdaq,  'Naver'),
    mkRow('S&P500',   sp500,   'Yahoo'),
    mkRow('나스닥',   nasdaq,  'Yahoo'),
    mkRow('다우',     dow,     'Yahoo'),
    mkRow('VIX',      vix,     'Yahoo'),
    null, // divider
    mkRow('원/달러',  usdkrw,  'Yahoo'),
    mkRow('미 10년물',us10y,   'Yahoo'),
    null, // divider
    mkRow('금',       gold,    'Yahoo'),
    mkRow('WTI',      wtiOil,  'Yahoo'),
    mkRow('BTC',      bitcoin, 'Binance'),
    fearGreed ? {
      label: '공포/탐욕',
      price: String(fearGreed.score),
      daily: fearGreed.rating,
      source: 'CNN',
      up: fearGreed.score >= 60,
      down: fearGreed.score <= 35,
    } : null,
  ]

  return rows.filter(Boolean) as Row[]
}

export default function MarketSidePanel() {
  const [data, setData]         = useState<MarketData | null>(null)
  const [loading, setLoading]   = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string>('')

  const load = async (force = false) => {
    try {
      setRefreshing(true)
      const res = await apiFetch('/api/ui/market-overview', { cacheMs: force ? 0 : 30_000, timeoutMs: 20_000 })
      setData(res?.data ?? res ?? null)
      setFetchedAt(new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    } catch {
      // 실패 시 기존 데이터 유지
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { load() }, [])

  // 30초 자동 갱신
  useEffect(() => {
    const id = setInterval(() => load(), 30_000)
    return () => clearInterval(id)
  }, [])

  const rows = buildRows(data)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 패널 헤더 */}
      <div className="xls-panel-header-bar">
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          📈 실시간 시세
          {fetchedAt && (
            <span style={{ fontSize: 9, color: 'var(--color-text-tertiary)', fontWeight: 400 }}>
              · {fetchedAt}
            </span>
          )}
        </span>
        <div className="xls-panel-header-bar__tools">
          <button
            className="xls-toolbar-btn"
            onClick={() => load(true)}
            title="새로고침"
            disabled={refreshing}
          >
            <RefreshCw size={9} style={{ animation: refreshing ? 'xls-spin 0.8s linear infinite' : undefined }}/>
            30초
          </button>
        </div>
      </div>

      {/* 스프레드시트 */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table className="xls-table" style={{ width: '100%' }}>
          <colgroup>
            <col style={{ width: 28 }}/>
            <col style={{ minWidth: 72 }}/>
            <col style={{ minWidth: 68 }}/>
            <col style={{ minWidth: 58 }}/>
          </colgroup>
          <thead>
            <tr className="xls-letter-row">
              <th className="xls-corner"/>
              <th className="xls-col-letter">A</th>
              <th className="xls-col-letter">B</th>
              <th className="xls-col-letter">C</th>
            </tr>
            <tr className="xls-header-row">
              <th className="xls-row-num-header"/>
              <th className="xls-th">지표</th>
              <th className="xls-th" style={{ textAlign: 'right' }}>현재가</th>
              <th className="xls-th" style={{ textAlign: 'right' }}>등락률</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} style={{ padding: '12px', textAlign: 'center', fontSize: 10, color: 'var(--color-text-tertiary)' }}>불러오는 중...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={4} style={{ padding: '12px', textAlign: 'center', fontSize: 10, color: 'var(--color-text-tertiary)' }}>데이터 없음</td></tr>
            ) : (
              <>
                {rows.map((row, i) => (
                  row.label === '__div__' ? (
                    <tr key={i}><td colSpan={4} style={{ height: 4, background: 'var(--color-excel-cell-header)' }}/></tr>
                  ) : (
                    <tr
                      key={i}
                      className={`xls-row${i % 2 === 0 ? ' xls-row--even' : ''}${selected === i ? ' xls-row--selected' : ''}`}
                      onClick={() => setSelected(i === selected ? null : i)}
                      style={{ cursor: 'default' }}
                    >
                      <td className="xls-row-num">{i + 1}</td>
                      <td className="xls-cell" style={{ fontSize: 10 }}>
                        {row.source && (
                          <span style={{ color: 'var(--color-text-tertiary)', fontSize: 9, marginRight: 3 }}>
                            {row.source}
                          </span>
                        )}
                        {row.label}
                      </td>
                      <td className="xls-cell xls-cell--num" style={{ fontSize: 10 }}>
                        {row.price}
                      </td>
                      <td
                        className="xls-cell xls-cell--num"
                        style={{
                          fontSize: 10,
                          fontWeight: (row.up || row.down) ? 600 : undefined,
                          color: row.up
                            ? 'var(--color-stock-up)'
                            : row.down
                            ? 'var(--color-stock-down)'
                            : undefined,
                        }}
                      >
                        {row.daily}
                      </td>
                    </tr>
                  )
                ))}
                {/* 빈 행 */}
                {Array.from({ length: Math.max(0, 30 - rows.length) }, (_, i) => (
                  <tr key={`e${i}`} className={`xls-row${(rows.length + i) % 2 === 0 ? ' xls-row--even' : ''}`}>
                    <td className="xls-row-num">{rows.length + i + 1}</td>
                    <td className="xls-cell xls-cell--empty"/>
                    <td className="xls-cell xls-cell--empty"/>
                    <td className="xls-cell xls-cell--empty"/>
                  </tr>
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
