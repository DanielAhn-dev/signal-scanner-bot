/**
 * 공시 이름 → 위험 범주. scripts/research/validate_disclosure_events.py의 CATS·EXCLUDE와 같아야 한다
 * (화면 수치가 그 검증에서 나오므로 분류가 다르면 숫자가 맞지 않는다).
 */
export type DisclosureRiskCategory =
  | 'dilution'
  | 'buyback'
  | 'admin'
  | 'admin_warn'
  | 'review'
  | 'unfaithful'
  | 'capital_cut'
  | 'audit'

export const DISCLOSURE_RISK_LABEL: Record<DisclosureRiskCategory, string> = {
  dilution: '유상증자·전환사채 등 주식 수가 늘어나는 공시',
  buyback: '자사주 직접 취득 결정',
  admin: '관리종목 지정·상장폐지 사유 발생',
  admin_warn: '관리종목 지정 우려',
  review: '상장적격성 실질심사',
  unfaithful: '불성실공시법인 지정·예고',
  capital_cut: '감자 결정',
  audit: '감사의견 비적정(설)',
}

const PATTERNS: Array<[DisclosureRiskCategory, RegExp]> = [
  ['dilution', /유상증자결정|전환사채권발행결정|신주인수권부사채권발행결정/],
  ['buyback', /자기주식취득결정\)$/],
  ['admin', /관리종목지정(?!우려)|형식적상장폐지|상장폐지사유발생/],
  ['admin_warn', /관리종목지정우려/],
  ['review', /상장적격성\s*실질심사\s*(대상\s*\(?\s*사유발생|대상\s*결정|대상결정|사유발생|사유추가)/],
  ['unfaithful', /불성실공시법인\s*지정/],
  ['capital_cut', /^주요사항보고서\(감자결정\)$/],
  ['audit', /감사의견.*(비적정|거절|한정|부적정)/],
]
const EXCLUDE = /철회|취소|자회사|종속회사|미지정|해제|제외|해당되지|해당없음|미해당|신탁/

export function classifyDisclosure(reportName: string): DisclosureRiskCategory | null {
  const name = String(reportName ?? '')
    .replace(/^\[[^\]]+\]/, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (EXCLUDE.test(name)) return null
  const n = name.replace(/ \(/g, '(')
  return PATTERNS.find(([, re]) => re.test(n))?.[0] ?? null
}
