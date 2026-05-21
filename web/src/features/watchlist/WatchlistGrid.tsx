/**
 * WatchlistGrid — 감시목록 스프레드시트 뷰
 * 기존 watchlist API 데이터를 엑셀 그리드로 표시
 */
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { searchStocks } from '../../lib/stockCache'
import { RefreshCw, Search, Plus, X } from 'lucide-react'
import { useToast } from '../../components/ToastProvider'

function fmtPct(v: number | null): string {
  if (v == null) return ''
  const r = Math.round(v * 10) / 10
  return `${r > 0 ? '+' : ''}${r.toFixed(1)}%`
}
function fmtKrw(v: number | null): string {
  if (v == null) return ''
  return v.toLocaleString('ko-KR')
}
function fmtDate(raw: string | null): string {
  if (!raw) return ''
  const d = new Date(raw)
  if (isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}/${d.getDate()}`
}

type WatchItem = {
  stock_code: string
  stock_name: string
  buy_price?: number | null
  current_price?: number | null
  change_rate?: number | null
  buy_date?: string | null
  created_at?: string | null
  memo?: string | null
}

export default function WatchlistGrid() {
  const toast = useToast()
  const [items, setItems]     = useState<WatchItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [search, setSearch]   = useState('')
  const [addInput, setAddInput] = useState('')
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      setRefreshing(true)
      const data = await apiFetch('/api/ui/watchlist', { cacheMs: 0 })
      setItems(data?.data?.items ?? [])
      setError(null)
    } catch (e: any) {
      setError(e.message ?? '불러오기 실패')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleAddSearch = useCallback(async (q: string) => {
    setAddInput(q)
    if (q.length < 1) { setSuggestions([]); return }
    const results = await searchStocks(q)
    setSuggestions(results.slice(0, 8))
  }, [])

  const handleAdd = useCallback(async (code: string, name: string) => {
    try {
      await apiFetch('/api/ui/watchlist', { method: 'POST', body: JSON.stringify({ code }) })
      toast.show(`${name} (${code}) 추가됨`, 2000)
      setSuggestions([])
      setAddInput('')
      load()
    } catch {
      toast.show('추가 실패', 2000)
    }
  }, [load, toast])

  const handleRemove = useCallback(async (code: string, name: string) => {
    try {
      await apiFetch(`/api/ui/watchlist?code=${encodeURIComponent(code)}`, { method: 'DELETE' })
      toast.show(`${name} 삭제됨`, 2000)
      load()
    } catch {
      toast.show('삭제 실패', 2000)
    }
  }, [load, toast])

  const filtered = items.filter(it =>
    !search ||
    it.stock_name.includes(search) ||
    it.stock_code.includes(search)
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* 패널 툴바 */}
      <div className="xls-panel-header-bar">
        <span>👁️ 감시목록 ({items.length}개)</span>
        <div className="xls-panel-header-bar__tools">
          <button className="xls-toolbar-btn" onClick={load} title="새로고침" disabled={refreshing}>
            <RefreshCw size={9} style={{ animation: refreshing ? 'xls-spin 0.8s linear infinite' : undefined }}/> 갱신
          </button>
        </div>
      </div>

      {/* 검색/추가 바 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 6px',
        background: 'var(--color-gray-0)',
        borderBottom: '1px solid var(--color-excel-grid-border)',
        flexShrink: 0,
        position: 'relative',
      }}>
        <Search size={11} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }}/>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="내 관심에서 검색..."
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            fontSize: 11,
            fontFamily: 'var(--font-family-sans)',
            background: 'transparent',
            color: 'var(--color-text-primary)',
          }}
        />
        {search && (
          <button onClick={() => setSearch('')} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: 'var(--color-text-tertiary)' }}>
            <X size={10}/>
          </button>
        )}
      </div>

      {/* 종목 추가 바 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 6px',
        background: 'var(--color-gray-0)',
        borderBottom: '1px solid var(--color-excel-grid-border)',
        flexShrink: 0,
        position: 'relative',
      }}>
        <Plus size={11} style={{ color: 'var(--color-brand)', flexShrink: 0 }}/>
        <input
          value={addInput}
          onChange={e => handleAddSearch(e.target.value)}
          placeholder="종목 추가 (코드/종목명 2글자 이상)"
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            fontSize: 11,
            fontFamily: 'var(--font-family-sans)',
            background: 'transparent',
            color: 'var(--color-text-primary)',
          }}
        />
        {/* 자동완성 드롭다운 */}
        {suggestions.length > 0 && (
          <div style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            background: 'var(--color-gray-0)',
            border: '1px solid var(--color-excel-grid-border)',
            boxShadow: 'var(--shadow-md)',
            zIndex: 100,
          }}>
            {suggestions.map((s: any) => (
              <button
                key={s.code}
                onClick={() => handleAdd(s.code, s.name)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '5px 8px',
                  border: 'none',
                  borderBottom: '1px solid var(--color-excel-grid-border)',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: 11,
                  textAlign: 'left',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-excel-cell-header)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ fontWeight: 600 }}>{s.name}</span>
                <span style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-family-mono)', fontSize: 10 }}>{s.code}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 스프레드시트 그리드 */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading ? (
          <div style={{ padding: '20px', textAlign: 'center', fontSize: 11, color: 'var(--color-text-tertiary)' }}>
            불러오는 중...
          </div>
        ) : error ? (
          <div style={{ padding: '20px', textAlign: 'center', fontSize: 11, color: 'var(--color-error)' }}>
            {error}
          </div>
        ) : (
          <table className="xls-table" style={{ width: '100%', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 28 }}/>   {/* 행번호 */}
              <col style={{ width: 60 }}/>   {/* A: 코드 */}
              <col style={{ width: '22%' }}/>{/* B: 종목명 */}
              <col style={{ width: 48 }}/>   {/* C: 추가일 */}
              <col style={{ width: 75 }}/>   {/* D: 기준가 */}
              <col style={{ width: 75 }}/>   {/* E: 현재가 */}
              <col style={{ width: 65 }}/>   {/* F: 수익률 */}
              <col/>                          {/* G: 메모 */}
              <col style={{ width: 24 }}/>   {/* 삭제 */}
            </colgroup>
            <thead>
              {/* 열 문자 */}
              <tr className="xls-letter-row">
                <th className="xls-corner"/>
                <th className="xls-col-letter">A</th>
                <th className="xls-col-letter">B</th>
                <th className="xls-col-letter">C</th>
                <th className="xls-col-letter">D</th>
                <th className="xls-col-letter">E</th>
                <th className="xls-col-letter">F</th>
                <th className="xls-col-letter">G</th>
                <th className="xls-col-letter"/>
              </tr>
              {/* 열 레이블 */}
              <tr className="xls-header-row">
                <th className="xls-row-num-header"/>
                <th className="xls-th">코드</th>
                <th className="xls-th">종목명</th>
                <th className="xls-th">추가일</th>
                <th className="xls-th" style={{ textAlign: 'right' }}>기준가</th>
                <th className="xls-th" style={{ textAlign: 'right' }}>현재가</th>
                <th className="xls-th" style={{ textAlign: 'right' }}>수익률</th>
                <th className="xls-th">메모</th>
                <th className="xls-th"/>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, i) => {
                const rate = item.change_rate ?? null
                const isUp   = rate != null && rate > 0
                const isDown = rate != null && rate < 0
                return (
                  <tr
                    key={item.stock_code}
                    className={`xls-row${i % 2 === 0 ? ' xls-row--even' : ''}${selected === i ? ' xls-row--selected' : ''}`}
                    onClick={() => setSelected(i === selected ? null : i)}
                    style={{ cursor: 'default' }}
                  >
                    <td className="xls-row-num">{i + 1}</td>
                    <td className="xls-cell" style={{ fontSize: 10, fontFamily: 'var(--font-family-mono)', color: 'var(--color-brand)' }}>
                      {item.stock_code}
                    </td>
                    <td className="xls-cell" style={{ fontSize: 11, fontWeight: 600 }}>
                      {item.stock_name}
                    </td>
                    <td className="xls-cell" style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                      {fmtDate(item.buy_date ?? item.created_at ?? null)}
                    </td>
                    <td className="xls-cell xls-cell--num" style={{ fontSize: 10 }}>
                      {item.buy_price != null ? fmtKrw(item.buy_price) : ''}
                    </td>
                    <td className="xls-cell xls-cell--num" style={{ fontSize: 10 }}>
                      {item.current_price != null ? fmtKrw(item.current_price) : ''}
                    </td>
                    <td
                      className="xls-cell xls-cell--num"
                      style={{
                        fontSize: 10,
                        fontWeight: (isUp || isDown) ? 600 : undefined,
                        color: isUp ? 'var(--color-stock-up)' : isDown ? 'var(--color-stock-down)' : undefined,
                      }}
                    >
                      {fmtPct(rate)}
                    </td>
                    <td className="xls-cell" style={{ fontSize: 10, color: 'var(--color-text-secondary)' }}>
                      {item.memo ?? ''}
                    </td>
                    <td className="xls-cell" style={{ padding: '0 2px', textAlign: 'center' }}>
                      <button
                        onClick={e => { e.stopPropagation(); handleRemove(item.stock_code, item.stock_name) }}
                        style={{
                          width: 16, height: 16,
                          border: 'none',
                          background: 'transparent',
                          cursor: 'pointer',
                          color: 'var(--color-text-tertiary)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: 1,
                        }}
                        title="삭제"
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-red-50)', e.currentTarget.style.color = 'var(--color-error)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent', e.currentTarget.style.color = 'var(--color-text-tertiary)')}
                      >
                        <X size={10}/>
                      </button>
                    </td>
                  </tr>
                )
              })}
              {/* 빈 행 */}
              {Array.from({ length: Math.max(0, 30 - filtered.length) }, (_, i) => (
                <tr key={`e${i}`} className={`xls-row${(filtered.length + i) % 2 === 0 ? ' xls-row--even' : ''}`}>
                  <td className="xls-row-num">{filtered.length + i + 1}</td>
                  {Array.from({ length: 8 }, (_, ci) => <td key={ci} className="xls-cell xls-cell--empty"/>)}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
