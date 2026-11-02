// 계좌 위험 기여도 재료 — 보유 종목의 최근 일봉을 stock_daily에서 읽어 riskContribution에 넘긴다.
import { RISK_HISTORY_ROWS, buildRiskContribution, type RiskContribution } from "../lib/riskContribution";

type SupabaseClientAny = any;

export async function loadAccountRisk(
  supabase: SupabaseClientAny,
  held: Array<{ code: string; name: string; value: number }>
): Promise<RiskContribution | null> {
  const rows = held.filter((h) => h.value > 0);
  if (!rows.length) return null;
  try {
    // 종목당 최대 1000행(PostgREST 캡과 같은 값, 약 4년)이라 종목별로 따로 읽는다. 변동성은 최근 250일, 최대 낙폭은 읽은 전체 이력에서 잰다. 조회 실패는 "이력 없음"이 아니라 계산 생략으로 둔다.
    const results = await Promise.all(
      rows.map((h) =>
        supabase
          .from("stock_daily")
          .select("date, close")
          .eq("ticker", h.code)
          .order("date", { ascending: false })
          .limit(RISK_HISTORY_ROWS)
      )
    );
    if (results.some((r: any) => r.error)) return null;
    return buildRiskContribution(
      rows.map((h, i) => ({
        code: h.code,
        name: h.name,
        value: h.value,
        closes: ((results[i].data ?? []) as Array<{ date: string; close: number }>)
          .map((d) => ({ date: String(d.date), close: Number(d.close) }))
          .filter((d) => d.close > 0),
      }))
    );
  } catch {
    return null;
  }
}
