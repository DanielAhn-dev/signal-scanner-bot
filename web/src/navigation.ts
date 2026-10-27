export type NavItem = {
  key: string
  label: string
  adminOnly?: boolean
  /** 일반 사용자 메뉴에만 보인다 (관리자는 같은 화면을 다른 탭에서 이미 봄) */
  userOnly?: boolean
  /** 메뉴 검색에서 이름 말고도 찾히게 할 낱말 (화면 안에 있는 기능 이름) */
  keywords?: readonly string[]
}

/** 메뉴 검색 일치 — 이름·키·화면 안 기능 낱말 */
export function navMatches(item: { key: string; label: string; keywords?: readonly string[] }, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return item.label.toLowerCase().includes(q) || item.key.includes(q) || (item.keywords ?? []).some((k) => k.toLowerCase().includes(q))
}

export type NavGroup = {
  category: string
  /** 일반 사용자에게 보일 그룹 이름 */
  userCategory?: string
  items: NavItem[]
}

/**
 * 사용 흐름 — 자동매매를 따라가면서 각 화면에서 봇의 판단 근거를 확인하는 순서.
 * 시트 탭 순서·홈 리본·대시보드 '오늘의 플로우'가 모두 여기서 나온다. 순서를 바꾸려면 이 배열만 고친다.
 */
export type FlowStep = {
  key: string
  step: number
  label: string
  /** 이 단계에서 하는 일 (대시보드 플로우 설명) */
  desc: string
}

export const FLOW_STEPS: FlowStep[] = [
  // 포트폴리오는 실제 계좌를 관리하는 홈 화면이라 이 흐름에서 뺐다(2026-10-21) — 흐름은 가상(실험) 계좌의 개별주 판단 근거를 따지는 순서다
  { key: 'market', step: 1, label: '시장', desc: '오늘 봇이 새로 사는 날인지(코스피 50일선) 먼저 확인' },
  { key: 'highlights', step: 2, label: '집행우선', desc: '오늘 후보와 과거 20일 분포 확인' },
  { key: 'analyze', step: 3, label: '분석', desc: '후보 하나씩 차트·재무·규칙 판정 근거 확인' },
  { key: 'simulator', step: 4, label: '종목 금액 나누기(실험)', desc: '실측 승률로 금액 나누기' },
  { key: 'execution-guide', step: 5, label: '실행가이드', desc: '직접 넣을 주문 정리' },
  { key: 'strategy', step: 6, label: '전략', desc: '봇 가상 계좌 성과를 KODEX 200·CD금리와 비교' },
]

const flowLabel = (s: FlowStep) => `${s.step} ${s.label}`

/** 관제 — 검산·운영·데이터·유지보수 통합 페이지 */
export const CONTROL_NAV_ITEM: NavItem = { key: 'control', label: '관제' }

/**
 * 메뉴 구조 — 리본 탭 하나가 섹션 하나, 리본 그룹이 group 하나다. '도구' 서랍(전체 메뉴)·메뉴 검색도 여기서 나온다.
 * 2026-09-29 방향 전환(종목 선별 대신 지수 정기 적립·행동 실수 차단) 기준으로, 매일 쓰는 내 돈 화면을 '홈'에 두고
 * 종목 선별 흐름(1~6)은 관리자가 근거를 따질 때 여는 '종목 연구'로 내렸다.
 * 일반 사용자는 USER_NAV_KEYS로 걸러지고, 이미 앞 탭에 나온 화면은 다시 보이지 않는다(menuSectionsFor).
 */
export type MenuSection = {
  key: string
  label: string
  /** 일반 사용자에게 보일 탭 이름 (걸러진 뒤 남는 화면 성격이 달라질 때) */
  userLabel?: string
  groups: NavGroup[]
}

