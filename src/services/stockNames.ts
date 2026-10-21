/**
 * 종목 코드 → 이름 조회 (알림 문구용). 조회가 실패해도 알림은 보내야 하므로 빈 맵을 돌려주고,
 * 호출측은 formatStockLabel로 코드만 쓰는 표기로 물러난다.
 */

type SupabaseClientAny = any;

// .in()에 큰 배열을 넘기면 URL이 커져 fetch failed가 난다 — 나눠서 조회
const CHUNK = 200;

export async function fetchStockNameMap(
  supabase: SupabaseClientAny,
  codes: Iterable<string>
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(Array.from(codes, (c) => String(c ?? "").trim()).filter(Boolean)));
  const names = new Map<string, string>();
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    try {
      const { data, error } = await supabase.from("stocks").select("code,name").in("code", chunk);
      if (error || !Array.isArray(data)) continue;
      for (const row of data as Array<{ code?: unknown; name?: unknown }>) {
        const code = String(row.code ?? "").trim();
        const name = String(row.name ?? "").trim();
        if (code && name) names.set(code, name);
      }
    } catch {
      // 이름은 표시용 — 실패해도 코드 표기로 보낸다
    }
  }
  return names;
}
