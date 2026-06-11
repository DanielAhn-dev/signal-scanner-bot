/**
 * ExcelShell — Microsoft Excel 365 스타일 앱 최외곽 껍데기
 *
 * 구조:
 *  ┌─ 타이틀바 (초록) ──────────────────────────────────────┐
 *  ├─ 리본 탭바 ────────────────────────────────────────────┤
 *  ├─ 리본 바디 (탭별 버튼 그룹) ───────────────────────────┤
 *  ├─ 수식 표시줄 ──────────────────────────────────────────┤
 *  ├─ 메인 영역 (3패널 리사이즈) ───────────────────────────┤
 *  │   ┌ 좌: 시세 ┐ ┌ 중: 현재 페이지 콘텐츠 ┐ ┌ 우: 알림 ┐│
 *  │   └──────────┘ └─────────────────────────┘ └──────────┘│
 *  ├─ 시트 탭 (하단 페이지 네비게이션) ────────────────────┤
 *  └─ 상태바 ───────────────────────────────────────────────┘
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  Save, Undo2, Redo2, Star,
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Minus, Plus,
  LayoutDashboard, ScanSearch, BarChart2, FlaskConical,
  BriefcaseBusiness, FileText, Globe2, Newspaper,
  Bell, User, Settings, Database, Shield, ShieldCheck, Wrench,
  Zap, History, Search,
  PieChart, Activity, Target, Eye, List,
} from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { useProfileStore } from '../stores/profileStore'
import { PRIMARY_NAV_ITEMS, CONTROL_NAV_ITEM, TOOL_NAV_GROUPS, TOOL_NAV_ITEMS, ALL_NAV_ITEMS } from '../navigation'
import ExcelContentArea from './ExcelContentArea'

// ── 타입 ─────────────────────────────────────────────────────────

type Props = {
  children: React.ReactNode        // 중앙 패널 콘텐츠 (현재 페이지)
  activeRoute?: string
  onNavigate: (route: string) => void
  onQuickSave?: (context: { activeRoute: string; pageLabel: string }) => void | Promise<void>
  onOpenProfile?: () => void
  contextLabel?: string            // 수식 표시줄에 표시할 텍스트
  quickSaveTooltip?: string
  /** 중앙 콘텐츠 프레임 모드 */
  contentMode?: 'native' | 'legacy'
  /** 좌측 고정 패널 (시세 등) */
  leftPanel?: React.ReactNode
  /** 우측 고정 패널 (알림/채팅 등) */
  rightPanel?: React.ReactNode
}

// ── 내비게이션 아이콘 ─────────────────────────────────────────────

const NAV_ICON_COMPONENTS: Record<string, React.ComponentType<{ size?: number | string }>> = {
  'dashboard': LayoutDashboard,
  'scan': ScanSearch,
  'analyze': BarChart2,
  'simulator': FlaskConical,
  'portfolio': BriefcaseBusiness,
  'reports': FileText,
  'control': Shield,
  'sectors': PieChart,
  'market': Globe2,
  'news': Newspaper,
  'economy': Activity,
  'trades': History,
  'watchlist': Eye,
  'alerts': Bell,
  'execution-guide': Target,
  'highlights': Zap,
  'strategy': Target,
  'backtest': Activity,
  'discovery': Search,
  'feed': List,
  'settings': Settings,
  'profile': User,
  'admin-users': User,
}

function navIcon(key: string, size: number): React.ReactNode {
  const Icon = NAV_ICON_COMPONENTS[key] ?? FileText
  return <Icon size={size} />
}

// ── 리본 정의 ────────────────────────────────────────────────────
// 더미(준비 중) 버튼 없이 실제 동작하는 액션만 노출한다.

const RIBBON_TABS = [
  { key: 'home',    label: '홈' },
  { key: 'control', label: '관제' },
  { key: 'tools',   label: '도구' },
] as const
type RibbonTabKey = typeof RIBBON_TABS[number]['key']

type RibbonBtn = { key: string; label: string; icon: React.ReactNode; route?: string }
type RibbonGroup = { label: string; buttons: RibbonBtn[] }