export const MENU_SECTIONS: MenuSection[] = [
  {
    key: 'home',
    label: '오늘',
    groups: [
      { category: '오늘', items: [{ key: 'dashboard', label: '홈' }, { key: 'briefing', label: '오늘 시장', keywords: ['테마', '브리핑', '뜨는 테마', '보유 테마'] }, { key: 'portfolio', label: '포트폴리오' }, { key: 'market', label: '시장' }, { key: 'news', label: '뉴스', userOnly: true }, { key: 'similar-times', label: '비슷한 때', keywords: ['비슷했던', '과거', '겹쳐', '심리', '공포', '탐욕', '사이클'] }, { key: 'commentary', label: '해설 점검', userOnly: true, keywords: ['유튜브', '전문가', '통념', '달러', '금리', '금값', '유가'] }] },
    ],
  },
  {
    key: 'money',
    label: '적립',
    groups: [
      { category: '적립', items: [{ key: 'accumulate', label: '모아가기' }, { key: 'budget', label: '예산 설정' }, { key: 'money-flow', label: '지출 기록' }, { key: 'seed-builder', label: '이번 달 투자금', keywords: ['시드', '남겨둘 돈', '확보'] }, { key: 'follow', label: '따라 사기' }] },
    ],
  },
  {
    key: 'plan',
    label: '계획',
    groups: [
      { category: '목표·계획', items: [{ key: 'goal-tracker', label: '목표 트래커' }, { key: 'plan', label: '계획 점검' }, { key: 'plan-sim', label: '시뮬레이터', keywords: ['섞어보기', '비중', '백테스트', '과거', '적립', '일시금', '수익률', '하락'] }, { key: 'income-guide', label: '리밸런싱 가이드', keywords: ['분배금', '받은 분배금', '배당', '인컴', '예수금'] }] },
      { category: '계산·주문 정리', items: [{ key: 'execution-guide', label: '실행가이드', userOnly: true }] },
    ],
  },
  {
    key: 'review',
    label: '기록',
    groups: [
      { category: '돌아보기', items: [{ key: 'trades', label: '거래기록' }, { key: 'choices', label: '내 선택 돌아보기' }] },
      { category: '받아보기', items: [{ key: 'alerts', label: '알림' }, { key: 'reports', label: '리포트' }] },
    ],
  },
  {
    key: 'family',
    label: '가족',
    groups: [
      { category: '함께하기', items: [{ key: 'child', label: '자녀 계좌' }, { key: 'family', label: '부부 연결' }] },
    ],
  },
  {
    key: 'research',
    label: '종목 연구',
    groups: [
      { category: '봇 판단 흐름', items: FLOW_STEPS.map((s) => ({ key: s.key, label: flowLabel(s) })) },
      { category: '후보 더 보기', items: [{ key: 'scan', label: '스캔' }, { key: 'discovery', label: '발굴' }, { key: 'backtest', label: '급등 역추적(연구)' }, { key: 'watchlist', label: '감시목록' }] },
    ],
  },
  {
    key: 'learn',
    label: '시장 공부',
    groups: [
      { category: '시장 공부', items: [{ key: 'sectors', label: '섹터' }, { key: 'news', label: '뉴스' }, { key: 'economy', label: '경제지표' }, { key: 'similar-times', label: '비슷한 때', keywords: ['비슷했던', '과거', '겹쳐', '심리', '공포', '탐욕', '사이클'] }, { key: 'commentary', label: '해설 점검', keywords: ['유튜브', '전문가', '통념', '달러', '금리', '금값', '유가'] }, { key: 'feed', label: '피드' }] },
    ],
  },
  {
    key: 'file',
    label: '파일',
    groups: [
      { category: '처음 설정', items: [{ key: 'start', label: '처음 설정 다시 하기' }] },
      { category: '설정', items: [{ key: 'settings', label: '설정' }, { key: 'profile', label: '프로필' }, { key: 'admin-users', label: '사용자 관리', adminOnly: true }, { key: 'distribution-upload', label: '분배금 올리기', adminOnly: true }] },
    ],
  },
]

/**
 * 하단 시트 탭 — 사용자 여정 단계마다 대표 화면 하나(홈 → 모으기 → 계획 → 내 계좌). 나머지는 리본·'전체 메뉴'로 연다.
 * 일반 사용자 리본에는 이 화면들이 다시 나오지 않는다(menuSectionsFor).
 */
export const SHEET_NAV_KEYS: readonly string[] = ['dashboard', 'accumulate', 'goal-tracker', 'portfolio']

/** 권한으로 거르고, 일반 사용자는 앞 탭에 이미 나온 화면을 다시 보여 주지 않는다. 빈 그룹·빈 탭은 뺀다 */
export function menuSectionsFor(isAdmin: boolean): MenuSection[] {
  const seen = new Set<string>(isAdmin ? [] : SHEET_NAV_KEYS)
  return MENU_SECTIONS.map((section) => ({
    ...section,
    label: isAdmin ? section.label : section.userLabel ?? section.label,
    groups: filterNavGroups(section.groups, isAdmin)
      .map((g) => {
        const items = isAdmin ? g.items : plainNavItems(g.items.filter((i) => !seen.has(i.key)))
        items.forEach((i) => seen.add(i.key))
        return { ...g, category: isAdmin ? g.category : g.userCategory ?? g.category, items }
      })
      .filter((g) => g.items.length > 0),
  })).filter((section) => section.groups.length > 0)
}

/** 검색·전체 메뉴 등에 쓰는 평탄화 목록 (중복 없이, 관제 포함) */
export const ALL_NAV_ITEMS: NavItem[] = [
  ...new Map(
    [...MENU_SECTIONS.flatMap((s) => s.groups.flatMap((g) => g.items)), CONTROL_NAV_ITEM]
      .map((item) => [item.key, item] as const),
  ).values(),
]

