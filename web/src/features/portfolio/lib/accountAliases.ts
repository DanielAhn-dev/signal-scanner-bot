import { accountLabel } from './accountKey'

/** 화면에 보일 계좌 별칭 — 키는 accountKey(증권사|||계좌명) 또는 위쪽 탭 'real'/'virtual'. 종목 행은 건드리지 않는다 */
export type AccountAliases = Record<string, string>

export const ALIAS_MAX_LENGTH = 20
/** 이 개수 이상이면 가로 탭 대신 선택 시트로 보여 준다 */
export const ACCOUNT_SHEET_THRESHOLD = 4

export const DEFAULT_TOP_LABEL = { real: '내 계좌(실제)', virtual: '실험 계좌' } as const

export function cleanAlias(input: string): string {
  return String(input || '').replace(/\s+/g, ' ').trim().slice(0, ALIAS_MAX_LENGTH)
}

/** 저장값에서 문자열 별칭만 골라낸다 (깨진 값은 버린다) */
export function normalizeAliases(raw: unknown): AccountAliases {
  const out: AccountAliases = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string') continue
    const alias = cleanAlias(value)
    if (alias) out[key] = alias
  }
  return out
}

/** 별칭을 넣거나(빈 문자열이면 지운다) 새 객체를 돌려준다 */
export function setAlias(aliases: AccountAliases, key: string, input: string): AccountAliases {
  const next = { ...aliases }
  const alias = cleanAlias(input)
  if (alias) next[key] = alias
  else delete next[key]
  return next
}

/** 별칭이 있으면 별칭, 없으면 '증권사 / 계좌명' */
export function displayAccountName(aliases: AccountAliases, key: string, brokerName?: string | null, accountName?: string | null): string {
  return aliases[key] || accountLabel(brokerName, accountName)
}

/** 같은 이름이 이미 다른 계좌에 쓰이는가 (비교는 공백·대소문자 무시) */
export function aliasTaken(aliases: AccountAliases, key: string, input: string, labels: Record<string, string>): boolean {
  const norm = (s: string) => cleanAlias(s).toLowerCase()
  const target = norm(input)
  if (!target) return false
  return Object.entries(labels).some(([k, label]) => k !== key && norm(aliases[k] || label) === target)
}

/** 계좌 키로 정한 색 — 이름이 비슷해도 한눈에 구분하는 점 */
export function accountDotColor(key: string): string {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return `hsl(${h % 360} 60% 50%)`
}
