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
  ChevronLeft, ChevronRight, ChevronDown, Minus,
  LayoutDashboard, ScanSearch, BarChart2, FlaskConical,
  BriefcaseBusiness, FileText, Globe2, Newspaper,
  Bell, User, Settings, Database, Shield,
  Zap, BookMarked, History,
  Search, RefreshCw, Download, Upload, Filter, SortAsc,
  PieChart, Activity, Target, Eye, List, BookOpen
} from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { useProfileStore } from '../stores/profileStore'
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

// ── 리본 정의 ────────────────────────────────────────────────────

const RIBBON_TABS = [
  { key: 'home',   label: '홈' },
  { key: 'insert', label: '삽입' },
  { key: 'data',   label: '데이터' },
  { key: 'view',   label: '보기' },
  { key: 'tools',  label: '도구' },
] as const
type RibbonTabKey = typeof RIBBON_TABS[number]['key']

type RibbonBtn = { key: string; label: string; icon: React.ReactNode; route?: string; priority?: 1 | 2 | 3 }
type RibbonGroup = { label: string; buttons: RibbonBtn[] }
type RibbonScaffoldBtn = { key: string; label: string; icon: React.ReactNode }
type RibbonScaffoldGroup = { label: string; buttons: RibbonScaffoldBtn[] }

function getRibbonGroups(tab: RibbonTabKey): RibbonGroup[] {
  switch (tab) {
    case 'home': return [
      { label: '이동', buttons: [
        { key: 'dashboard', label: '대시보드', icon: <LayoutDashboard size={20}/>, route: 'dashboard', priority: 1 },
        { key: 'scan',      label: '스캔',     icon: <ScanSearch size={20}/>,     route: 'scan', priority: 1 },
        { key: 'analyze',   label: '분석',     icon: <BarChart2 size={20}/>,      route: 'analyze', priority: 1 },
        { key: 'portfolio', label: '포트폴리오',icon: <BriefcaseBusiness size={20}/>, route: 'portfolio', priority: 2 },
      ]},
      { label: '시장', buttons: [
        { key: 'sectors', label: '섹터', icon: <PieChart size={20}/>,  route: 'sectors', priority: 2 },
        { key: 'market',  label: '시장', icon: <Globe2 size={20}/>,    route: 'market', priority: 2 },
        { key: 'news',    label: '뉴스', icon: <Newspaper size={20}/>, route: 'news', priority: 3 },
      ]},
      { label: '관리', buttons: [
        { key: 'watchlist', label: '감시목록', icon: <Eye size={20}/>,     route: 'watchlist', priority: 2 },
        { key: 'alerts',    label: '알림',     icon: <Bell size={20}/>,    route: 'alerts', priority: 2 },
        { key: 'reports',   label: '리포트',   icon: <FileText size={20}/>, route: 'reports', priority: 3 },
      ]},
    ]
    case 'insert': return [
      { label: '분석', buttons: [
        { key: 'simulator',  label: '시뮬레이터', icon: <FlaskConical size={20}/>, route: 'simulator', priority: 1 },
        { key: 'backtest',   label: '백테스트',   icon: <Activity size={20}/>,    route: 'backtest', priority: 2 },
        { key: 'strategy',   label: '전략',       icon: <Target size={20}/>,      route: 'strategy', priority: 2 },
        { key: 'discovery',  label: '발굴',       icon: <Search size={20}/>,      route: 'discovery', priority: 3 },
        { key: 'highlights', label: '하이라이트', icon: <Zap size={20}/>,         route: 'highlights', priority: 3 },
      ]},
    ]
    case 'data': return [
      { label: '데이터', buttons: [
        { key: 'trades', label: '거래기록', icon: <History size={20}/>,  route: 'trades', priority: 1 },
        { key: 'dbview', label: 'DB 뷰',   icon: <Database size={20}/>, route: 'dbview', priority: 1 },
      ]},
      { label: '조작', buttons: [
        { key: 'sort',    label: '정렬',     icon: <SortAsc size={20}/>, priority: 1 },
        { key: 'filter',  label: '필터',     icon: <Filter size={20}/>, priority: 1 },
        { key: 'refresh', label: '새로고침', icon: <RefreshCw size={20}/>, priority: 2 },
        { key: 'import',  label: '가져오기', icon: <Upload size={20}/>, priority: 3 },
        { key: 'export',  label: '내보내기', icon: <Download size={20}/>, priority: 3 },
      ]},
    ]
    case 'view': return [
      { label: '화면', buttons: [
        { key: 'portfolio', label: '포트폴리오', icon: <BriefcaseBusiness size={20}/>, route: 'portfolio', priority: 1 },
        { key: 'watchlist', label: '감시목록',   icon: <BookMarked size={20}/>,        route: 'watchlist', priority: 1 },
        { key: 'market',    label: '시장 현황',  icon: <Globe2 size={20}/>,            route: 'market', priority: 2 },
        { key: 'sectors',   label: '섹터 현황',  icon: <PieChart size={20}/>,          route: 'sectors', priority: 2 },
        { key: 'reports',   label: '리포트',     icon: <FileText size={20}/>,          route: 'reports', priority: 3 },
      ]},
    ]
    case 'tools': return [
      { label: '운영', buttons: [
        { key: 'settings',   label: '설정',   icon: <Settings size={20}/>, route: 'settings', priority: 1 },
        { key: 'profile',    label: '프로필', icon: <User size={20}/>,     route: 'profile', priority: 2 },
        { key: 'operations', label: '운영',   icon: <Shield size={20}/>,   route: 'operations', priority: 2 },
        { key: 'commands',   label: '명령',   icon: <BookOpen size={20}/>, route: 'commands', priority: 3 },
      ]},
    ]
    default: return []
  }
}