export type NavKey = NavItem['key']

/**
 * 일반 사용자에게 보이는 화면 — 시드 모으기 가이드, 투자금액 넣고 시뮬레이션·따라 하기, 목표 예측, 내 계좌·기록.
 * 전략 비교·분석·후보 탐색·관제처럼 봇의 판단 근거를 따지는 화면은 관리자에게만 보인다.
 * 사용자 화면을 늘리려면 이 목록만 고친다.
 */
export const USER_NAV_KEYS: readonly string[] = [
  'dashboard',
  'briefing',
  'start',
  'accumulate',
  'plan-sim',
  'plan',
  'child',
  'follow',
  'seed-builder',
  'money-flow',
  'budget',
  'family',
  'execution-guide',
  'goal-tracker',
  'choices',
  'income-guide',
  'portfolio',
  'trades',
  'market',
  'news',
  'commentary',
  'similar-times',
  'settings',
  'profile',
]

/** 다른 화면으로 넘겨주기만 하는 옛 주소 — 화면이 없어 권한 검사 대신 App 라우트가 바로 넘긴다 (섞어보기 → 시뮬레이터, 2026-10-22) */
export const REDIRECTED_ROUTES: readonly string[] = ['mix']

export function canSeeNav(key: string, isAdmin: boolean): boolean {
  return isAdmin || USER_NAV_KEYS.includes(key)
}

/** 관리자는 전체, 일반 사용자는 USER_NAV_KEYS만 */
export function filterNavItems<T extends { key: string }>(items: T[], isAdmin: boolean): T[] {
  return items.filter((item) => canSeeNav(item.key, isAdmin))
}

/** 일반 사용자에게는 봇 흐름 번호("2 포트폴리오")를 빼고 이름만 보인다 */
export function plainNavItems<T extends { label: string }>(items: T[]): T[] {
  return items.map((item) => ({ ...item, label: item.label.replace(/^\d+\s+/, '') }))
}

export function filterNavGroups(groups: NavGroup[], isAdmin: boolean): NavGroup[] {
  return groups
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => (isAdmin ? !i.userOnly : !i.adminOnly) && canSeeNav(i.key, isAdmin)),
    }))
    .filter((g) => g.items.length > 0)
}

/**
 * 화면별 "봇이 이 화면 정보를 매매에 어떻게 쓰는지" — 모든 화면 상단에 한 줄로 나온다(BotUsageBanner).
 * 봇 로직이 바뀌면 여기만 고친다. 근거: 2026-09-28 10년·30년 검증.
 */
