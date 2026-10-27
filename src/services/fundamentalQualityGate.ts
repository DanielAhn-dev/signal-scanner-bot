/**
 * 실적 관문 — 신규 매수에서 "최근 4분기 적자" 또는 "최근 분기 영업이익이 1년 전 같은 분기보다 줄어든" 종목을 뺀다.
 *
 * 근거 (2026-09-28, 생존편향 없는 검증): DART 분기 재무 + 상장폐지 종목 포함 네이버 수정주가,
 * 2018-04~2026-06 월별, 거래대금 10억+ 전 종목 동일가중.
 *   - 이 관문을 통과한 종목: 전 종목 평균 대비 월 +0.66% (t=4.7), 8개 장세 구간 모두 평균보다 나음
 *   - 최근 4분기 적자 종목: 월 -0.72% (t=-4.1), 연 -11%
 * 한계: 시가총액 상위 종목 안에서는 효과가 작다(월 +0.26%, t=1.7). 지수를 이긴다는 근거가 아니라
 * "실적이 나쁜 종목을 피한다"는 근거다.
 *
 * 데이터: fundamentals(period_type=quarter, 네이버 분기 실적). 컨센서스(추정치) 행은 쓰지 않는다.
 * 데이터가 모자라면 판정하지 않는다(제외하지 않음).
 */

type SupabaseClientAny = any;

export type QuarterRow = {
  periodEnd: string;
  operatingIncome: number | null;
  eps: number | null;
  isConsensus?: boolean | null;
};

export type FundamentalGateResult =
  | { status: "pass" }
  | { status: "fail"; reason: string }
  | { status: "unknown"; reason: string };

/** 최근 실적 분기가 이보다 오래되면 판정하지 않는다 (분기 마감 뒤 공시까지 최대 ~90일 + 여유) */
export const FUNDAMENTAL_GATE_MAX_STALE_DAYS = 200;

export function evaluateFundamentalGate(rows: QuarterRow[], todayIso: string): FundamentalGateResult {
  const actual = rows
    .filter((r) => !r.isConsensus && r.periodEnd)
    .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  if (actual.length < 4) return { status: "unknown", reason: "분기 실적 4개 미만" };

  const latest = actual[actual.length - 1];
  const ageDays = (Date.parse(todayIso.slice(0, 10)) - Date.parse(latest.periodEnd.slice(0, 10))) / 86_400_000;
  if (!Number.isFinite(ageDays) || ageDays > FUNDAMENTAL_GATE_MAX_STALE_DAYS) {
    return { status: "unknown", reason: "최근 분기 실적이 오래됨" };
  }

  const last4 = actual.slice(-4);
  if (last4.every((r) => r.eps != null && Number.isFinite(r.eps))) {
    const ttmEps = last4.reduce((sum, r) => sum + Number(r.eps), 0);
    if (ttmEps < 0) return { status: "fail", reason: "최근 4분기 적자" };
  }

  // 1년 전 같은 분기 (분기 마감일의 연도만 하나 낮춘 날짜)
  const yearAgoKey = `${Number(latest.periodEnd.slice(0, 4)) - 1}${latest.periodEnd.slice(4, 10)}`;
  const yearAgo = actual.find((r) => r.periodEnd.slice(0, 10) === yearAgoKey);
  if (!yearAgo || latest.operatingIncome == null || yearAgo.operatingIncome == null) {
    return { status: "unknown", reason: "전년 같은 분기 영업이익 없음" };
  }
  if (latest.operatingIncome <= yearAgo.operatingIncome) {
    return { status: "fail", reason: "영업이익 감소(전년 같은 분기 대비)" };
  }
  return { status: "pass" };
}

/** 종목별 분기 실적 행 조회 (최근 800일). 조회 실패 시 throw */
async function fetchQuarterRows(
  supabase: SupabaseClientAny,
  codes: string[],
  todayIso: string
): Promise<{ unique: string[]; byCode: Map<string, QuarterRow[]> }> {
  const unique = [...new Set(codes.map((c) => String(c).trim()).filter(Boolean))];
  const sinceIso = new Date(Date.parse(todayIso) - 800 * 86_400_000).toISOString().slice(0, 10);
  const byCode = new Map<string, QuarterRow[]>();
  // 800일 창이면 종목당 분기 행이 9개 안팎(100종목이면 약 900행)이라 1000행 제한에 바짝 붙는다 — 50종목씩
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const { data, error } = await supabase
      .from("fundamentals")
      .select("code, period_end, operating_income, eps, computed")
      .eq("period_type", "quarter")
      .in("code", chunk)
      .gte("period_end", sinceIso)
      .limit(1000);
    if (error) throw new Error(`실적 관문 조회 실패: ${error.message}`);
    for (const row of (data ?? []) as Array<Record<string, any>>) {
      const list = byCode.get(row.code) ?? [];
      list.push({
        periodEnd: String(row.period_end ?? ""),
        operatingIncome: row.operating_income == null ? null : Number(row.operating_income),
        eps: row.eps == null ? null : Number(row.eps),
        isConsensus: Boolean(row.computed?.is_consensus),
      });
      byCode.set(row.code, list);
    }
  }
  return { unique, byCode };
}

