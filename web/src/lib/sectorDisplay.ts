/**
 * 대시보드 '점수 상위 섹터' 표시 규칙.
 * sectors 테이블에는 업종 말고도 KRX 지수 묶음(코스피 200 TOP 10, 코스피 200 비중상한 20% 등)이 함께 있다.
 * 점수·수급 계산에는 쓰이지만 '섹터 순위'로 보이면 업종과 섞여 어색하므로 화면 목록에서만 뺀다.
 */
export type SectorLike = {
  name?: string
  change?: number | null
  changeRate?: number | null
  change_rate?: number | null
  metrics?: { change_sample?: number } | null
}

const INDEX_GROUP_PATTERN = /코스피\s*200|코스닥\s*150|KRX\s*300|TOP\s*\d+|비중상한|대형주|중형주|소형주/i

export function isIndexGroupSector(name: string | undefined): boolean {
  return !!name && INDEX_GROUP_PATTERN.test(name)
}

/** 업종만 남겨 앞에서 n개 */
export function pickIndustrySectors<T extends SectorLike>(list: T[], n: number): T[] {
  return list.filter((s) => !isIndexGroupSector(s.name)).slice(0, n)
}

/**
 * 등락률. 배치가 구성 종목 표본 0개일 때도 0.0을 저장하므로(metrics.change_sample === 0)
 * 그때는 '보합'이 아니라 자료 없음(null)으로 돌려준다. 표본 수가 없는 예전 행은 값을 그대로 쓴다.
 */
export function sectorChange(s: SectorLike | undefined): number | null {
  if (!s) return null
  if (s.metrics?.change_sample === 0) return null
  const v = s.change_rate ?? s.changeRate ?? s.change
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
