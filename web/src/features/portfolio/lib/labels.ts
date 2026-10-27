export function toSignalLabel(value?: string | null): string {
  const v = String(value || '').trim().toUpperCase()
  if (!v) return '-'
  if (v === 'BUY') return '매수'
  if (v === 'HOLD') return '보유'
  if (v === 'SELL') return '매도'
  return v
}

export function toWarnLabel(value?: string | null): string {
  const v = String(value || '').trim().toUpperCase()
  if (!v) return '-'
  if (v === 'SAFE') return '안전'
  if (v === 'WATCH') return '관찰'
  if (v === 'WARN') return '경고'
  if (v === 'SELL') return '강한경고'
  return v
}

export const WARN_REASON_LABELS: Array<{ key: 'warn_overheat' | 'warn_vol_spike' | 'warn_atr_spike' | 'warn_rsi_ob' | 'warn_ma_break' | 'warn_dead_cross'; label: string }> = [
  { key: 'warn_overheat', label: '이격 과열(21일선 대비 +7% 초과)' },
  { key: 'warn_vol_spike', label: '거래량 급증(20일 평균 대비 2배 초과)' },
  { key: 'warn_atr_spike', label: '변동성 급증(ATR14 > ATR20 평균 x 1.5)' },
  { key: 'warn_rsi_ob', label: 'RSI 극단(70 초과 또는 30 미만)' },
  { key: 'warn_ma_break', label: '21일선 이탈(종가 < MA21)' },
  { key: 'warn_dead_cross', label: '데드크로스(MA21 < MA50)' },
]

// 숫자는 scripts/research/validate_weight_caution.py 출력(src/services/weightCautionSignal.ts와 같은 값)
export const WEIGHT_CAUTION_SOURCE_NOTE =
  '근거: 2015~2025 하루 거래대금 30억원 이상 종목(상장폐지 포함), 월 1회 표본. 고점 시점은 맞히지 못하며 신호 뒤에도 상위 10%는 3개월에 +40% 넘게 더 올랐다. 전부 매도가 아니라 추가매수 중단·비중 축소 검토용. 검증 2026-10-05.'

// 숫자는 scripts/research/validate_operating_loss_avoid.py 출력 (H74, 2026-10-27)
export const OPERATING_LOSS_SOURCE_NOTE =
  '근거: 거래대금 상위 300 종목, 2017~2026 월별 108개월 비교. 최근 4분기 연속 영업적자 종목은 이후 60거래일 안에 −20% 이하로 빠진 비율이 그렇지 않은 종목보다 평균 약 14%p 높았다(가격 이상치 의심 구간을 뺀 값, 변동성을 맞춰도 약 +8%p). 중형·소형(1000위까지)과 미국 종목(거래대금 상위 500)에서도 같은 크기로 나타났다. 2017~2026 한 국면 검증이며 매도 신호가 아니라 비중·추가매수 점검용 주의 표시. 검증 2026-10-27, 가격 정화 보정 포함.'

export const BADGE_TOOLTIPS: Record<string, string> = {
  '점수부족': '추가매수 기준 점수 미달. 점수가 오르거나 기준 완화 시 추가진입 신호가 생성됩니다.',
  '경고있음': '기술적 경고 지표 발생 (이격과열·거래량급증·RSI 극단 등). 판정근거 보기에서 상세 확인.',
  '매도신호': '종합 점수 기반 매도 신호 발생. 현재 보통 보유 상태이나 주의 관찰 필요.',
  '관망': '추가매수·부분청산 조건 모두 미충족. 현재 포지션 유지 권장.',
  '익절구간': '수익률이 부분청산 기준에 도달. 일부 매도를 검토하세요.',
  '경고강함': '경고 등급 WARN/SELL 수준. 손실 위험 신호 — 청산 조건 재검토 권장.',
  '추가진입': '추가매수 조건 충족. 점수·진입·추세 등급이 기준 이상입니다.',
  '보유신호': '추세 유지 신호. 현재 포지션 보유 권장.',
}