/** 종목별 실적 관문 판정. 조회 실패 시 빈 맵(제외 없음) */
export async function fetchFundamentalGateResults(
  supabase: SupabaseClientAny,
  codes: string[],
  todayIso: string = new Date().toISOString()
): Promise<Map<string, FundamentalGateResult>> {
  const { unique, byCode } = await fetchQuarterRows(supabase, codes, todayIso);
  const out = new Map<string, FundamentalGateResult>();
  for (const code of unique) out.set(code, evaluateFundamentalGate(byCode.get(code) ?? [], todayIso));
  return out;
}

export type OperatingLossStreakResult =
  | { status: "warn"; quarters: 4; latestPeriodEnd: string }
  | { status: "ok" }
  | { status: "unknown"; reason: string };

/**
 * 최근 연속 4개 분기 영업이익이 모두 음수인지 (H74, 2026-10-27).
 * 근거: 거래대금 상위 300, 2017-04~2026-06 월별 111개월, 이후 60거래일 −20% 이하 손실 비율 37.8% vs 20.5%
 * (월별 차이 +17.3%p, 변동성 통제 후 +11.4%p). 한 시장·한 국면 검증이며 매수 금지 근거가 아니라 주의 표시다.
 * 위의 fundamental gate(EPS 합계·영업이익 전년 비교)와 정의가 달라 따로 둔다 — 이 쪽이 H74와 같은 정의.
 * 데이터가 모자라거나 오래되면 판정하지 않는다.
 */
export function evaluateOperatingLossStreak(rows: QuarterRow[], todayIso: string): OperatingLossStreakResult {
  const actual = rows
    .filter((r) => !r.isConsensus && r.periodEnd)
    .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  if (actual.length < 4) return { status: "unknown", reason: "분기 실적 4개 미만" };

  const last4 = actual.slice(-4);
  const latest = last4[3];
  const ageDays = (Date.parse(todayIso.slice(0, 10)) - Date.parse(latest.periodEnd.slice(0, 10))) / 86_400_000;
  if (!Number.isFinite(ageDays) || ageDays > FUNDAMENTAL_GATE_MAX_STALE_DAYS) {
    return { status: "unknown", reason: "최근 분기 실적이 오래됨" };
  }
  // 분기가 건너뛰어졌으면(결측) 연속 4분기라고 말할 수 없다
  for (let i = 1; i < 4; i++) {
    const gap = (Date.parse(last4[i].periodEnd.slice(0, 10)) - Date.parse(last4[i - 1].periodEnd.slice(0, 10))) / 86_400_000;
    if (!(gap >= 80 && gap <= 100)) return { status: "unknown", reason: "분기 실적이 연속이 아님" };
  }
  if (last4.some((r) => r.operatingIncome == null || !Number.isFinite(r.operatingIncome))) {
    return { status: "unknown", reason: "영업이익 값 없음" };
  }
  if (last4.every((r) => (r.operatingIncome as number) < 0)) {
    return { status: "warn", quarters: 4, latestPeriodEnd: latest.periodEnd.slice(0, 10) };
  }
  return { status: "ok" };
}

/** 종목별 연속 영업적자 판정. 조회 실패는 throw — 호출 쪽이 '표시 없음'으로 처리한다 */
export async function fetchOperatingLossStreaks(
  supabase: SupabaseClientAny,
  codes: string[],
  todayIso: string = new Date().toISOString()
): Promise<Map<string, OperatingLossStreakResult>> {
  const { unique, byCode } = await fetchQuarterRows(supabase, codes, todayIso);
  const out = new Map<string, OperatingLossStreakResult>();
  for (const code of unique) out.set(code, evaluateOperatingLossStreak(byCode.get(code) ?? [], todayIso));
  return out;
}