function getRibbonScaffoldGroups(tab: RibbonTabKey): RibbonScaffoldGroup[] {
  switch (tab) {
    case 'home':
      return [
        {
          label: '클립보드',
          buttons: [
            { key: 'paste', label: '붙여넣기', icon: <Upload size={20} /> },
            { key: 'copy', label: '복사', icon: <BookMarked size={20} /> },
            { key: 'quick-save', label: '저장', icon: <Save size={20} /> },
          ],
        },
        {
          label: '정렬/필터',
          buttons: [
            { key: 'sort', label: '정렬', icon: <SortAsc size={20} /> },
            { key: 'filter', label: '필터', icon: <Filter size={20} /> },
            { key: 'redo', label: '다시 실행', icon: <Redo2 size={20} /> },
          ],
        },
        {
          label: '스타일',
          buttons: [
            { key: 'style-theme', label: '스타일', icon: <PieChart size={20} /> },
            { key: 'cell-format', label: '셀 서식', icon: <Settings size={20} /> },
          ],
        },
      ]
    case 'insert':
      return [
        {
          label: '삽입 요소',
          buttons: [
            { key: 'chart', label: '차트', icon: <PieChart size={20} /> },
            { key: 'table', label: '테이블', icon: <List size={20} /> },
            { key: 'ins-link', label: '연결', icon: <Globe2 size={20} /> },
          ],
        },
        {
          label: '개체',
          buttons: [
            { key: 'ins-shape', label: '도형', icon: <LayoutDashboard size={20} /> },
            { key: 'ins-note', label: '메모', icon: <FileText size={20} /> },
          ],
        },
      ]
    case 'data':
      return [
        {
          label: '새로고침',
          buttons: [
            { key: 'all-refresh', label: '전체 새로고침', icon: <RefreshCw size={20} /> },
            { key: 'sync-cache', label: '캐시 동기화', icon: <Download size={20} /> },
            { key: 'data-query', label: '쿼리', icon: <Search size={20} /> },
          ],
        },
        {
          label: '정리',
          buttons: [
            { key: 'dedupe', label: '중복 제거', icon: <Minus size={20} /> },
            { key: 'inspect', label: '검사', icon: <Eye size={20} /> },
          ],
        },
      ]
    case 'view':
      return [
        {
          label: '창',
          buttons: [
            { key: 'window-list', label: '창 목록', icon: <LayoutDashboard size={20} /> },
            { key: 'focus', label: '포커스', icon: <Eye size={20} /> },
            { key: 'zoom-in', label: '확대', icon: <Plus size={20} /> },
            { key: 'zoom-out', label: '축소', icon: <Minus size={20} /> },
          ],
        },
      ]
    case 'tools':
      return [
        {
          label: '보안',
          buttons: [
            { key: 'audit', label: '감사', icon: <Shield size={20} /> },
            { key: 'policy', label: '정책', icon: <Settings size={20} /> },
            { key: 'history', label: '기록', icon: <History size={20} /> },
          ],
        },
        {
          label: '자동화',
          buttons: [
            { key: 'auto-plan', label: '자동 실행', icon: <Zap size={20} /> },
            { key: 'ops-watch', label: '운영 보기', icon: <Activity size={20} /> },
          ],
        },
      ]
    default:
      return []
  }
}

