import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export function usePortfolioFilters() {
  const [page, setPage] = useState(1)
  const pageSize = 20
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [selectedSector, setSelectedSector] = useState<string | null>(null)
  const [selectedAccountKey, setSelectedAccountKey] = useState<string>('all')
  const [holdingStateFilter, setHoldingStateFilter] = useState<'all' | 'hold' | 'add' | 'partial'>('all')
  const [gradeFilter, setGradeFilter] = useState<'all' | 'A' | 'B' | 'C'>('all')
  const [showAllSectors, setShowAllSectors] = useState(false)
  const [filterAccordionOpen, setFilterAccordionOpen] = useState(false)

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
    onSearchChange,
    onSectorChange,
  }
}
