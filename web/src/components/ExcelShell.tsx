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
import { Save, Undo2, Redo2, Star, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Minus, Plus, LayoutDashboard, ScanSearch, BarChart2, FlaskConical, BriefcaseBusiness, FileText, Globe2, Newspaper, Bell, User, Settings, Database, Shield, ShieldCheck, Wrench, Zap, History, Search, PieChart, Activity, Target, Eye, List, PiggyBank, Sprout, Flag, ClipboardCheck, Blend, Baby, Copy, RotateCcw, Scale, Rocket, Receipt, LayoutGrid, Maximize2, Minimize2, X } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { useProfileStore } from '../stores/profileStore'
import { useDetailed, useViewModeStore } from '../stores/viewModeStore'
import { CONTROL_NAV_ITEM, ALL_NAV_ITEMS, SHEET_NAV_KEYS, filterNavItems, menuSectionsFor, plainNavItems, type MenuSection } from '../navigation'
import ExcelContentArea from './ExcelContentArea'
import BotUsageBanner from './BotUsageBanner'
import { useVisualViewportVars } from '../hooks/useVisualViewportVars'

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
  'accumulate': PiggyBank,
  'seed-builder': Sprout,
  'money-flow': Receipt,
  'goal-tracker': Flag,
  'plan': ClipboardCheck,
  'mix': Blend,
  'child': Baby,
  'follow': Copy,
  'choices': RotateCcw,
  'income-guide': Scale,
  'start': Rocket,
}

function navIcon(key: string, size: number): React.ReactNode {
  const Icon = NAV_ICON_COMPONENTS[key] ?? FileText
  return <Icon size={size} />
}

// ── 리본 정의 ────────────────────────────────────────────────────
// 더미(준비 중) 버튼 없이 실제 동작하는 액션만 노출한다.

// 탭·그룹은 navigation.ts의 MENU_SECTIONS에서 나온다. 관제는 관리자 전용 탭으로 따로 둔다.

type RibbonTabKey = string
type RibbonBtn = { key: string; label: string; icon: React.ReactNode; route?: string }
type RibbonGroup = { label: string; buttons: RibbonBtn[] }

const CONTROL_RIBBON_GROUPS: RibbonGroup[] = [
  { label: '관제 바로가기', buttons: [
    { key: 'control-audit',       label: '검산',     icon: <ShieldCheck size={20}/>, route: 'control?tab=audit' },
    { key: 'control-operations',  label: '운영',     icon: <Activity size={20}/>,    route: 'control?tab=operations' },
    { key: 'control-data',        label: '데이터',   icon: <Database size={20}/>,    route: 'control?tab=data' },
    { key: 'control-maintenance', label: '유지보수', icon: <Wrench size={20}/>,      route: 'control?tab=maintenance' },
  ]},
]

function getRibbonGroups(tab: RibbonTabKey, sections: MenuSection[]): RibbonGroup[] {
  if (tab === 'control') return CONTROL_RIBBON_GROUPS
  const section = sections.find((s) => s.key === tab) ?? sections[0]
  return (section?.groups ?? []).map((group) => ({
    label: group.category,
    buttons: group.items.map((item) => ({ key: item.key, label: item.label, icon: navIcon(item.key, 20), route: item.key })),
  }))
}

// ── 시트 탭 / 메뉴 정의 ───────────────────────────────────────────
// 시트 탭은 매일 여는 화면(SHEET_NAV_KEYS) + 관리자 관제만, 나머지는 리본과 "전체 메뉴" 서랍으로.

const toTab = (item: { key: string; label: string }) => ({
  key: item.key,
  label: item.label,
  icon: navIcon(item.key, 10),
})

const SHEET_NAV_ITEMS = SHEET_NAV_KEYS.map((key) => ALL_NAV_ITEMS.find((item) => item.key === key)!).filter(Boolean)
const ADMIN_SHEET_TABS = [...SHEET_NAV_ITEMS, CONTROL_NAV_ITEM].map(toTab)
const USER_SHEET_TABS = filterNavItems(SHEET_NAV_ITEMS, false).map(toTab)
const ADMIN_SECTIONS = menuSectionsFor(true)
const USER_SECTIONS = menuSectionsFor(false)

/** 메뉴 검색용 전체 목록 (전체 메뉴 서랍 포함) */
const ADMIN_MENU_TABS = ALL_NAV_ITEMS.map(toTab)
const USER_MENU_TABS = plainNavItems(filterNavItems(ALL_NAV_ITEMS, false)).map(toTab)

