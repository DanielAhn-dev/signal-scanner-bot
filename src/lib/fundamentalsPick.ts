/**
 * fundamentals 행 중 화면에 쓸 수 있는 값이 하나라도 있는 행을 고른다.
 * 실시간 스크랩이 값 없이 저장한 최신 행이 예전의 정상 행을 가리지 않게 한다.
 */
const CORE_KEYS = ['per', 'pbr', 'eps', 'bps', 'roe', 'debt_ratio'] as const

type FundRow = Partial<Record<(typeof CORE_KEYS)[number], unknown>> | null | undefined

function finite(v: unknown): boolean {
  if (v == null || v === '') return false
  return Number.isFinite(Number(v))
}

/** PER·PBR·EPS·BPS·ROE·부채비율 중 하나라도 숫자가 있으면 true */
export function hasFundamentalValues(row: FundRow): boolean {
  if (!row) return false
  return CORE_KEYS.some((k) => finite(row[k]))
}

/** 최신순으로 정렬된 행에서 값이 있는 첫 행. 없으면 null */
export function pickUsableFundamentals<T extends FundRow>(rows: readonly T[] | null | undefined): T | null {
  if (!rows?.length) return null
  return rows.find((r) => hasFundamentalValues(r)) ?? null
}
