type SupabaseClientAny = any;

export async function fetchLatestPullbackCandidateCodes(input: {
  supabase: SupabaseClientAny;
  limit?: number;
}): Promise<Set<string>> {
  const limit = Math.max(1, Math.floor(input.limit ?? 40));

  const { data: latestRows, error: latestError } = await input.supabase
    .from("pullback_signals")
    .select("trade_date")
    .order("trade_date", { ascending: false })
    .limit(1);

  if (latestError) {
    return new Set<string>();
  }

  const latestDate = String((latestRows?.[0] as Record<string, unknown> | undefined)?.trade_date ?? "");
  if (!latestDate) {
    return new Set<string>();
  }

  const { data, error } = await input.supabase
    .from("pullback_signals")
    .select("code")
    .eq("trade_date", latestDate)
    .in("entry_grade", ["A", "B"])
    .neq("warn_grade", "SELL")
    .order("entry_score", { ascending: false })
    .limit(limit);

  if (error) {
    return new Set<string>();
  }

  const codes = (data ?? [])
    .map((row: Record<string, unknown>) => String(row.code ?? "").trim())
    .filter(Boolean);

  return new Set(codes);
}
