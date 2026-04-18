export interface StrategyMemoInput {
  strategyId: string;
  event: string;
  note?: string;
}

export interface ParsedStrategyMemo {
  strategyId: string;
  event: string;
  note?: string;
  raw: string;
}

export const DEFAULT_STRATEGY_ID = "legacy.unknown";

function sanitizeValue(value: string): string {
  return String(value).replace(/[;\n\r]/g, " ").trim();
}

export function buildStrategyMemo(input: StrategyMemoInput): string {
  const strategyId = sanitizeValue(input.strategyId);
  const event = sanitizeValue(input.event);
  const parts = [`strategy=${strategyId}`, `event=${event}`];
  if (input.note && input.note.trim()) {
    parts.push(`note=${sanitizeValue(input.note)}`);
  }
  return parts.join(";");
}

function tryParseKeyValueMemo(raw?: string | null): ParsedStrategyMemo | null {
  const memo = String(raw ?? "").trim();
  if (!memo || (!memo.includes("strategy=") && !memo.includes("event="))) {
    return null;
  }

  const map = new Map<string, string>();
  for (const token of memo.split(";")) {
    const [key, ...rest] = token.split("=");
    const normalizedKey = String(key ?? "").trim().toLowerCase();
    if (!normalizedKey) continue;
    const value = rest.join("=").trim();
    if (!value) continue;
    map.set(normalizedKey, value);
  }

  const strategyId = map.get("strategy") ?? map.get("strategy_id") ?? "";
  const event = map.get("event") ?? "legacy";
  if (!strategyId) return null;

  const note = map.get("note") ?? undefined;
  return {
    strategyId,
    event,
    note,
    raw: memo,
  };
}

function inferLegacyStrategyId(memo: string): string {
  if (memo.startsWith("autotrade-")) return "core.autotrade.v1";
  if (memo.startsWith("watchlist-")) return "core.plan.v1";
  if (memo.startsWith("watchlist-adjust:")) return "ops.adjustment.v1";
  return DEFAULT_STRATEGY_ID;
}

export function parseStrategyMemo(raw?: string | null): ParsedStrategyMemo {
  const memo = String(raw ?? "").trim();
  const parsed = tryParseKeyValueMemo(memo);
  if (parsed) return parsed;

  return {
    strategyId: inferLegacyStrategyId(memo),
    event: memo || "legacy",
    note: memo || undefined,
    raw: memo,
  };
}
