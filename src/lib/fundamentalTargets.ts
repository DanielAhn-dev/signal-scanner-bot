/**
 * 재무 수집 대상 선정. 예전에는 종목 코드 순서의 앞 120개만 매일 같은 것을 돌았다.
 * 우선순위(시가총액 큰 순) 목록에서, 최근 값이 채워진 종목은 건너뛰고 이어서 limit개를 고른다.
 * 그러면 매일 '아직 안 채워진 종목 중 큰 것'부터 차례로 채워지고, 시간이 지나면 다시 오래된 종목이 돌아온다.
 */
export function pickFundamentalTargets(input: {
  ranked: readonly string[]
  all: readonly string[]
  fresh: ReadonlySet<string>
  limit: number
}): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const limit = Math.max(0, Math.floor(input.limit))
  for (const list of [input.ranked, input.all]) {
    for (const code of list) {
      if (out.length >= limit) return out
      if (!code || seen.has(code)) continue
      seen.add(code)
      if (input.fresh.has(code)) continue
      out.push(code)
    }
  }
  return out
}

/** 이번 수집 결과 중 값이 채워진 비율. 대상이 없으면 1 */
export function fillRatio(filled: number, attempted: number): number {
  return attempted > 0 ? filled / attempted : 1
}
