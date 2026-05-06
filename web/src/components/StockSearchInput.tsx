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

    // 코드 또는 한글명으로 검색
    const filtered = allStocks
      .filter(s => {
        const codeMatch = s.code.includes(q)
        const nameMatch = s.name.includes(q)
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

      <style>{`
        .stock-search-input {
          position: relative;
          width: 100%;
        }

        .stock-search-input input {
          width: 100%;
        }

        .stock-search-dropdown {
          position: absolute;
          top: calc(100% + 4px);
          left: 0;
          right: 0;
          background: var(--color-bg-primary);
          border: 1px solid var(--color-border);
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          z-index: 1000;
          max-height: 280px;
          overflow-y: auto;
        }

        .stock-search-item {
          width: 100%;
          padding: 10px 12px;
          background: var(--color-bg-primary);
          border: none;
          border-bottom: 1px solid var(--color-border);
          text-align: left;
          cursor: pointer;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: var(--space-2);
          transition: background-color 0.15s ease;
        }

        .stock-search-item:last-child {
          border-bottom: none;
        }

        .stock-search-item:hover {
          background-color: var(--color-bg-secondary);
        }

        .stock-search-item.selected {
          background-color: var(--color-bg-secondary);
        }

        .stock-search-name {
          flex: 1;
          font-weight: var(--font-weight-500);
          color: var(--color-text-primary);
          font-size: var(--font-size-base);
        }

        .stock-search-code {
          font-family: monospace;
          font-size: var(--font-size-sm);
          color: var(--color-text-secondary);
          white-space: nowrap;
        }
      `}</style>
    </div>
  )
}