// ── 시트 탭 정의 ──────────────────────────────────────────────────

const SHEET_TABS = [
  { key: 'dashboard',  label: '대시보드',   icon: <LayoutDashboard size={10}/> },
  { key: 'scan',       label: '스캔',       icon: <ScanSearch size={10}/> },
  { key: 'analyze',    label: '분석',       icon: <BarChart2 size={10}/> },
  { key: 'portfolio',  label: '포트폴리오', icon: <BriefcaseBusiness size={10}/> },
  { key: 'sectors',    label: '섹터',       icon: <PieChart size={10}/> },
  { key: 'market',     label: '시장',       icon: <Globe2 size={10}/> },
  { key: 'trades',     label: '거래기록',   icon: <History size={10}/> },
  { key: 'watchlist',  label: '감시목록',   icon: <Eye size={10}/> },
  { key: 'reports',    label: '리포트',     icon: <FileText size={10}/> },
  { key: 'news',       label: '뉴스',       icon: <Newspaper size={10}/> },
  { key: 'alerts',     label: '알림',       icon: <Bell size={10}/> },
  { key: 'simulator',  label: '시뮬레이터', icon: <FlaskConical size={10}/> },
  { key: 'settings',   label: '설정',       icon: <Settings size={10}/> },
]

// ── 3패널 리사이즈 ────────────────────────────────────────────────

const MIN_LEFT  = 200  // px
const MIN_MID   = 300  // px
const MIN_RIGHT = 220  // px
const RECENT_MENU_STORAGE_KEY = 'excel-shell:recent-menu-routes:v1'
const RIBBON_FOLD_STORAGE_KEY = 'excel-shell:ribbon-fold-state:v1'
const MAX_RECENT_MENU_ITEMS = 6

