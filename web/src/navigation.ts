export type NavItem = {
  key: string
  label: string
  adminOnly?: boolean
}

export type NavGroup = {
  category: string
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
  { key: 'market', step: 1, label: '시장', desc: '오늘 봇이 새로 사는 날인지(코스피 50일선) 먼저 확인' },
  { key: 'portfolio', step: 2, label: '포트폴리오', desc: '봇이 무엇을 왜 사고팔았는지, 보유 종목 상태 확인' },
  { key: 'highlights', step: 3, label: '집행우선', desc: '오늘 후보와 과거 20일 분포 확인' },
  { key: 'analyze', step: 4, label: '분석', desc: '후보 하나씩 차트·재무·규칙 판정 근거 확인' },
  { key: 'simulator', step: 5, label: '시뮬레이터', desc: '실측 승률로 금액 나누기' },
  { key: 'execution-guide', step: 6, label: '실행가이드', desc: '직접 넣을 주문 정리' },
  { key: 'strategy', step: 7, label: '전략', desc: '봇 성과를 KODEX 200·CD금리와 비교' },
]

const flowLabel = (s: FlowStep) => `${s.step} ${s.label}`

/** 1차 노출 — 홈 + 흐름 7단계. 시트 탭과 홈 리본에 그대로 노출 */
export const PRIMARY_NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: '홈' },
  ...FLOW_STEPS.map((s) => ({ key: s.key, label: flowLabel(s) })),
]

export const PRIMARY_NAV_KEYS = PRIMARY_NAV_ITEMS.map((item) => item.key)

/** 관제 — 검산·운영·데이터·유지보수 통합 페이지 */
export const CONTROL_NAV_ITEM: NavItem = { key: 'control', label: '관제' }

/** 흐름 밖 화면 — "도구" 서랍 */
export const TOOL_NAV_GROUPS: NavGroup[] = [
  {
    category: '보유 / 기록',
    items: [
      { key: 'trades', label: '거래기록' },
      { key: 'watchlist', label: '감시목록' },
      { key: 'alerts', label: '알림' },
      { key: 'reports', label: '리포트' },
    ],
  },
  {
    category: '후보 더 보기',
    items: [
      { key: 'scan', label: '스캔' },
      { key: 'discovery', label: '발굴' },
      { key: 'backtest', label: '백테스트' },
    ],
  },
  {
    category: '시장 공부',
    items: [
      { key: 'sectors', label: '섹터' },
      { key: 'news', label: '뉴스' },
      { key: 'economy', label: '경제지표' },
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

/**
 * 화면별 "봇이 이 화면 정보를 매매에 어떻게 쓰는지" — 모든 화면 상단에 한 줄로 나온다(BotUsageBanner).
 * 봇 로직이 바뀌면 여기만 고친다. 근거: 2026-09-28 10년·30년 검증.
 */
export const BOT_USAGE_NOTES: Record<string, string> = {
  market:
    '봇은 여기 위험지수가 아니라 맨 위 "봇 매수"(코스피 50일선) 기준으로 신규 매수 여부를 정합니다. 위험지수는 참고용입니다.',
  portfolio:
    '봇이 산·판 종목이 여기 쌓입니다. 봇은 보유 종목을 매일 손절·익절·수익잠금 규칙으로 점검합니다. 8년 모의매매에서 이 규칙은 기대수익을 올리지는 않았지만(6개월 평균 +1.9% vs 그냥 보유 +4.5%, 차이는 우연 범위) 최악 5% 손실을 -39%에서 -11%로 줄였습니다. 남는 현금(시드의 10% 초과분)은 코스피 50일선 위면 KODEX 200, 아래면 CD금리 ETF에 둡니다.',
  highlights:
    '봇 후보와 같은 점수 순서입니다. 봇은 이 중 최근 4분기 적자·영업이익 감소(전년 같은 분기 대비) 종목을 사지 않습니다 — 상장폐지 종목까지 넣은 8년 검증에서 이 조건만 평균보다 확실히 나았습니다. 점수 자체가 수익 차이를 예측한다는 근거는 없습니다.',
  analyze:
    '봇은 이 화면의 규칙 판정·목표가를 쓰지 않습니다. 재무 칸의 "봇 실적 관문"만 봇 매수 제외 기준과 같습니다. 나머지는 점수·차트·재무를 직접 확인하는 공부용입니다.',
  simulator: '봇 매매와 별개인 계획 도구입니다. 승률 기본값은 과거 실측값입니다.',
  'execution-guide': '봇 자동주문과 별개로, 직접 증권사 앱에 넣을 주문을 정리합니다.',
  strategy:
    '봇 실제 계좌와 후보 전략을 KODEX 200·CD금리와 비교합니다. 8주 측정 뒤 모두 앞선 후보만 승인 버튼이 생기고, 승인해야 봇이 바뀝니다(자동 전환 없음). 설정 중 "봇 미적용" 항목은 실제 매매에 쓰이지 않습니다.',
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
}
