import React, { useState, useRef, useEffect } from 'react'
import { getStocks, type StockItem } from '../lib/stockCache'

interface StockSearchInputProps {
  value: string
  onChange: (value: string) => void
  onSelect: (stock: StockItem) => void
  placeholder?: string
  disabled?: boolean
}

export default function StockSearchInput({
  value,
  onChange,
  onSelect,
  placeholder = '종목 코드 또는 한글명 입력',
  disabled = false,
}: StockSearchInputProps) {
  const [suggestions, setSuggestions] = useState<StockItem[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [allStocks, setAllStocks] = useState<StockItem[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const normalizeSearchTerm = (text: string) => {
    return text
      .normalize('NFKC')
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[·ㆍ\.\-_/()\[\]{}]/g, '')
  }

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

    const nq = normalizeSearchTerm(q)

    // 코드 또는 한글명으로 검색 (정규화 후)
    const filtered = allStocks
      .filter(s => {
        const codeMatch = s.code.includes(q) // 코드는 그대로
        const nameMatch = normalizeSearchTerm(s.name).includes(nq) // 명칭은 정규화 후 비교
        return codeMatch || nameMatch
      })
      .slice(0, 10) // 최대 10개

    setSuggestions(filtered)
    setSelectedIndex(-1)
    setIsOpen(filtered.length > 0)
  }, [value, allStocks])

  // 외부 클릭 시 닫기
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
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
        autoComplete="off"
      />

      {isOpen && suggestions.length > 0 && (
        <div className="stock-search-dropdown">
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
        </div>
      )}
    </div>
  )
}
