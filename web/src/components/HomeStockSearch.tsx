import React, { useState } from 'react'
import { Search } from 'lucide-react'
import StockSearchInput from './StockSearchInput'
import Button from './ui/Button'
import { ANALYZE_PENDING_CODE_KEY } from '../features/analyze/constants'

/** 홈 맨 위 종목 검색 — 고르거나 Enter를 누르면 종목 분석 화면으로 넘어가 바로 분석한다. 처음 온 사람이 메뉴를 찾아다니지 않게. */
export default function HomeStockSearch({ onNavigate }: { onNavigate?: (route: string) => void }) {
  const [query, setQuery] = useState('')

  const go = (code: string) => {
    const c = code.trim()
    if (!c) return
    try { sessionStorage.setItem(ANALYZE_PENDING_CODE_KEY, c) } catch { /* 저장 못 해도 분석 화면에서 직접 입력하면 된다 */ }
    onNavigate?.('analyze')
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px' }}>
      <div style={{ flex: '1 1 0', minWidth: 0 }}>
        <StockSearchInput
          value={query}
          onChange={setQuery}
          onSelect={(stock) => go(stock.code)}
          onSubmit={go}
          placeholder="종목 이름이나 코드로 찾기 (예: 삼성전자)"
        />
      </div>
      <Button
        variant="primary"
        onClick={() => go(query)}
        disabled={!query.trim()}
        style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}
      >
        <Search size={14} />
        <span>분석</span>
      </Button>
    </div>
  )
}
