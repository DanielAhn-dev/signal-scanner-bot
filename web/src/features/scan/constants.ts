import type { ConditionFilter, SortKey, StrategyGuide, StrategyMetricSummary } from './types'

export const SCAN_SNAPSHOT_KEY = 'scan_snapshot_v1'
export const ANALYZE_PENDING_CODE_KEY = 'analyze_pending_code'
export const EXECUTION_GUIDE_PENDING_KEY = 'execution_guide_pending_v1'
export const SCAN_SIGNAL_HISTORY_KEY = 'scan_signal_history_v1'

export const CONDITION_FILTER_OPTIONS: Array<{ key: ConditionFilter; label: string; advanced?: boolean }> = [
  { key: 'all', label: '전체', advanced: true },
  { key: 'candidate', label: '후보' },
  { key: 'confirm', label: '확인' },
  { key: 'buycheck', label: '매수검토' },
  { key: 'entry', label: '진입(A/B)', advanced: true },
  { key: 'trend', label: '추세(A/B)', advanced: true },
  { key: 'accumulation', label: '매집(A/B)', advanced: true },
  { key: 'lead', label: '매집 선행형', advanced: true },
  { key: 'accumulation_signal', label: '매집형(신호)', advanced: true },
  { key: 'stable', label: '세력선(A/B)', advanced: true },
  { key: 'quick', label: '퀵트레이드(2~5%)', advanced: true },
  { key: 'quick_lite', label: '퀵라이트(완화형)', advanced: true },
  { key: 'signal_d1', label: 'D-1 신호', advanced: true },
  { key: 'signal_d2', label: 'D-2 신호', advanced: true },
  { key: 'strategy_day', label: '데이(당일)', advanced: true },
  { key: 'strategy_overnight', label: '오버나이트', advanced: true },
  { key: 'strategy_weekly', label: '주간(3~5일)', advanced: true },
]

export const PRIMARY_MODE_OPTIONS: Array<{ key: ConditionFilter; label: string }> = [
  { key: 'candidate', label: '후보' },
  { key: 'confirm', label: '확인' },
  { key: 'buycheck', label: '매수검토' },
]

export const BASIC_CONDITION_FILTER_KEYS = new Set<ConditionFilter>(['candidate', 'confirm', 'buycheck'])
export const ALL_CONDITION_FILTER_KEYS = CONDITION_FILTER_OPTIONS.map((option) => option.key)

export const CONDITION_FILTER_LABEL_MAP: Record<ConditionFilter, string> = {
  all: '전체',
  candidate: '후보',
  confirm: '확인',
  buycheck: '매수검토',
  entry: '진입(A/B)',
  trend: '추세(A/B)',
  accumulation: '매집(A/B)',
  lead: '매집 선행형',
  accumulation_signal: '매집형(신호)',
  stable: '세력선(A/B)',
  quick: '퀵트레이드(2~5%)',
  quick_lite: '퀵라이트(완화형)',
  signal_d1: 'D-1 신호(전일)',
  signal_d2: 'D-2 신호(2일전)',
  strategy_day: '데이 전략(당일)',
  strategy_overnight: '오버나이트(D-1/D-2)',
  strategy_weekly: '주간 전략(3~5일)',
}

export const STRATEGY_FILTER_BY_METRIC_KEY: Record<StrategyMetricSummary['key'], ConditionFilter> = {
  day: 'strategy_day',
  overnight: 'strategy_overnight',
  weekly: 'strategy_weekly',
}

export const STRATEGY_METRIC_KEY_BY_FILTER: Partial<Record<ConditionFilter, StrategyMetricSummary['key']>> = {
  strategy_day: 'day',
  strategy_overnight: 'overnight',
  strategy_weekly: 'weekly',
}

export const STRATEGY_BASE_POSITION_R: Record<StrategyMetricSummary['key'], number> = {
  day: 0.5,
  overnight: 0.7,
  weekly: 1.0,
}

export const STRATEGY_GUIDE_BY_FILTER: Partial<Record<ConditionFilter, StrategyGuide>> = {
  strategy_day: {
    title: '데이 전략 실행 가이드',
    entry: '09:10~10:30 분할 진입(추격 금지)',
    positionSize: '권장 0.5R (총자금 8~12% 이내)',
    holding: '당일 청산 원칙(오버나이트 금지)',
    stopLoss: '-1.8% 이탈 시 즉시 축소, -2.5% 전량 정리',
    takeProfit: '+2.2% 1차 분할, +3.5% 이상 잔량 추세 청산',
    forceExit: '14:50 이후 모멘텀 둔화 시 종가 전 정리',
    caution: '거래대금 급감/VI 급증 구간은 진입 보류',
  },
  strategy_overnight: {
    title: '오버나이트 전략 실행 가이드',
    entry: '14:20~15:15 분할 매수(D-1/D-2 신호 우선)',
    positionSize: '권장 0.7R (총자금 12~18% 이내)',
    holding: '1박2일 기준, 익일 시가 중심 청산',
    stopLoss: '익일 시가 -2.0% 이탈 시 즉시 정리',
    takeProfit: '익일 시가 +1.8%~+3.0% 구간 분할 청산',
    forceExit: '익일 장초반 10:00 이전 미청산분 원칙 정리',
    caution: '이벤트/실적 발표일 전일은 비중 절반 이하',
  },
  strategy_weekly: {
    title: '주간 전략 실행 가이드',
    entry: '신호일 포함 2거래일 내 2~3회 분할',
    positionSize: '권장 1.0R (총자금 18~28% 이내)',
    holding: '3~5거래일 보유, 추세 유지 시 연장 검토',
    stopLoss: '-3.5% 하회 또는 기준선 이탈 시 정리',
    takeProfit: '+4.0% 1차, +6.5% 2차, 잔량은 추세 추종',
    forceExit: '5거래일 경과 시 수익/손실 무관 비중 축소',
    caution: '장대음봉+거래량 급증 동반 시 방어 우선',
  },
}

/** 조건 탭별 기본 정렬 기준 */
export const FILTER_DEFAULT_SORT: Record<ConditionFilter, SortKey> = {
  all: 'priority_score',
  candidate: 'lead_accumulation_score',
  confirm: 'priority_score',
  buycheck: 'priority_score',
  entry: 'entry_score',
  trend: 'trend_grade',
  accumulation: 'dist_grade',
  lead: 'lead_accumulation_score',
  accumulation_signal: 'lead_accumulation_score',
  stable: 'pivot_grade',
  quick: 'intraday_change_pct',
  quick_lite: 'intraday_change_pct',
  signal_d1: 'priority_score',
  signal_d2: 'priority_score',
  strategy_day: 'intraday_change_pct',
  strategy_overnight: 'priority_score',
  strategy_weekly: 'lead_accumulation_score',
}
