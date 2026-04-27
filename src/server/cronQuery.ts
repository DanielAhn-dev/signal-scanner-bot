type QueryValue = string | string[] | undefined;

export function firstQueryValue(raw: QueryValue): string | undefined {
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

export function parsePositiveInt(raw: QueryValue): number | undefined {
  const value = firstQueryValue(raw);
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function parseBoolean(raw: QueryValue): boolean {
  const value = (firstQueryValue(raw) ?? "").toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "y";
}
