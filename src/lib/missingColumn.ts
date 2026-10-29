/**
 * PostgREST/Postgres의 'column stocks.eps does not exist' 같은 오류 메시지에서 없는 컬럼명을 뽑는다.
 * 스키마가 환경마다 달라도 select에서 그 컬럼만 빼고 다시 조회할 수 있게 한다.
 */
export function parseMissingColumn(message: unknown): string | null {
  const m = /column\s+(?:"?[\w]+"?\.)*"?([\w]+)"?\s+does not exist/i.exec(String(message ?? ''))
  return m ? m[1] : null
}

/** columns에서 missing을 뺀 새 배열. 없는 컬럼이면 null(더 줄일 수 없음) */
export function dropColumn(columns: readonly string[], missing: string): string[] | null {
  if (!columns.includes(missing)) return null
  return columns.filter((c) => c !== missing)
}