function usePanelResize(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [leftW, setLeftW]   = useState(270)
  const [rightW, setRightW] = useState(300)
  const drag = useRef<{ side: 'left' | 'right'; startX: number; startW: number } | null>(null)

  const startDrag = useCallback((side: 'left' | 'right', e: React.MouseEvent) => {
    e.preventDefault()
    drag.current = { side, startX: e.clientX, startW: side === 'left' ? leftW : rightW }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [leftW, rightW])

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
  const [zoom, setZoom] = useState(100)
  const [menuQuery, setMenuQuery] = useState('')
  const [searchPanelOpen, setSearchPanelOpen] = useState(false)
  const [recentMenuRoutes, setRecentMenuRoutes] = useState<string[]>([])
  const [ribbonFoldState, setRibbonFoldState] = useState<Record<string, boolean>>({})
  const containerRef = useRef<HTMLDivElement>(null)
  const searchContainerRef = useRef<HTMLDivElement>(null)
  const { leftW, rightW, startDrag } = usePanelResize(containerRef)

  const displayName = profile.nickname || profile.telegramName || authName || authEmail || '사용자'
  const activeSheet = SHEET_TABS.find(t => t.key === activeRoute)
  const activeSheetIndex = Math.max(0, SHEET_TABS.findIndex(t => t.key === activeRoute))
  const pageLabel   = activeSheet?.label ?? activeRoute ?? ''
  const nameBox     = activeRoute ? activeRoute.toUpperCase().slice(0, 6) : 'A1'
  const groups      = getRibbonGroups(ribbonTab)
  const scaffoldGroups = getRibbonScaffoldGroups(ribbonTab)
  const workbookTitle = useMemo(() => {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    return `market_brief_${y}${m}${d}.xlsx`
  }, [])
  const [isUltraCompact, setIsUltraCompact] = useState(false)

  const routeByMenuQuery = useCallback((query: string) => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return ''
    const exact = SHEET_TABS.find(tab => tab.key === normalized || tab.label.toLowerCase() === normalized)
    if (exact) return exact.key
    const partial = SHEET_TABS.find(tab => tab.label.toLowerCase().includes(normalized) || tab.key.includes(normalized))
    return partial?.key ?? ''
  }, [])

  const recommendedRoutes = useMemo(() => {
    const routes = groups
      .flatMap(group => group.buttons)
      .map(button => button.route)
      .filter((route): route is string => !!route)
    return Array.from(new Set(routes)).slice(0, 5)
  }, [groups])

  const filteredMenuTabs = useMemo(() => {
    const normalized = menuQuery.trim().toLowerCase()
    const list = normalized
      ? SHEET_TABS.filter(tab => tab.label.toLowerCase().includes(normalized) || tab.key.includes(normalized))
      : SHEET_TABS
    return list.slice(0, 12)
  }, [menuQuery])

  const recentMenuTabs = useMemo(() => {
    return recentMenuRoutes
      .map(route => SHEET_TABS.find(tab => tab.key === route))
      .filter((tab): tab is typeof SHEET_TABS[number] => !!tab)
  }, [recentMenuRoutes])

  const recommendedMenuTabs = useMemo(() => {
    return recommendedRoutes
      .map(route => SHEET_TABS.find(tab => tab.key === route))
      .filter((tab): tab is typeof SHEET_TABS[number] => !!tab)
  }, [recommendedRoutes])

  const navigateSheetOffset = useCallback((offset: number) => {
    const nextIndex = (activeSheetIndex + offset + SHEET_TABS.length) % SHEET_TABS.length
    onNavigate(SHEET_TABS[nextIndex].key)
  }, [activeSheetIndex, onNavigate])

  const commitMenuNavigation = useCallback((route: string) => {
    const tab = SHEET_TABS.find(item => item.key === route)
    if (!tab) return
    onNavigate(route)
    setMenuQuery(tab.label)
    setRecentMenuRoutes(prev => {
      const next = [route, ...prev.filter(item => item !== route)].slice(0, MAX_RECENT_MENU_ITEMS)
      return next
    })
    setSearchPanelOpen(false)
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
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    try {
      const rawRecent = window.localStorage.getItem(RECENT_MENU_STORAGE_KEY)
      if (rawRecent) {
        const parsed = JSON.parse(rawRecent)
        if (Array.isArray(parsed)) {
          setRecentMenuRoutes(parsed.filter((item): item is string => typeof item === 'string').slice(0, MAX_RECENT_MENU_ITEMS))
        }
      }
      const rawFold = window.localStorage.getItem(RIBBON_FOLD_STORAGE_KEY)
      if (rawFold) {
        const parsed = JSON.parse(rawFold)
        if (parsed && typeof parsed === 'object') {
          setRibbonFoldState(parsed as Record<string, boolean>)
        }
      }
    } catch {
      setRecentMenuRoutes([])
      setRibbonFoldState({})
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem(RECENT_MENU_STORAGE_KEY, JSON.stringify(recentMenuRoutes))
  }, [recentMenuRoutes])

  useEffect(() => {
    window.localStorage.setItem(RIBBON_FOLD_STORAGE_KEY, JSON.stringify(ribbonFoldState))
  }, [ribbonFoldState])

  // 좌/우 패널 표시 여부 (반응형)
  const [visiblePanels, setVisiblePanels] = useState<'all' | 'no-right' | 'center-only'>('all')
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth
      setIsUltraCompact(w < 640)
      if (w < 640)       setVisiblePanels('center-only')
      else if (w < 1024) setVisiblePanels('no-right')
      else               setVisiblePanels('all')
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return (
    <div className="excel-app">

      {/* ── 1. 타이틀 바 ── */}
      <div className="excel-titlebar">
        <div className="excel-titlebar__qs">
          <button className="excel-titlebar__qs-btn excel-tooltip-target" data-tooltip="즐겨찾기 목록" onClick={() => onNavigate('watchlist')}><Star size={13}/></button>
          <button className="excel-titlebar__qs-btn excel-tooltip-target" data-tooltip={quickSaveTooltip || '현재 화면 저장'} onClick={() => void handleQuickSave()}><Save size={13}/></button>
          <button className="excel-titlebar__qs-btn excel-tooltip-target" data-tooltip="이전 시트" onClick={() => navigateSheetOffset(-1)}><ChevronLeft size={13}/></button>
          <button className="excel-titlebar__qs-btn excel-tooltip-target" data-tooltip="다음 시트" onClick={() => navigateSheetOffset(1)}><ChevronRight size={13}/></button>
          <button className="excel-titlebar__qs-btn excel-tooltip-target" data-tooltip="실행 취소" onClick={() => window.history.back()}><Undo2 size={13}/></button>
          <button className="excel-titlebar__qs-btn excel-tooltip-target" data-tooltip="다시 실행" onClick={() => window.history.forward()}><Redo2 size={13}/></button>
        </div>
        <div className="excel-titlebar__app-name">{workbookTitle} - {pageLabel || '시트1'} - Excel</div>
        <div className="excel-titlebar__window-controls">
          <div className="excel-titlebar__search-wrap" ref={searchContainerRef}>
            <form className="excel-titlebar__search" onSubmit={handleMenuSearch}>
              <Search size={12} />
              <input
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
            {searchPanelOpen && (
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
            <button className="excel-titlebar__user-btn" onClick={onOpenProfile}>
              <User size={13}/>{displayName}<ChevronDown size={10}/>
            </button>
          )}
        </div>
      </div>

      {/* ── 2. 리본 탭 ── */}
      <div className="excel-ribbon-tabs" role="tablist">
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
      <div className="excel-ribbon-body" role="toolbar">
        <div className="excel-ribbon-body__content">
          {groups.map((g, gi) => (
            <div key={gi} className="excel-ribbon-group">
              <div className="excel-ribbon-group__buttons">
                {(isUltraCompact
                  ? [...g.buttons].sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2)).slice(0, 3)
                  : g.buttons
                ).map(btn => (
                  <button
                    key={btn.key}
                    className={`ribbon-btn excel-tooltip-target${btn.route === activeRoute ? ' ribbon-btn--active' : ''}`}
                    onClick={() => btn.route && onNavigate(btn.route)}
                    data-tooltip={btn.label}
                  >
                    <span className="ribbon-btn__icon">{btn.icon}</span>
                    <span className="ribbon-btn__label">{btn.label}</span>
                  </button>
                ))}

                {isUltraCompact && g.buttons.length > 3 && (() => {
                  const foldStateKey = `${ribbonTab}:${g.label}`
                  const isOpen = !!ribbonFoldState[foldStateKey]
                  return (
                    <div className="ribbon-fold">
                      <button
                        type="button"
                        className="ribbon-fold__summary"
                        aria-expanded={isOpen}
                        onClick={() => setRibbonFoldState(prev => ({ ...prev, [foldStateKey]: !isOpen }))}
                      >
                        더보기
                      </button>
                      {isOpen && (
                        <div className="ribbon-fold__menu">
                          {[...g.buttons].sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2)).slice(3).map(btn => (
                            <button
                              key={`fold-${btn.key}`}
                              className="ribbon-fold__item"
                              onClick={() => {
                                if (btn.route) onNavigate(btn.route)
                              }}
                            >
                              {btn.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>
              <div className="excel-ribbon-group__label">{g.label}</div>
            </div>
          ))}

          {!isUltraCompact && scaffoldGroups.map((g, gi) => (
            <div key={`scaffold-${gi}`} className="excel-ribbon-group excel-ribbon-group--scaffold" aria-hidden>
              <div className="excel-ribbon-group__buttons">
                {g.buttons.map(btn => (
                  <button
                    key={btn.key}
                    type="button"
                    className="ribbon-btn ribbon-btn--dummy excel-tooltip-target"
                    onClick={() => {}}
                    data-tooltip={`${btn.label} (준비 중)`}
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
      <div className="excel-sheet-tabs">
        <div className="excel-sheet-tabs__nav-arrows">
          <button className="excel-sheet-tabs__nav-btn"><ChevronLeft size={10}/></button>
          <button className="excel-sheet-tabs__nav-btn"><ChevronLeft size={10}/></button>
          <button className="excel-sheet-tabs__nav-btn"><ChevronRight size={10}/></button>
          <button className="excel-sheet-tabs__nav-btn"><ChevronRight size={10}/></button>
        </div>
        {SHEET_TABS.map(tab => (
          <button
            key={tab.key}
            className={`excel-sheet-tab${activeRoute === tab.key ? ' excel-sheet-tab--active' : ''}`}
            onClick={() => onNavigate(tab.key)}
          >
            {tab.icon}{tab.label}
          </button>
        ))}
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
          <span className="excel-statusbar__item">시트: {pageLabel}</span>
          <div className="excel-statusbar__zoom">
            <Minus size={9} style={{ cursor: 'pointer' }} onClick={() => setZoom(z => Math.max(50, z - 10))}/>
            <input type="range" className="excel-statusbar__zoom-slider" min={50} max={200} step={10}
              value={zoom} onChange={e => setZoom(Number(e.target.value))}/>
            <ChevronRight size={9} style={{ cursor: 'pointer' }} onClick={() => setZoom(z => Math.min(200, z + 10))}/>
            <span className="excel-statusbar__zoom-pct">{zoom}%</span>
          </div>
        </div>
      </div>
    </div>
  )
}
