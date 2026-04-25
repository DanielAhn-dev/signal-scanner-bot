type SupabaseClientAny = any;

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeTurn(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

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

  if (!codes.length) {
    return new Set<string>();
  }

  const { data: scoreRows } = await input.supabase
    .from("scores")
    .select("code, factors")
    .in("code", codes)
    .order("asof", { ascending: false })
    .limit(Math.max(codes.length * 2, 120));

  const factorsByCode = new Map<string, Record<string, unknown>>();
  for (const row of (scoreRows ?? []) as Array<Record<string, unknown>>) {
    const code = String(row.code ?? "").trim();
    if (!code || factorsByCode.has(code)) continue;
    factorsByCode.set(code, (row.factors ?? {}) as Record<string, unknown>);
  }

  const refined = codes.filter((code: string) => {
    const factors = factorsByCode.get(code) ?? {};
    const turn = normalizeTurn(factors.stable_turn);
    const trust = toNumber(factors.stable_turn_trust, 50);
    const aboveAvg = Boolean(factors.stable_above_avg ?? true);

    if (turn === "bear-strong") return false;
    if (trust < 52) return false;
    if (!aboveAvg && turn !== "bull-strong") return false;
    return true;
  });

  return new Set(refined);
}