function getRibbonGroups(tab: RibbonTabKey): RibbonGroup[] {
  switch (tab) {
    case 'home': return [
      { label: '핵심 플로우', buttons: PRIMARY_NAV_ITEMS.map(item => ({
        key: item.key, label: item.label, icon: navIcon(item.key, 20), route: item.key,
      }))},
      { label: '관제', buttons: [
        { key: 'control', label: '관제', icon: <Shield size={20}/>, route: 'control' },
      ]},
    ]
    case 'control': return [
      { label: '관제 바로가기', buttons: [
        { key: 'control-audit',       label: '검산',     icon: <ShieldCheck size={20}/>, route: 'control?tab=audit' },
        { key: 'control-operations',  label: '운영',     icon: <Activity size={20}/>,    route: 'control?tab=operations' },
        { key: 'control-data',        label: '데이터',   icon: <Database size={20}/>,    route: 'control?tab=data' },
        { key: 'control-maintenance', label: '유지보수', icon: <Wrench size={20}/>,      route: 'control?tab=maintenance' },
      ]},
    ]
    case 'tools': return TOOL_NAV_GROUPS.map(group => ({
      label: group.category,
      buttons: group.items
        .filter(item => !item.adminOnly)
        .map(item => ({ key: item.key, label: item.label, icon: navIcon(item.key, 20), route: item.key })),
    }))
    default: return []
  }
}

// ── 시트 탭 / 메뉴 정의 ───────────────────────────────────────────
// 시트 탭은 핵심 6개 + 관제만 1차 노출, 나머지는 "도구" 서랍으로.

const SHEET_TABS = [...PRIMARY_NAV_ITEMS, CONTROL_NAV_ITEM].map(item => ({
  key: item.key,
  label: item.label,
  icon: navIcon(item.key, 10),
}))

/** 메뉴 검색용 전체 목록 (도구 서랍 포함) */
const MENU_TABS = ALL_NAV_ITEMS.map(item => ({
  key: item.key,
  label: item.label,
  icon: navIcon(item.key, 10),
}))

// ── 3패널 리사이즈 ────────────────────────────────────────────────

const MIN_LEFT  = 240  // px
const MIN_MID   = 300  // px
const MIN_RIGHT = 280  // px
const RECENT_MENU_STORAGE_KEY = 'excel-shell:recent-menu-routes:v1'
const ZOOM_STORAGE_KEY = 'excel-shell:zoom:v1'
const MAX_RECENT_MENU_ITEMS = 6
const ZOOM_MIN = 50
const ZOOM_MAX = 200
const ZOOM_STEP = 10
const ULTRA_COMPACT_MEDIA_QUERY = '(max-width: 639px)'

function isUltraCompactViewport() {
  if (typeof window === 'undefined') return false
  return window.matchMedia(ULTRA_COMPACT_MEDIA_QUERY).matches
}

function getZoomStorageKey(isUltraCompact: boolean) {
  return `${ZOOM_STORAGE_KEY}:${isUltraCompact ? 'mobile' : 'desktop'}`
}

function clampZoom(value: number, min = ZOOM_MIN) {
  return Math.max(min, Math.min(ZOOM_MAX, Math.round(value / ZOOM_STEP) * ZOOM_STEP))
}

function readInitialZoom() {
  const ultraCompact = isUltraCompactViewport()
  const minZoom = ultraCompact ? 100 : ZOOM_MIN

  const parseStoredZoom = (raw: string | null) => {
    if (raw == null) return null
    const trimmed = raw.trim()
    if (!trimmed) return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }

  try {
    const scopedRaw = window.localStorage.getItem(getZoomStorageKey(ultraCompact))
    const scopedValue = parseStoredZoom(scopedRaw)
    if (scopedValue != null) return clampZoom(scopedValue, minZoom)

    const legacyRaw = window.localStorage.getItem(ZOOM_STORAGE_KEY)
    const legacyValue = parseStoredZoom(legacyRaw)
    if (legacyValue != null) return clampZoom(legacyValue, minZoom)
  } catch {
    // ignore
  }

  return 100
}

function getDefaultPanelWidths(viewportWidth: number) {
  if (viewportWidth >= 1800) return { left: 320, right: 520 }
  if (viewportWidth >= 1600) return { left: 310, right: 480 }
  if (viewportWidth >= 1400) return { left: 300, right: 440 }
  return { left: 300, right: 360 }
}

