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
  onOpenProfile?: () => void
  contextLabel?: string            // 수식 표시줄에 표시할 텍스트
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

function toExcelColumnLabel(index: number): string {
  let value = index
  let label = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    label = String.fromCharCode(65 + remainder) + label
    value = Math.floor((value - 1) / 26)
  }
  return label
}

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
  onOpenProfile,
  contextLabel,
  contentMode = 'legacy',
  leftPanel,
  rightPanel,
}: Props) {
  const { authName, authEmail, isSignedIn } = useAuthStore()
  const profile = useProfileStore(s => s.profile)
  const [ribbonTab, setRibbonTab] = useState<RibbonTabKey>('home')
  const [zoom, setZoom] = useState(100)
  const [menuQuery, setMenuQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const { leftW, rightW, startDrag } = usePanelResize(containerRef)

  const displayName = profile.nickname || profile.telegramName || authName || authEmail || '사용자'
  const activeSheet = SHEET_TABS.find(t => t.key === activeRoute)
  const activeSheetIndex = Math.max(0, SHEET_TABS.findIndex(t => t.key === activeRoute))
  const pageLabel   = activeSheet?.label ?? activeRoute ?? ''
  const nameBox     = activeRoute ? activeRoute.toUpperCase().slice(0, 6) : 'A1'
  const groups      = getRibbonGroups(ribbonTab)
  const workbookTitle = useMemo(() => {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    return `market_brief_${y}${m}${d}.xlsx`
  }, [])
  const [dummyColumnCount, setDummyColumnCount] = useState(12)
  const [isUltraCompact, setIsUltraCompact] = useState(false)
  const dummyHeaders = useMemo(
    () => Array.from({ length: dummyColumnCount }, (_, index) => toExcelColumnLabel(index + 27)),
    [dummyColumnCount],
  )

  const routeByMenuQuery = useCallback((query: string) => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return ''
    const exact = SHEET_TABS.find(tab => tab.key === normalized || tab.label.toLowerCase() === normalized)
    if (exact) return exact.key
    const partial = SHEET_TABS.find(tab => tab.label.toLowerCase().includes(normalized) || tab.key.includes(normalized))
    return partial?.key ?? ''
  }, [])

  const navigateSheetOffset = useCallback((offset: number) => {
    const nextIndex = (activeSheetIndex + offset + SHEET_TABS.length) % SHEET_TABS.length
    onNavigate(SHEET_TABS[nextIndex].key)
  }, [activeSheetIndex, onNavigate])

  const handleMenuSearch = useCallback((e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const route = routeByMenuQuery(menuQuery)
    if (!route) return
    onNavigate(route)
  }, [menuQuery, onNavigate, routeByMenuQuery])

  // 좌/우 패널 표시 여부 (반응형)
  const [visiblePanels, setVisiblePanels] = useState<'all' | 'no-right' | 'center-only'>('all')
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth
      setIsUltraCompact(w < 640)
      setDummyColumnCount(Math.max(8, Math.min(22, Math.floor(w / 96))))
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
          <button className="excel-titlebar__qs-btn excel-tooltip-target" data-tooltip="보고서 저장" onClick={() => onNavigate('reports')}><Save size={13}/></button>
          <button className="excel-titlebar__qs-btn excel-tooltip-target" data-tooltip="이전 시트" onClick={() => navigateSheetOffset(-1)}><ChevronLeft size={13}/></button>
          <button className="excel-titlebar__qs-btn excel-tooltip-target" data-tooltip="다음 시트" onClick={() => navigateSheetOffset(1)}><ChevronRight size={13}/></button>
          <button className="excel-titlebar__qs-btn excel-tooltip-target" data-tooltip="실행 취소" onClick={() => window.history.back()}><Undo2 size={13}/></button>
          <button className="excel-titlebar__qs-btn excel-tooltip-target" data-tooltip="다시 실행" onClick={() => window.history.forward()}><Redo2 size={13}/></button>
        </div>
        <div className="excel-titlebar__app-name">{workbookTitle} - {pageLabel || '시트1'} - Excel</div>
        <div className="excel-titlebar__window-controls">
          <form className="excel-titlebar__search" onSubmit={handleMenuSearch}>
            <Search size={12} />
            <input
              className="excel-titlebar__search-input"
              list="excel-menu-search-options"
              value={menuQuery}
              onChange={e => setMenuQuery(e.target.value)}
              placeholder="메뉴 이동 (예: 스캔, 포트폴리오)"
            />
            <datalist id="excel-menu-search-options">
              {SHEET_TABS.map(tab => (
                <option key={tab.key} value={tab.label} />
              ))}
            </datalist>
          </form>
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

                {isUltraCompact && g.buttons.length > 3 && (
                  <details className="ribbon-fold">
                    <summary className="ribbon-fold__summary">더보기</summary>
                    <div className="ribbon-fold__menu">
                      {[...g.buttons].sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2)).slice(3).map(btn => (
                        <button
                          key={`fold-${btn.key}`}
                          className="ribbon-fold__item"
                          onClick={() => btn.route && onNavigate(btn.route)}
                        >
                          {btn.label}
                        </button>
                      ))}
                    </div>
                  </details>
                )}
              </div>
              <div className="excel-ribbon-group__label">{g.label}</div>
            </div>
          ))}
        </div>

        <div className="excel-ribbon-body__filler" aria-hidden>
          <div className="excel-ribbon-body__hint excel-tooltip-target" data-tooltip="버튼 균등 배치와 엑셀형 더미 셀 영역으로 넓은 화면 균형을 맞춥니다.">
            넓은 화면 모드: 균등 버튼 배치 + 더미 셀
          </div>
          <div
            className="excel-ribbon-body__dummy-head"
            style={{ gridTemplateColumns: `repeat(${dummyHeaders.length}, minmax(0, 1fr))` }}
          >
            {dummyHeaders.map(head => (
              <span key={head}>{head}</span>
            ))}
          </div>
          <div className="excel-ribbon-body__dummy-grid" />
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
          value={contextLabel ?? pageLabel}
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
