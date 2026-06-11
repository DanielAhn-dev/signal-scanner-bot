export type NavItem = {
  key: string
  label: string
  adminOnly?: boolean
}

export type NavGroup = {
  category: string
  items: NavItem[]
}

/** 1차 노출 핵심 플로우 — 시트 탭과 홈 리본에 그대로 노출 */
export const PRIMARY_NAV_KEYS = ['dashboard', 'scan', 'analyze', 'simulator', 'portfolio', 'reports'] as const

export const PRIMARY_NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: '대시보드' },
  { key: 'scan', label: '스캔' },
  { key: 'analyze', label: '분석' },
  { key: 'simulator', label: '시뮬레이터' },
  { key: 'portfolio', label: '포트폴리오' },
  { key: 'reports', label: '리포트' },
]

/** 관제 — 검산·운영·데이터·유지보수 통합 페이지 */
export const CONTROL_NAV_ITEM: NavItem = { key: 'control', label: '관제' }

/** 나머지 페이지는 "도구" 서랍으로 강등 */
export const TOOL_NAV_GROUPS: NavGroup[] = [
  {
    category: '시장 / 상태',
    items: [
      { key: 'sectors', label: '섹터' },
      { key: 'market', label: '시장' },
      { key: 'news', label: '뉴스' },
      { key: 'economy', label: '경제지표' },
    ],
  },
  {
    category: '실행',
    items: [
      { key: 'trades', label: '거래기록' },
      { key: 'watchlist', label: '감시목록' },
      { key: 'alerts', label: '알림' },
      { key: 'execution-guide', label: '실행가이드' },
    ],
  },
  {
    category: '실험실',
    items: [
      { key: 'highlights', label: '집행우선' },
      { key: 'strategy', label: '전략' },
      { key: 'backtest', label: '백테스트' },
      { key: 'discovery', label: '발굴' },
      { key: 'feed', label: '피드' },
    ],
  },
  {
    category: '설정',
    items: [
      { key: 'settings', label: '설정' },
      { key: 'profile', label: '프로필' },
      { key: 'admin-users', label: '사용자 관리', adminOnly: true },
    ],
  },
]

export const TOOL_NAV_ITEMS: NavItem[] = TOOL_NAV_GROUPS.flatMap((group) => group.items)

/** 검색·전체 메뉴 등에 쓰는 평탄화 목록 (핵심 → 관제 → 도구 순) */
export const ALL_NAV_ITEMS: NavItem[] = [
  ...PRIMARY_NAV_ITEMS,
  CONTROL_NAV_ITEM,
  ...TOOL_NAV_ITEMS,
]

export type NavKey = NavItem['key']
