import React, { useState, useRef, useEffect } from 'react'
import { getStocks, type StockItem } from '../lib/stockCache'
import { rankStockMatches } from '../lib/stockSearch'
import AnchoredDropdown from './AnchoredDropdown'

interface StockSearchInputProps {
  value: string
  onChange: (value: string) => void
  onSelect: (stock: StockItem) => void
  placeholder?: string
  disabled?: boolean
  /** 비었거나 잘못돼 다시 입력해야 할 때 — 빨간 테두리(aria-invalid) */
  invalid?: boolean
  /** 주면 Enter로 바로 진행한다: 고른 항목 → 첫 추천 → (추천이 없으면) 입력값 그대로 */
  onSubmit?: (value: string) => void
}

export default function StockSearchInput({
  value,
  onChange,
  onSelect,
  placeholder = '종목 코드 또는 한글명 입력',
  disabled = false,
  invalid = false,
  onSubmit,
}: StockSearchInputProps) {
  const [suggestions, setSuggestions] = useState<StockItem[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [allStocks, setAllStocks] = useState<StockItem[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 종목 캐시 로드
  useEffect(() => {
    const load = async () => {
      try {
        const stocks = await getStocks()
        setAllStocks(stocks)
      } catch {
        // 캐시 로드 실패
      }
    }
    void load()
  }, [])

  // 검색어 변경 시 추천 업데이트
  useEffect(() => {
    const q = value.trim()
    if (!q || allStocks.length === 0) {
      setSuggestions([])
      setSelectedIndex(-1)
      return
    }

    const filtered = rankStockMatches(allStocks, q, 10)

    setSuggestions(filtered)
    setSelectedIndex(-1)
    setIsOpen(filtered.length > 0)
  }, [value, allStocks])

  // 외부 클릭 시 닫기
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      // 목록은 body로 띄워 컨테이너 밖에 있으므로 그 안의 클릭도 '안쪽'으로 본다
      if (containerRef.current && !containerRef.current.contains(target) && !dropdownRef.current?.contains(target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 키보드 네비게이션
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : 0))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : suggestions.length - 1))
        break
      case 'Enter':
        e.preventDefault()
        if (selectedIndex >= 0 && suggestions[selectedIndex]) {
          handleSelect(suggestions[selectedIndex])
        } else if (onSubmit) {
          if (isOpen && suggestions[0]) handleSelect(suggestions[0])
          else if (value.trim()) { setIsOpen(false); onSubmit(value.trim()) }
        }
        break
      case 'Escape':
        setIsOpen(false)
        break
    }
  }

  const handleSelect = (stock: StockItem) => {
    onChange(stock.code)
    onSelect(stock)
    setIsOpen(false)
    setSelectedIndex(-1)
  }

  return (
    <div className="stock-search-input" ref={containerRef}>
      <input
        ref={inputRef}
        type="text"
        className="input"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => value.trim().length > 0 && suggestions.length > 0 && setIsOpen(true)}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        autoComplete="off"
      />

      {isOpen && suggestions.length > 0 && (
        <AnchoredDropdown anchorRef={containerRef} dropdownRef={dropdownRef} className="stock-search-dropdown">
          {suggestions.map((stock, idx) => (
            <button
              key={stock.code}
              className={`stock-search-item ${selectedIndex === idx ? 'selected' : ''}`}
              onClick={() => handleSelect(stock)}
              onMouseEnter={() => setSelectedIndex(idx)}
            >
              <div className="stock-search-name">{stock.name}</div>
              <div className="stock-search-code">{stock.code}</div>
            </button>
          ))}
        </AnchoredDropdown>
      )}
    </div>
  )
}
