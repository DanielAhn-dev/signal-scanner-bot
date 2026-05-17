export type NavItem = {
  key: string
  label: string
  type?: 'commands'
  adminOnly?: boolean
}

export type NavGroup = {
  category: string
  items: NavItem[]
}

export const NAV_ITEMS: NavGroup[] = [
  {
    category: '핵심 플로우',
    items: [
      { key: 'dashboard', label: '대시보드' },
      { key: 'scan', label: '스캔' },
      { key: 'analyze', label: '분석' },
      { key: 'simulator', label: '시뮬레이터' },
      { key: 'portfolio', label: '포트폴리오' },
      { key: 'reports', label: '리포트' }
    ]
  },
  {
    category: '시장 / 상태',
    items: [
      { key: 'sectors', label: '섹터' },
      { key: 'market', label: '시장' },
      { key: 'economy', label: '경제' },
      { key: 'news', label: '뉴스' },
    ]
  },
  {
    category: '실행',
    items: [
      { key: 'trades', label: '거래기록' },
      { key: 'watchlist', label: '감시목록' },
      { key: 'alerts', label: '알림' },
      { key: 'profile', label: '프로필' },
    ]
  },
  {
    category: '실험실',
    items: [
      { key: 'highlights', label: '하이라이트' },
      { key: 'strategy', label: '전략' },
      { key: 'backtest', label: '백테스트' },
      { key: 'discovery', label: '발굴' },
      { key: 'feed', label: '피드' },
    ]
  },
  {
    category: '운영 / 설정',
    items: [
      { key: 'settings', label: '설정' },
      { key: 'position-maintenance', label: '포지션 유지보수' },
      { key: 'operations', label: '운영 패널' },
    ]
  },
  {
    category: '시스템',
    items: [
      { key: 'commands', label: '명령 목록', type: 'commands' },
      { key: 'dbview', label: '데이터 뷰' },
      { key: 'admin-users', label: '사용자 관리', adminOnly: true }
    ]
  }
]

export const PRIMARY_NAV_KEYS = ['dashboard', 'scan', 'analyze', 'simulator', 'portfolio', 'reports'] as const

export type NavKey = NavItem['key'] | 'commands'
