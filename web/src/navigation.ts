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
    category: '주요',
    items: [
      { key: 'dashboard', label: '대시보드' },
      { key: 'sectors', label: '섹터' },
      { key: 'portfolio', label: '포트폴리오' },
      { key: 'trades', label: '거래기록' },
      { key: 'settings', label: '설정' }
    ]
  },
  {
    category: '기능',
    items: [
      { key: 'scan', label: '스캔' },
      { key: 'analyze', label: '분석' },
      { key: 'watchlist', label: '감시목록' },
      { key: 'alerts', label: '알림' },
      { key: 'reports', label: '리포트' }
    ]
  },
  {
    category: '마켓/콘텐츠',
    items: [
      { key: 'market', label: '마켓' },
      { key: 'economy', label: '이코노미' },
      { key: 'strategy', label: '전략' },
      { key: 'news', label: '뉴스' },
      { key: 'feed', label: '피드' },
      { key: 'profile', label: '프로필' }
    ]
  },
  {
    category: '운영',
    items: [
      { key: 'operations', label: '운영 패널' },
    ]
  },
  {
    category: '유틸',
    items: [
      { key: 'commands', label: '명령 목록', type: 'commands' },
      { key: 'dbview', label: '데이터 뷰' },
      { key: 'admin-users', label: '사용자 관리', adminOnly: true }
    ]
  }
]

export const PRIMARY_NAV_KEYS = ['dashboard', 'sectors', 'scan', 'portfolio', 'reports'] as const

export type NavKey = NavItem['key'] | 'commands'