// ── 3패널 리사이즈 ────────────────────────────────────────────────

const MIN_LEFT  = 240  // px
const MIN_MID   = 480  // px
const MIN_RIGHT = 280  // px
const RECENT_MENU_STORAGE_KEY = 'excel-shell:recent-menu-routes:v1'
const ZOOM_STORAGE_KEY = 'excel-shell:zoom:v1'
const QS_VISIBLE_STORAGE_KEY = 'excel-shell:qs-visible:v1'
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

const QS_ITEMS_META = [
  { key: 'watchlist', label: '즐겨찾기 목록' },
  { key: 'quicksave', label: '현재 화면 저장' },
  { key: 'control', label: '관제' },
  { key: 'undo', label: '실행 취소' },
  { key: 'redo', label: '다시 실행' },
] as const

type QsKey = typeof QS_ITEMS_META[number]['key']
type QsVisibleMap = Record<QsKey, boolean>

const QS_VISIBLE_DEFAULTS: QsVisibleMap = {
  watchlist: true, quicksave: true, control: true, undo: true, redo: true,
}

function readQsVisible(): QsVisibleMap {
  if (typeof window === 'undefined') return QS_VISIBLE_DEFAULTS
  try {
    const raw = window.localStorage.getItem(QS_VISIBLE_STORAGE_KEY)
    if (!raw) return QS_VISIBLE_DEFAULTS
    const parsed = JSON.parse(raw) as Partial<QsVisibleMap>
    return { ...QS_VISIBLE_DEFAULTS, ...parsed }
  } catch {
    return QS_VISIBLE_DEFAULTS
  }
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
  useVisualViewportVars()
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
  const [qsVisible, setQsVisible] = useState<QsVisibleMap>(readQsVisible)
  const [qsCustomizeOpen, setQsCustomizeOpen] = useState(false)
  const qsCustomizeRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const ribbonBodyRef = useRef<HTMLDivElement>(null)
  const searchContainerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { leftW, rightW, startDrag } = usePanelResize(containerRef)

  const displayName = profile.nickname || profile.telegramName || authName || authEmail || '사용자'
  const isAdmin = useProfileStore(s => s.isAdmin)
  const detailed = useDetailed()
  const setViewMode = useViewModeStore(s => s.setMode)
  const SHEET_TABS = isAdmin ? ADMIN_SHEET_TABS : USER_SHEET_TABS
  const MENU_TABS = isAdmin ? ADMIN_MENU_TABS : USER_MENU_TABS
  const sections = isAdmin ? ADMIN_SECTIONS : USER_SECTIONS
  // '파일'은 Excel처럼 탭 줄 맨 앞의 초록 버튼으로 따로 그린다
  const ribbonTabs = useMemo(() => [
    ...sections.filter(s => s.key !== 'file').map(s => ({ key: s.key, label: s.label })),
    ...(isAdmin ? [{ key: 'control', label: '관제' }] : []),
  ], [sections, isAdmin])
  const activeMenu = MENU_TABS.find(t => t.key === activeRoute)
  const isToolRouteActive = !!activeRoute && !SHEET_TABS.some(t => t.key === activeRoute) && MENU_TABS.some(t => t.key === activeRoute)
  const activeSheetIndex = Math.max(0, SHEET_TABS.findIndex(t => t.key === activeRoute))
  const pageLabel   = activeMenu?.label ?? activeRoute ?? ''
  const nameBox     = activeRoute ? activeRoute.toUpperCase().slice(0, 6) : 'A1'
  const groups      = getRibbonGroups(ribbonTab === 'file' || ribbonTabs.some(t => t.key === ribbonTab) ? ribbonTab : 'home', sections)
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

  // '최대화' 버튼 — 브라우저 탭에서는 OS 창 자체를 최대화할 API가 없으므로
  // 실제로 동작 가능한 전체화면(Fullscreen API) 전환으로 대체한다.
  const [isFullscreen, setIsFullscreen] = useState(() =>
    typeof document !== 'undefined' && !!document.fullscreenElement
  )
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {})
    } else {
      void document.documentElement.requestFullscreen?.().catch(() => {})
    }
  }, [])

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

  // 시트 탭이 화면보다 길 때 — 가려진 쪽에 화살표를 띄우고, 활성 탭은 항상 보이게 맞춘다
  const sheetTabsRef = useRef<HTMLDivElement>(null)
  const [tabsOverflow, setTabsOverflow] = useState({ left: false, right: false })
  const updateTabsOverflow = useCallback(() => {
    const el = sheetTabsRef.current
    if (!el) return
    const left = el.scrollLeft > 4
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4
    setTabsOverflow(prev => (prev.left === left && prev.right === right ? prev : { left, right }))
  }, [])
  const scrollSheetTabs = useCallback((direction: -1 | 1) => {
    const el = sheetTabsRef.current
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.6, behavior: 'smooth' })
  }, [])
  useEffect(() => {
    const el = sheetTabsRef.current
    if (!el) return
    updateTabsOverflow()
    el.addEventListener('scroll', updateTabsOverflow, { passive: true })
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateTabsOverflow) : null
    observer?.observe(el)
    return () => { el.removeEventListener('scroll', updateTabsOverflow); observer?.disconnect() }
  }, [updateTabsOverflow])
  useEffect(() => {
    const el = sheetTabsRef.current
    const active = el?.querySelector<HTMLElement>('.excel-sheet-tab--active')
    if (!el || !active) return
    const pad = 36 // 가장자리 화살표에 가리지 않을 여유
    if (active.offsetLeft - pad < el.scrollLeft) el.scrollTo({ left: Math.max(0, active.offsetLeft - pad), behavior: 'smooth' })
    else if (active.offsetLeft + active.offsetWidth + pad > el.scrollLeft + el.clientWidth) el.scrollTo({ left: active.offsetLeft + active.offsetWidth + pad - el.clientWidth, behavior: 'smooth' })
  }, [activeRoute, isToolRouteActive])

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
    if (!qsCustomizeOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (!qsCustomizeRef.current) return
      if (!qsCustomizeRef.current.contains(e.target as Node)) setQsCustomizeOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [qsCustomizeOpen])

  const toggleQsVisible = useCallback((key: QsKey) => {
    setQsVisible(prev => {
      const visibleCount = QS_ITEMS_META.reduce((n, item) => n + (prev[item.key] ? 1 : 0), 0)
      if (prev[key] && visibleCount <= 1) return prev
      const next = { ...prev, [key]: !prev[key] }
      try { window.localStorage.setItem(QS_VISIBLE_STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [])

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
      // 가운데 시트가 최소 ~700px 은 확보되도록: 양쪽 패널(300+360)은 넓은 화면에서만
      if (w < 1024)      setVisiblePanels('center-only')
      else if (w < 1360) setVisiblePanels('no-right')
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
          <div className="excel-titlebar__qs" style={{ position: 'relative' }} ref={qsCustomizeRef}>
            {qsVisible.watchlist && <button className="excel-titlebar__qs-btn excel-tooltip-target" data-tooltip="즐겨찾기 목록" onClick={() => onNavigate('watchlist')}><Star size={13}/></button>}
            {qsVisible.quicksave && <button className="excel-titlebar__qs-btn excel-tooltip-target" data-tooltip={quickSaveTooltip || '현재 화면 저장'} onClick={() => void handleQuickSave()}><Save size={13}/></button>}
            {qsVisible.control && <button className="excel-titlebar__qs-btn excel-tooltip-target" data-tooltip="관제" onClick={() => onNavigate('control')}><Shield size={13}/></button>}
            {qsVisible.undo && <button className="excel-titlebar__qs-btn excel-tooltip-target" data-tooltip="실행 취소" onClick={() => window.history.back()}><Undo2 size={13}/></button>}
            {qsVisible.redo && <button className="excel-titlebar__qs-btn excel-tooltip-target" data-tooltip="다시 실행" onClick={() => window.history.forward()}><Redo2 size={13}/></button>}
            <button
              className="excel-titlebar__qs-chevron"
              aria-label="빠른 실행 도구 모음 사용자 지정"
              aria-haspopup="menu"
              aria-expanded={qsCustomizeOpen}
              title="빠른 실행 도구 모음 사용자 지정"
              onClick={() => setQsCustomizeOpen(prev => !prev)}
            >
              <ChevronDown size={10}/>
            </button>
            {qsCustomizeOpen && (
              <div
                role="menu"
                aria-label="빠른 실행 도구 모음 사용자 지정"
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  marginTop: 4,
                  zIndex: 320,
                  minWidth: 200,
                  background: 'var(--color-bg-elevated, #fff)',
                  border: '1px solid var(--color-excel-grid-border)',
                  borderRadius: 6,
                  boxShadow: '0 8px 24px rgba(16, 24, 40, 0.16)',
                  padding: 'var(--space-2, 8px)',
                }}
              >
                <div className="caption muted" style={{ padding: '2px 6px 6px', fontWeight: 700 }}>빠른 실행 도구 모음 사용자 지정</div>
                {QS_ITEMS_META.map(item => (
                  <label
                    key={item.key}
                    role="menuitemcheckbox"
                    aria-checked={qsVisible[item.key]}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', fontSize: 12, cursor: 'pointer', color: 'var(--color-text-primary)' }}
                  >
                    <input
                      type="checkbox"
                      checked={qsVisible[item.key]}
                      onChange={() => toggleQsVisible(item.key)}
                    />
                    {item.label}
                  </label>
                ))}
              </div>
            )}
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
              <button className="excel-titlebar__win-btn" aria-label="최소화" disabled title="브라우저 탭에서는 지원되지 않습니다">─</button>
              <button className="excel-titlebar__win-btn" aria-label={isFullscreen ? '전체화면 종료' : '전체화면'} onClick={toggleFullscreen}>{isFullscreen ? <Minimize2 size={13} aria-hidden /> : <Maximize2 size={13} aria-hidden />}</button>
              <button className="excel-titlebar__win-btn excel-titlebar__win-btn--close" aria-label="닫기" disabled title="브라우저 탭에서는 지원되지 않습니다"><X size={14} aria-hidden /></button>
            </div>
          )}
        </div>

      </div>

      {/* ── 2. 리본 탭 ── */}
      <div className="excel-ribbon-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={ribbonTab === 'file'}
          className={`excel-ribbon-tab excel-ribbon-tab--file${ribbonTab === 'file' ? ' excel-ribbon-tab--active' : ''}`}
          onClick={() => setRibbonTab('file')}
        >
          파일
        </button>
        {ribbonTabs.map(t => (
          <button
            key={t.key}
            role="tab"
            aria-selected={ribbonTab === t.key}
            className={`excel-ribbon-tab${ribbonTab === t.key ? ' excel-ribbon-tab--active' : ''}`}
            onClick={() => setRibbonTab(t.key)}
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
          <button className="excel-formula-bar__fn-btn" disabled title="함수 편집은 아직 지원하지 않습니다">
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
        {leftPanel && visiblePanels !== 'center-only' && (
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
          <BotUsageBanner route={activeRoute} />
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
      <div className="excel-tools-drawer-anchor" ref={toolsDrawerRef}>
        {toolsDrawerOpen && (
          <div
            className="excel-tools-drawer"
            role="menu"
            aria-label="전체 메뉴"
          >
            {sections.map(section => {
              // 시트 탭에 이미 있는 화면은 빼고, 탭(섹션) 단위로 묶어 보여 준다
              const items = section.groups.flatMap(g => g.items).filter(item => !SHEET_TABS.some(t => t.key === item.key))
              if (items.length === 0) return null
              return (
                <div key={section.key} className="excel-tools-drawer__group">
                  <div className="excel-tools-drawer__label">{section.label}</div>
                  <div className="excel-tools-drawer__items">
                    {items.map(item => (
                      <button
                        key={item.key}
                        role="menuitem"
                        className={`excel-tools-drawer__item${activeRoute === item.key ? ' excel-tools-drawer__item--active' : ''}`}
                        onClick={() => { onNavigate(item.key); setToolsDrawerOpen(false) }}
                      >
                        {navIcon(item.key, 11)}<span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <div className="excel-sheet-tabs-wrap">
        <div className="excel-sheet-tabs" ref={sheetTabsRef}>
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
            <LayoutGrid size={10}/><span className="excel-sheet-tab__label">전체 메뉴</span>{toolsDrawerOpen ? <ChevronDown size={10}/> : <ChevronUp size={10}/>}
          </button>
        </div>
        {tabsOverflow.left && (
          <button className="excel-sheet-tabs__edge excel-sheet-tabs__edge--left" onClick={() => scrollSheetTabs(-1)} aria-label="왼쪽 시트 더 보기"><ChevronLeft size={16}/></button>
        )}
        {tabsOverflow.right && (
          <button className="excel-sheet-tabs__edge excel-sheet-tabs__edge--right" onClick={() => scrollSheetTabs(1)} aria-label="오른쪽 시트 더 보기"><ChevronRight size={16}/></button>
        )}
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
          <button
            type="button"
            className="excel-statusbar__item excel-statusbar__item--clickable"
            title="긴 설명과 보조 정보를 보이거나 숨깁니다"
            onClick={() => setViewMode(detailed ? 'simple' : 'detailed')}
          >
            {detailed ? '자세히 보기' : '간단히 보기'}
          </button>
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
