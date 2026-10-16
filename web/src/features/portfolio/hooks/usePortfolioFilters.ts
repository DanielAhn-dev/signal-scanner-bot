import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isHoldingSortKey, type HoldingSortKey } from '../lib/holdingSort'

const SORT_STORAGE_KEY = 'portfolio.holdingSort'

/** 처음 열 탭 — 주소의 ?account=virtual이면 실험 계좌, 그 밖에는 실제 계좌 */
export function initialAccountKey(): string {
  try {
    return new URLSearchParams(window.location.search).get('account') === 'virtual' ? 'virtual' : 'real'
  } catch {
    return 'real'
  }
}

/** 주소에 탭을 지정했는가 — 지정하지 않았을 때만 실제 계좌가 비어 있으면 실험 계좌로 넘긴다 */
export function hasAccountParam(): boolean {
  try {
    return new URLSearchParams(window.location.search).has('account')
  } catch {
    return false
  }
}

export function usePortfolioFilters() {
  const [page, setPage] = useState(1)
  const pageSize = 20
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [selectedSector, setSelectedSector] = useState<string | null>(null)
  // 대시보드 링크가 ?account=real|virtual로 어느 쪽을 열지 정한다. 없으면 실제 계좌부터
  const [selectedAccountKey, setSelectedAccountKey] = useState<string>(() => initialAccountKey())
  const [holdingStateFilter, setHoldingStateFilter] = useState<'all' | 'hold' | 'add' | 'partial'>('all')
  const [gradeFilter, setGradeFilter] = useState<'all' | 'A' | 'B' | 'C'>('all')
  const [showAllSectors, setShowAllSectors] = useState(false)
  const [filterAccordionOpen, setFilterAccordionOpen] = useState(false)
  // 카드 정렬은 다음에 열어도 그대로 — 기기별 편의 설정이라 브라우저 저장소에만 둔다
  const [sortKey, setSortKeyState] = useState<HoldingSortKey>(() => {
    try {
      const saved = window.localStorage.getItem(SORT_STORAGE_KEY)
      return isHoldingSortKey(saved) ? saved : 'default'
    } catch {
      return 'default'
    }
  })
  const setSortKey = (key: HoldingSortKey) => {
    setSortKeyState(key)
    setPage(1)
    try { window.localStorage.setItem(SORT_STORAGE_KEY, key) } catch { /* 저장 못 해도 이번 화면엔 적용 */ }
  }

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onSearchChange = (v: string) => {
    setSearchInput(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSearch(v)
      setPage(1)
    }, 220)
  }
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  const onSectorChange = (sectorId: string | null) => {
    setSelectedSector(sectorId)
    setPage(1)
  }

  return {
    page,
    setPage,
    pageSize,
    search,
    setSearch,
    searchInput,
    selectedSector,
    selectedAccountKey,
    setSelectedAccountKey,
    holdingStateFilter,
    setHoldingStateFilter,
    gradeFilter,
    setGradeFilter,
    showAllSectors,
    setShowAllSectors,
    filterAccordionOpen,
    setFilterAccordionOpen,
    sortKey,
    setSortKey,
    onSearchChange,
    onSectorChange,
  }
}