function usePanelResize(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [leftW, setLeftW]   = useState(() => getDefaultPanelWidths(typeof window !== 'undefined' ? window.innerWidth : 1440).left)
  const [rightW, setRightW] = useState(() => getDefaultPanelWidths(typeof window !== 'undefined' ? window.innerWidth : 1440).right)
  const drag = useRef<{ side: 'left' | 'right'; startX: number; startW: number } | null>(null)
  const userAdjustedRef = useRef(false)

  const startDrag = useCallback((side: 'left' | 'right', e: React.MouseEvent) => {
    e.preventDefault()
    userAdjustedRef.current = true
    drag.current = { side, startX: e.clientX, startW: side === 'left' ? leftW : rightW }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [leftW, rightW])

  useEffect(() => {
    const applyDefaultWidths = () => {
      if (userAdjustedRef.current) return
      const next = getDefaultPanelWidths(window.innerWidth)
      setLeftW(next.left)
      setRightW(next.right)
    }

    applyDefaultWidths()
    window.addEventListener('resize', applyDefaultWidths)
    return () => window.removeEventListener('resize', applyDefaultWidths)
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!drag.current || !containerRef.current) return
      const { side, startX, startW } = drag.current
      const dx = e.clientX - startX
      const cw = containerRef.current.getBoundingClientRect().width
      if (side === 'left') {
        setLeftW(Math.max(MIN_LEFT, Math.min(startW + dx, cw - MIN_MID - MIN_RIGHT)))
      } else {
        setRightW(Math.max(MIN_RIGHT, Math.min(startW - dx, cw - MIN_MID - MIN_LEFT)))
      }
    }
    const onUp = () => {
      drag.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [containerRef])

  return { leftW, rightW, startDrag }
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────

export default function ExcelShell({
  children,
  activeRoute = '',
  onNavigate,
  onQuickSave,
  onOpenProfile,
  contextLabel,
  quickSaveTooltip,
  contentMode = 'legacy',
  leftPanel,
  rightPanel,
}: Props) {
  const { authName, authEmail, isSignedIn } = useAuthStore()
  const profile = useProfileStore(s => s.profile)
  const [ribbonTab, setRibbonTab] = useState<RibbonTabKey>('home')
  const [zoom, setZoom] = useState(readInitialZoom)
  const [menuQuery, setMenuQuery] = useState('')
  const [searchPanelOpen, setSearchPanelOpen] = useState(false)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const [recentMenuRoutes, setRecentMenuRoutes] = useState<string[]>([])
  const [ribbonScrollHint, setRibbonScrollHint] = useState({ left: false, right: false })
  const [toolsDrawerOpen, setToolsDrawerOpen] = useState(false)
  const toolsDrawerRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const ribbonBodyRef = useRef<HTMLDivElement>(null)
  const searchContainerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { leftW, rightW, startDrag } = usePanelResize(containerRef)

  const displayName = profile.nickname || profile.telegramName || authName || authEmail || '사용자'
  const activeMenu = MENU_TABS.find(t => t.key === activeRoute)
  const isToolRouteActive = TOOL_NAV_ITEMS.some(item => item.key === activeRoute)
  const activeSheetIndex = Math.max(0, SHEET_TABS.findIndex(t => t.key === activeRoute))
  const pageLabel   = activeMenu?.label ?? activeRoute ?? ''
  const nameBox     = activeRoute ? activeRoute.toUpperCase().slice(0, 6) : 'A1'
  const groups      = getRibbonGroups(ribbonTab)
  const workbookTitle = useMemo(() => {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    return `market_brief_${y}${m}${d}.xlsx`
  }, [])
  const zoomFactor = zoom / 100

  const userInitials = useMemo(() => {
    const name = profile.nickname || profile.telegramName || authName || ''
    if (!name) return '?'
    const parts = name.trim().split(/\s+/)
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    return name.slice(0, 2).toUpperCase()
  }, [profile, authName])

  const [currentTime, setCurrentTime] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
  })

  const [isUltraCompact, setIsUltraCompact] = useState(false)
  const isSearchVisible = !isUltraCompact || mobileSearchOpen

  const routeByMenuQuery = useCallback((query: string) => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return ''
    const exact = MENU_TABS.find(tab => tab.key === normalized || tab.label.toLowerCase() === normalized)
    if (exact) return exact.key
    const partial = MENU_TABS.find(tab => tab.label.toLowerCase().includes(normalized) || tab.key.includes(normalized))
    return partial?.key ?? ''
  }, [])

  const recommendedRoutes = useMemo(() => {
    const routes = groups
      .flatMap(group => group.buttons)
      .map(button => button.route?.split('?')[0])
      .filter((route): route is string => !!route)
    return Array.from(new Set(routes)).slice(0, 5)
  }, [groups])

  const filteredMenuTabs = useMemo(() => {
    const normalized = menuQuery.trim().toLowerCase()
    const list = normalized
      ? MENU_TABS.filter(tab => tab.label.toLowerCase().includes(normalized) || tab.key.includes(normalized))
      : MENU_TABS
    return list.slice(0, 12)
  }, [menuQuery])

  const recentMenuTabs = useMemo(() => {
    return recentMenuRoutes
      .map(route => MENU_TABS.find(tab => tab.key === route))
      .filter((tab): tab is typeof MENU_TABS[number] => !!tab)
  }, [recentMenuRoutes])

  const recommendedMenuTabs = useMemo(() => {
    return recommendedRoutes
      .map(route => MENU_TABS.find(tab => tab.key === route))
      .filter((tab): tab is typeof MENU_TABS[number] => !!tab)
  }, [recommendedRoutes])

  const navigateSheetIndex = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(SHEET_TABS.length - 1, index))
    onNavigate(SHEET_TABS[clamped].key)
  }, [onNavigate])

  const navigateSheetOffset = useCallback((offset: number) => {
    navigateSheetIndex(activeSheetIndex + offset)
  }, [activeSheetIndex, navigateSheetIndex])

  const isAtFirstSheet = activeSheetIndex <= 0
  const isAtLastSheet = activeSheetIndex >= SHEET_TABS.length - 1

  const commitMenuNavigation = useCallback((route: string) => {
    const tab = MENU_TABS.find(item => item.key === route)
    if (!tab) return
    onNavigate(route)
    setMenuQuery(tab.label)
    setRecentMenuRoutes(prev => {
      const next = [route, ...prev.filter(item => item !== route)].slice(0, MAX_RECENT_MENU_ITEMS)
      return next
    })
    setSearchPanelOpen(false)
    setMobileSearchOpen(false)
  }, [onNavigate])

  const handleMenuSearch = useCallback((e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const route = routeByMenuQuery(menuQuery)
    if (!route) return
    commitMenuNavigation(route)
  }, [commitMenuNavigation, menuQuery, routeByMenuQuery])

  const handleQuickSave = useCallback(async () => {
    if (onQuickSave) {
      await onQuickSave({ activeRoute, pageLabel })
      return
    }
    onNavigate('reports')
  }, [activeRoute, onNavigate, onQuickSave, pageLabel])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!searchContainerRef.current) return
      if (!searchContainerRef.current.contains(e.target as Node)) {
        setSearchPanelOpen(false)
        setMobileSearchOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (!toolsDrawerOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (!toolsDrawerRef.current) return
      if (!toolsDrawerRef.current.contains(e.target as Node)) setToolsDrawerOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [toolsDrawerOpen])

  useEffect(() => {
    if (!isUltraCompact || !mobileSearchOpen) return
    const tid = window.setTimeout(() => {
      searchInputRef.current?.focus()
    }, 0)
    return () => window.clearTimeout(tid)
  }, [isUltraCompact, mobileSearchOpen])

  useEffect(() => {
    try {
      const rawRecent = window.localStorage.getItem(RECENT_MENU_STORAGE_KEY)
      if (rawRecent) {
        const parsed = JSON.parse(rawRecent)
        if (Array.isArray(parsed)) {
          setRecentMenuRoutes(parsed.filter((item): item is string => typeof item === 'string').slice(0, MAX_RECENT_MENU_ITEMS))
        }
      }
    } catch {
      setRecentMenuRoutes([])
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem(RECENT_MENU_STORAGE_KEY, JSON.stringify(recentMenuRoutes))
  }, [recentMenuRoutes])

  useEffect(() => {
    window.localStorage.setItem(getZoomStorageKey(isUltraCompact), String(zoom))
    window.localStorage.setItem(ZOOM_STORAGE_KEY, String(zoom))
  }, [isUltraCompact, zoom])

  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setCurrentTime(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`)
    }
    const id = window.setInterval(tick, 60000)
    return () => window.clearInterval(id)
  }, [])

  // 좌/우 패널 표시 여부 (반응형)
  const [visiblePanels, setVisiblePanels] = useState<'all' | 'no-right' | 'center-only'>('all')
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth
      setIsUltraCompact(w < 640)
      if (w < 640)       setVisiblePanels('center-only')
      else if (w < 1024) setVisiblePanels('no-right')
      else               setVisiblePanels('all')
      if (w >= 640) setMobileSearchOpen(false)
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  useEffect(() => {
    setZoom(prev => {
      const minZoom = isUltraCompact ? 100 : ZOOM_MIN
      const next = readInitialZoom()
      const normalizedPrev = clampZoom(prev, minZoom)
      return next === normalizedPrev ? normalizedPrev : next
    })
  }, [isUltraCompact])

  useEffect(() => {
    const el = ribbonBodyRef.current
    if (!el || !isUltraCompact) {
      setRibbonScrollHint({ left: false, right: false })
      return
    }

    const updateRibbonScrollHint = () => {
      const maxScrollLeft = el.scrollWidth - el.clientWidth
      if (maxScrollLeft <= 2) {
        setRibbonScrollHint({ left: false, right: false })
        return
      }
      const nextLeft = el.scrollLeft > 2
      const nextRight = el.scrollLeft < maxScrollLeft - 2
      setRibbonScrollHint((prev) => {
        if (prev.left === nextLeft && prev.right === nextRight) return prev
        return { left: nextLeft, right: nextRight }
      })
    }

    updateRibbonScrollHint()
    el.addEventListener('scroll', updateRibbonScrollHint, { passive: true })
    window.addEventListener('resize', updateRibbonScrollHint)
    const rafId = window.requestAnimationFrame(updateRibbonScrollHint)

    return () => {
      el.removeEventListener('scroll', updateRibbonScrollHint)
      window.removeEventListener('resize', updateRibbonScrollHint)
      window.cancelAnimationFrame(rafId)
    }
  }, [isUltraCompact, ribbonTab])

  return (
    <div
      className="excel-app"
      style={{
        ['--excel-ui-zoom' as any]: 1,
        ['--excel-sheet-zoom' as any]: 1,
        ['--excel-global-zoom' as any]: `${zoomFactor}`,
      }}
    >

      {/* ── 1. 타이틀 바 ── */}
      <div className="excel-titlebar">

        {/* 좌측: 앱 아이콘 + 빠른 실행 도구 */}
        <div className="excel-titlebar__left">
          <div className="excel-titlebar__app-icon" aria-label="Excel">
            <span className="excel-titlebar__app-icon-x">X</span>
          </div>
          <div className="excel-titlebar__qs">
            <button className="excel-titlebar__qs-btn excel-tooltip-target" data-tooltip="즐겨찾기 목록" onClick={() => onNavigate('watchlist')}><Star size={13}/></button>
            <button className="excel-titlebar__qs-btn excel-tooltip-target" data-tooltip={quickSaveTooltip || '현재 화면 저장'} onClick={() => void handleQuickSave()}><Save size={13}/></button>
            <button className="excel-titlebar__qs-btn excel-tooltip-target" data-tooltip="관제" onClick={() => onNavigate('control')}><Shield size={13}/></button>
            <button className="excel-titlebar__qs-btn excel-tooltip-target" data-tooltip="실행 취소" onClick={() => window.history.back()}><Undo2 size={13}/></button>
            <button className="excel-titlebar__qs-btn excel-tooltip-target" data-tooltip="다시 실행" onClick={() => window.history.forward()}><Redo2 size={13}/></button>
            <button className="excel-titlebar__qs-chevron" aria-label="빠른 실행 도구 모음 사용자 지정"><ChevronDown size={10}/></button>
          </div>
        </div>

        {/* 중앙: 파일명 */}
        <div className="excel-titlebar__center">
          <button className="excel-titlebar__star-btn excel-tooltip-target" data-tooltip="즐겨찾기에 추가" onClick={() => onNavigate('watchlist')}><Star size={12}/></button>
          <span className="excel-titlebar__app-name">{workbookTitle}</span>
        </div>

        {/* 우측: 검색 + 사용자 아바타 + 창 컨트롤 */}
        <div className="excel-titlebar__right">
          {isUltraCompact && (
            <button
              type="button"
              className="excel-titlebar__search-toggle"
              aria-label="메뉴 검색 열기"
              aria-expanded={mobileSearchOpen}
              onClick={() => {
                setMobileSearchOpen(prev => {
                  const next = !prev
                  if (!next) setSearchPanelOpen(false)
                  return next
                })
                if (!searchPanelOpen) setSearchPanelOpen(true)
              }}
            >
              <Search size={12} />
            </button>
          )}
          <div
            className={`excel-titlebar__search-wrap${isUltraCompact ? ' is-mobile' : ''}${isUltraCompact && mobileSearchOpen ? ' is-open' : ''}`}
            ref={searchContainerRef}
          >
            <form className="excel-titlebar__search" onSubmit={handleMenuSearch}>
              <Search size={12} />
              <input
                ref={searchInputRef}
                className="excel-titlebar__search-input"
                value={menuQuery}
                onFocus={() => setSearchPanelOpen(true)}
                onChange={e => {
                  setMenuQuery(e.target.value)
                  setSearchPanelOpen(true)
                }}
                placeholder="메뉴 이동 (예: 스캔, 포트폴리오)"
              />
            </form>
            {isSearchVisible && searchPanelOpen && (
              <div className="excel-search-panel" role="listbox" aria-label="메뉴 검색 추천">
                {recentMenuTabs.length > 0 && (
                  <div className="excel-search-panel__section">
                    <div className="excel-search-panel__title">최근 사용</div>
                    {recentMenuTabs.map(tab => (
                      <button
                        key={`recent-${tab.key}`}
                        className="excel-search-panel__item"
                        onClick={() => commitMenuNavigation(tab.key)}
                      >
                        <span>{tab.label}</span>
                        <small>{tab.key}</small>
                      </button>
                    ))}
                  </div>
                )}
                {recommendedMenuTabs.length > 0 && (
                  <div className="excel-search-panel__section">
                    <div className="excel-search-panel__title">추천 메뉴</div>
                    {recommendedMenuTabs.map(tab => (
                      <button
                        key={`recommended-${tab.key}`}
                        className="excel-search-panel__item"
                        onClick={() => commitMenuNavigation(tab.key)}
                      >
                        <span>{tab.label}</span>
                        <small>{tab.key}</small>
                      </button>
                    ))}
                  </div>
                )}
                <div className="excel-search-panel__section">
                  <div className="excel-search-panel__title">전체 메뉴</div>
                  {filteredMenuTabs.map(tab => (
                    <button
                      key={`all-${tab.key}`}
                      className="excel-search-panel__item"
                      onClick={() => commitMenuNavigation(tab.key)}
                    >
                      <span>{tab.label}</span>
                      <small>{tab.key}</small>
                    </button>
                  ))}
                  {filteredMenuTabs.length === 0 && (
                    <div className="excel-search-panel__empty">검색 결과가 없습니다.</div>
                  )}
                </div>
              </div>
            )}
          </div>
          {isSignedIn && (
            <button className="excel-titlebar__user-avatar excel-tooltip-target" data-tooltip={displayName} onClick={onOpenProfile}>
              {userInitials}
            </button>
          )}
          {!isUltraCompact && (
            <div className="excel-titlebar__window-btns">
              <button className="excel-titlebar__win-btn" aria-label="최소화">─</button>
              <button className="excel-titlebar__win-btn" aria-label="최대화">□</button>
              <button className="excel-titlebar__win-btn excel-titlebar__win-btn--close" aria-label="닫기">✕</button>
            </div>
          )}
        </div>

      </div>

      {/* ── 2. 리본 탭 ── */}
      <div className="excel-ribbon-tabs" role="tablist">
        <button className="excel-ribbon-tab" aria-label="파일 메뉴"> {/* excel-ribbon-tab--file */}
          파일
        </button>
        {RIBBON_TABS.map(t => (
          <button
            key={t.key}
            role="tab"
            aria-selected={ribbonTab === t.key}
            className={`excel-ribbon-tab${ribbonTab === t.key ? ' excel-ribbon-tab--active' : ''}`}
            onClick={() => setRibbonTab(t.key as RibbonTabKey)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── 3. 리본 바디 ── */}
      <div
        ref={ribbonBodyRef}
        className={`excel-ribbon-body${ribbonScrollHint.left ? ' excel-ribbon-body--hint-left' : ''}${ribbonScrollHint.right ? ' excel-ribbon-body--hint-right' : ''}`}
        role="toolbar"
      >
        <div className="excel-ribbon-body__content">
          <div className="excel-ribbon-body__zone excel-ribbon-body__zone--primary">
            {groups.map((g, gi) => (
              <div key={gi} className="excel-ribbon-group">
                <div className="excel-ribbon-group__buttons">
                  {g.buttons.map(btn => (
                    <button
                      key={btn.key}
                      className={`ribbon-btn excel-tooltip-target${btn.route?.split('?')[0] === activeRoute ? ' ribbon-btn--active' : ''}`}
                      onClick={() => btn.route && onNavigate(btn.route)}
                      data-tooltip={btn.label}
                    >
                      <span className="ribbon-btn__icon">{btn.icon}</span>
                      <span className="ribbon-btn__label">{btn.label}</span>
                    </button>
                  ))}
                </div>
                <div className="excel-ribbon-group__label">{g.label}</div>
              </div>
            ))}
          </div>

        </div>
      </div>

      {/* ── 4. 수식 표시줄 ── */}
      <div className="excel-formula-bar">
        <div className="excel-formula-bar__name-box">{nameBox}</div>
        <div className="excel-formula-bar__divider">
          <button className="excel-formula-bar__fn-btn excel-tooltip-target" data-tooltip="함수">
            <em style={{ fontFamily: 'Georgia,serif', fontStyle: 'italic' }}>f</em>
            <span style={{ fontStyle: 'normal', fontSize: 9 }}>x</span>
          </button>
        </div>
        <input
          className="excel-formula-bar__input"
          readOnly
          value="=MARKETBRIEF(AUTO)"
          placeholder="페이지를 선택하세요"
        />
      </div>

      {/* ── 5. 3패널 메인 영역 ── */}
      <div className="excel-main-panels" ref={containerRef}>

        {/* 좌측 패널 (시세) */}
        {leftPanel && visiblePanels === 'all' && (
          <>
            <div className="excel-side-panel excel-side-panel--left" style={{ width: leftW, minWidth: leftW, maxWidth: leftW }}>
              {leftPanel}
            </div>
            <div
              className="excel-panel-divider excel-tooltip-target"
              data-tooltip="드래그해서 너비 조절"
              onMouseDown={e => startDrag('left', e)}
            />
          </>
        )}

        {/* 중앙 패널 (현재 페이지) */}
        <div className="excel-center-panel">
          <ExcelContentArea isNativeGrid={contentMode === 'native'}>
            {children}
          </ExcelContentArea>
        </div>

        {/* 우측 패널 (알림/채팅) */}
        {rightPanel && visiblePanels === 'all' && (
          <>
            <div
              className="excel-panel-divider excel-tooltip-target"
              data-tooltip="드래그해서 너비 조절"
              onMouseDown={e => startDrag('right', e)}
            />
            <div className="excel-side-panel excel-side-panel--right" style={{ width: rightW, minWidth: rightW, maxWidth: rightW }}>
              {rightPanel}
            </div>
          </>
        )}
      </div>

      {/* ── 6. 시트 탭 ── */}
      <div style={{ position: 'relative' }} ref={toolsDrawerRef}>
        {toolsDrawerOpen && (
          <div
            role="menu"
            aria-label="도구 메뉴"
            style={{
              position: 'absolute',
              bottom: '100%',
              left: 8,
              marginBottom: 4,
              zIndex: 320,
              minWidth: 220,
              maxWidth: 420,
              maxHeight: '60vh',
              overflowY: 'auto',
              background: 'var(--color-bg-elevated, #fff)',
              border: '1px solid var(--color-excel-grid-border)',
              borderRadius: 6,
              boxShadow: '0 8px 24px rgba(16, 24, 40, 0.16)',
              padding: 'var(--space-2, 8px)',
            }}
          >
            {TOOL_NAV_GROUPS.map(group => {
              const items = group.items.filter(item => !item.adminOnly)
              if (items.length === 0) return null
              return (
                <div key={group.category} style={{ marginBottom: 6 }}>
                  <div className="caption muted" style={{ padding: '2px 6px', fontWeight: 700 }}>{group.category}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {items.map(item => (
                      <button
                        key={item.key}
                        role="menuitem"
                        className={`excel-sheet-tab${activeRoute === item.key ? ' excel-sheet-tab--active' : ''}`}
                        style={{ borderRadius: 4, padding: '4px 8px' }}
                        onClick={() => { onNavigate(item.key); setToolsDrawerOpen(false) }}
                      >
                        {navIcon(item.key, 10)}<span className="excel-sheet-tab__label">{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <div className="excel-sheet-tabs">
          <div className="excel-sheet-tabs__nav-arrows">
            <button className="excel-sheet-tabs__nav-btn" onClick={() => navigateSheetIndex(0)} disabled={isAtFirstSheet} aria-label="첫 시트"><ChevronLeft size={10}/></button>
            <button className="excel-sheet-tabs__nav-btn" onClick={() => navigateSheetOffset(-1)} disabled={isAtFirstSheet} aria-label="이전 시트"><ChevronLeft size={10}/></button>
            <button className="excel-sheet-tabs__nav-btn" onClick={() => navigateSheetOffset(1)} disabled={isAtLastSheet} aria-label="다음 시트"><ChevronRight size={10}/></button>
            <button className="excel-sheet-tabs__nav-btn" onClick={() => navigateSheetIndex(SHEET_TABS.length - 1)} disabled={isAtLastSheet} aria-label="마지막 시트"><ChevronRight size={10}/></button>
          </div>
          {SHEET_TABS.map(tab => (
            <button
              key={tab.key}
              className={`excel-sheet-tab${activeRoute === tab.key ? ' excel-sheet-tab--active' : ''}`}
              onClick={() => onNavigate(tab.key)}
            >
              {tab.icon}<span className="excel-sheet-tab__label">{tab.label}</span>
            </button>
          ))}
          <button
            className={`excel-sheet-tab${isToolRouteActive ? ' excel-sheet-tab--active' : ''}`}
            aria-haspopup="menu"
            aria-expanded={toolsDrawerOpen}
            onClick={() => setToolsDrawerOpen(prev => !prev)}
          >
            <Wrench size={10}/><span className="excel-sheet-tab__label">도구</span>{toolsDrawerOpen ? <ChevronDown size={10}/> : <ChevronUp size={10}/>}
          </button>
        </div>
      </div>

      {/* ── 7. 상태 바 ── */}
      <div className="excel-statusbar">
        <div className="excel-statusbar__left">
          <span className="excel-statusbar__item">준비</span>
          <span className="excel-statusbar__item excel-statusbar__item--clickable" onClick={() => onNavigate('alerts')}>
            <Bell size={9}/> 알림
          </span>
          <span className="excel-statusbar__item excel-statusbar__item--clickable" onClick={() => onNavigate('market')}>
            <Activity size={9}/> 시장
          </span>
        </div>
        <div className="excel-statusbar__right">
          {isSignedIn && (
            <span className="excel-statusbar__item excel-statusbar__item--user excel-statusbar__item--clickable" onClick={onOpenProfile}>
              @{displayName}
            </span>
          )}
          <span className="excel-statusbar__item excel-statusbar__item--datetime">{currentTime}</span>
          <span className="excel-statusbar__item excel-statusbar__item--market">국장 본장 / 미장 데이터핫</span>
          <div className="excel-statusbar__zoom">
            <button
              type="button"
              className="excel-statusbar__zoom-btn"
              aria-label="축소"
              onClick={() => setZoom(z => Math.max(ZOOM_MIN, z - ZOOM_STEP))}
            >
              <Minus size={9} />
            </button>
            <input type="range" className="excel-statusbar__zoom-slider" min={ZOOM_MIN} max={ZOOM_MAX} step={ZOOM_STEP}
              value={zoom} onChange={e => setZoom(Number(e.target.value))}/>
            <button
              type="button"
              className="excel-statusbar__zoom-btn"
              aria-label="확대"
              onClick={() => setZoom(z => Math.min(ZOOM_MAX, z + ZOOM_STEP))}
            >
              <Plus size={9} />
            </button>
            <button
              type="button"
              className="excel-statusbar__zoom-pct"
              title="100%로 초기화"
              onClick={() => setZoom(100)}
            >
              {zoom}%
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
