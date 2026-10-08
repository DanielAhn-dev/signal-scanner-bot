/**
 * 당일 추격 매수 경고 — 직접 사기 전에 보는 화면(종목 분석·시세 창)용.
 *
 * 근거: 가설 장부 C34(validate_intraday_chase.py, 2015~2026 거래대금 상위 300, 사건 75,021건).
 * 장중 전일 종가 +8% 이상에서 산 경우 20거래일 뒤 코스피 대비 평균 −4.39%(중앙 −5.08%), 앞뒤 구간 모두 음수.
 * +5%는 −3.26%, +15%는 −6.21%로 많이 오른 날 살수록 나빴다.
 *
 * 봇 매수 회피 규칙 반영은 11/23 관문을 따른다. 이건 사람에게 보여 주는 경고일 뿐 매매를 막지 않는다.
 * 숫자를 바꾸려면 스크립트를 다시 돌려 장부부터 갱신한다.
 */
export const CHASE_WARN_PCT = 8

export type ChaseWarning = {
  level: 'strong' | 'mild'
  title: string
  detail: string
  source: string
}

const SOURCE = '과거 검증 C34 · 2015~2026 거래대금 상위 300 · 일봉 근사 · 비용 미반영 · 2026-10-07 생성'

export function chaseWarning(changePct: number | null | undefined): ChaseWarning | null {
  const pct = Number(changePct)
  if (changePct == null || !Number.isFinite(pct)) return null
  if (pct >= 15) {
    return {
      level: 'strong',
      title: `오늘 이미 +${pct.toFixed(1)}% 올랐어요 — 지금 사면 '당일 추격'이에요`,
      detail: '과거에 전일보다 15% 넘게 오른 날 산 경우 20거래일 뒤 코스피보다 평균 6.2% 뒤처졌어요. 사려면 내일 이후로 미루는 쪽이 대체로 나았어요.',
      source: SOURCE,
    }
  }
  if (pct >= CHASE_WARN_PCT) {
    return {
      level: 'strong',
      title: `오늘 이미 +${pct.toFixed(1)}% 올랐어요 — 지금 사면 '당일 추격'이에요`,
      detail: '과거에 전일보다 8% 넘게 오른 가격에 산 경우 20거래일 뒤 코스피보다 평균 4.4% 뒤처졌고, 10번 중 6번은 그날 종가부터 산 값 아래였어요.',
      source: SOURCE,
    }
  }
  if (pct >= 5) {
    return {
      level: 'mild',
      title: `오늘 +${pct.toFixed(1)}% 오른 상태예요`,
      detail: '과거에 전일보다 5% 넘게 오른 가격에 산 경우 20거래일 뒤 코스피보다 평균 3.3% 뒤처졌어요. 급하게 살 이유가 없다면 하루 기다려 보세요.',
      source: SOURCE,
    }
  }
  return null
}