export const BOT_USAGE_NOTES: Record<string, string> = {
  briefing:
    '봇은 테마 순위·보유 테마 판정을 매매에 쓰지 않습니다. 시장이 어디를 보는지 알기 위한 화면이며, 급등 테마를 따라 사는 것은 검증에서 불리했습니다.',
  market:
    '봇은 여기 위험지수가 아니라 맨 위 "봇 매수"(코스피 50일선) 기준으로 신규 매수 여부를 정합니다. 위험지수는 참고용입니다.',
  portfolio:
    '내 실제 계좌 보유를 기록·관리하는 곳이고, [가상] 탭은 개별주 규칙을 실험하며 하락 대응을 배우는 가상 계좌입니다(둘은 섞지 않습니다). 가상 계좌의 봇은 보유 종목을 매일 손절·익절·수익잠금 규칙으로 점검합니다. 8년 모의매매에서 이 규칙은 기대수익을 올리지는 않았지만(6개월 평균 +1.9% vs 그냥 보유 +4.5%, 차이는 우연 범위) 최악 5% 손실을 -39%에서 -11%로 줄였습니다. 남는 현금(시드의 10% 초과분)은 KODEX 200에 계속 둡니다 (적립·거치 모두 과거 데이터에서 50일선에 따라 오가는 것보다 나쁜 경우의 결과까지 좋았습니다).',
  highlights:
    '봇 후보와 같은 점수 순서입니다. 봇은 이 중 최근 4분기 적자·영업이익 감소(전년 같은 분기 대비) 종목을 사지 않습니다 — 상장폐지 종목까지 넣은 8년 검증에서 이 조건만 평균보다 확실히 나았습니다. 점수 자체가 수익 차이를 예측한다는 근거는 없습니다.',
  analyze:
    '봇은 이 화면의 규칙 판정·목표가를 쓰지 않습니다. 재무 칸의 "봇 실적 관문"만 봇 매수 제외 기준과 같습니다. 나머지는 점수·차트·재무를 직접 확인하는 공부용입니다.',
  simulator: '관리자용 개별주 실험 도구입니다(가상 계좌 실험·하락 대응 학습용). 봇 매매와 별개이며 승률 기본값은 과거 실측값입니다. 지수 적립 시뮬레이션은 계획 › 시뮬레이터에 있습니다.',
  'execution-guide': '봇 자동주문과 별개로, 직접 증권사 앱에 넣을 주문을 정리합니다.',
  strategy:
    '봇 가상 계좌와 후보 전략을 KODEX 200·CD금리와 비교합니다. 8주 측정 뒤 모두 앞선 후보만 승인 버튼이 생기고, 승인해야 봇이 바뀝니다(자동 전환 없음). 설정 중 "봇 미적용" 항목은 실제 매매에 쓰이지 않습니다.',
  scan:
    '눌림 등급 목록입니다. 봇의 눌림목 프로필이 진입 A/B 등급을 후보로 쓰지만, 10년 검증에서 우위는 확인되지 않았습니다.',
  discovery:
    '재무 기반 중장기 후보입니다(봇 발굴 프로필 가산점). 상장폐지 종목까지 넣은 8년 검증에서 ROE·이익 성장 조건은 평균 종목보다 월 0.6%가량 나았지만, 코스피 지수를 이긴다는 근거는 아닙니다.',
  backtest: '봇은 쓰지 않습니다. 과거 규칙 통계 공부용이며, 척도가 통일된 9/24 이후 점수만 씁니다.',
  sectors:
    '봇은 섹터 강약으로 매수 순서를 정하지 않습니다 — 상장폐지 포함 11년 검증에서 강한 업종 추종도, 덜 오른 업종 순환매(다음섹터)도 평균보다 낫지 않았고 순환매는 오히려 부진했습니다. 보유 종목의 섹터 쏠림 제한과 약세 섹터 정리에만 씁니다.',
  news: '효과가 검증되지 않은 참고 정보입니다. 헤드라인은 검증용으로 매일 보관합니다.',
  economy: '봇에는 중요 경제 이벤트 직전 신규 매수를 쉬는 이벤트 가드가 있습니다(서버 설정으로 켜고 끔). 지표 자체는 참고용입니다.',
  trades: '봇·직접 매매의 체결 기록입니다. 봇의 성과 통계는 현재 규칙이 확정된 2026-09-29 이후 매매만 셉니다(그 전은 데이터 오류·규칙 변경 전).',
  watchlist: '관심 종목 목록입니다. 봇 매수 후보에는 직접 쓰이지 않습니다.',
  reports: '집행우선·시장·보유 리포트를 만듭니다. 수치는 과거 분포이며 예측이 아닙니다.',
  'goal-tracker':
    '가상(실험) 계좌 매매와 별개입니다. 목표 월 인출액에 필요한 시드와, 지금 계좌가 계획선을 따라가는지 보여줍니다. 주문은 내지 않습니다.',
  choices:
    '가상(실험) 계좌 매매와 별개입니다. 자동매매 방식을 바꾼 날부터 "안 바꿨다면"과 실제를 같은 출발점에서 비교합니다. 주문은 내지 않고, 30일이 지나야 숫자를 보여줍니다.',
  accumulate:
    '가상(실험) 계좌 매매와 별개입니다. 증권사 앱의 모아가기로 직접 사는 지수 ETF를 과거 실제 가격으로 시뮬레이션하고, 정한 금액을 꾸준히 이어가도록 돕습니다. 주문은 내지 않습니다.',
  'plan-sim':
    '가상(실험) 계좌 매매와 별개입니다. 고른 기간·구성·넣는 방식으로 과거 실제 가격을 따라간 계산이며, 봇은 이 결과를 쓰지 않습니다. 주문은 내지 않습니다.',
  plan:
    '가상(실험) 계좌 매매와 별개입니다. 버틸 수 있는 하락폭에 맞는 주식 비중, 일시금 대 분할, 목표에 필요한 월 적립액, 은퇴 때 세금·건보료를 뺀 인출 가능액을 과거 자료 범위로 보여줍니다. 주문은 내지 않습니다.',
  child:
    '가상(실험) 계좌 매매와 별개입니다. 자녀에게 준 돈의 증여 한도·신고 마감을 기록으로 정리하고 장기 보유 범위를 보여줍니다. 세무 판단은 하지 않으며 주문도 내지 않습니다.',
  'income-guide':
    '가상(실험) 계좌 매매와 별개입니다. 포트폴리오에서 직접 입력한 실계좌 보유만 보고, 모으기→전환→인컴 단계의 목표 비중과 옮길 금액을 안내합니다. 주문은 내지 않습니다.',
}
