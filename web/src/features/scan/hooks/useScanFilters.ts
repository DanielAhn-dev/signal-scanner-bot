import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ALL_CONDITION_FILTER_KEYS, BASIC_CONDITION_FILTER_KEYS, CONDITION_FILTER_OPTIONS, FILTER_DEFAULT_SORT, STRATEGY_METRIC_KEY_BY_FILTER } from '../constants'
import type { ConditionFilter, SortDirection, SortKey } from '../types'

export function useScanFilters() {
  const [selectedSector, setSelectedSector] = useState<string>('all')
  const [conditionFilter, setConditionFilter] = useState<ConditionFilter>('all')
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('priority_score')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [page, setPage] = useState(1)

  const pageSize = 20

  const filterChipScrollRef = useRef<HTMLDivElement | null>(null)

  const activeStrategyMetricKey = useMemo(
    () => STRATEGY_METRIC_KEY_BY_FILTER[conditionFilter] ?? null,
    [conditionFilter],
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const nextSector = String(params.get('sector') || '').trim()
    const nextFilter = String(params.get('filter') || '').trim()

    if (nextSector) setSelectedSector(nextSector)
    if (ALL_CONDITION_FILTER_KEYS.includes(nextFilter as ConditionFilter)) {
      setConditionFilter(nextFilter as ConditionFilter)
    }
  }, [])

  useEffect(() => {
    if (conditionFilter !== 'all' && !BASIC_CONDITION_FILTER_KEYS.has(conditionFilter)) {
      setShowAdvancedFilters(true)
    }
  }, [conditionFilter])

  const advancedConditionOptions = useMemo(() => {
    return CONDITION_FILTER_OPTIONS.filter((option) => {
      if (!option.advanced) return false
      if (showAdvancedFilters) return true
      return option.key === conditionFilter
    })
  }, [showAdvancedFilters, conditionFilter])

  useEffect(() => {
    const container = filterChipScrollRef.current
    if (!container) return
    const active = container.querySelector<HTMLButtonElement>('button.tag.active')
    if (!active) return
    active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [conditionFilter])

  const handleFilterChipWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const container = filterChipScrollRef.current
    if (!container) return
    const horizontalDelta = Math.abs(event.deltaX) > 0 ? event.deltaX : event.deltaY
    if (!horizontalDelta) return
    container.scrollLeft += horizontalDelta
    event.preventDefault()
  }, [])

  const handleFilterChipKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const container = filterChipScrollRef.current
    if (!container) return
    const chips = Array.from(container.querySelectorAll<HTMLButtonElement>('button.tag'))
    if (chips.length === 0) return
    const activeElement = document.activeElement as HTMLElement | null
    const currentIdx = chips.findIndex((chip) => chip === activeElement)
    const startIdx = currentIdx >= 0 ? currentIdx : chips.findIndex((chip) => chip.classList.contains('active'))

    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const delta = event.key === 'ArrowRight' ? 1 : -1
      const base = startIdx >= 0 ? startIdx : 0
      const nextIdx = (base + delta + chips.length) % chips.length
      const target = chips[nextIdx]
      target?.focus()
      target?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
      event.preventDefault()
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      const idx = startIdx >= 0 ? startIdx : 0
      chips[idx]?.click()
      event.preventDefault()
      return
    }

    if (event.key === 'Home') {
      chips[0]?.focus()
      chips[0]?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })
      event.preventDefault()
      return
    }

    if (event.key === 'End') {
      const last = chips[chips.length - 1]
      last?.focus()
      last?.scrollIntoView({ behavior: 'smooth', inline: 'end', block: 'nearest' })
      event.preventDefault()
    }
  }, [])

  useEffect(() => {
    setPage(1)
  }, [selectedSector])

  const handleConditionFilter = (filter: ConditionFilter) => {
    setConditionFilter(filter)
    setSortKey(FILTER_DEFAULT_SORT[filter])
    setSortDirection('desc')
    setPage(1)
  }

  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDirection(key === 'code' || key === 'name' || key === 'sector_id' ? 'asc' : 'desc')
  }

  return {
    selectedSector,
    setSelectedSector,
    conditionFilter,
    showAdvancedFilters,
    setShowAdvancedFilters,
    sortKey,
    setSortKey,
    sortDirection,
    setSortDirection,
    page,
    setPage,
    pageSize,
    filterChipScrollRef,
    activeStrategyMetricKey,
    advancedConditionOptions,
    handleFilterChipWheel,
    handleFilterChipKeyDown,
    handleConditionFilter,
    onSort,
  }
}
