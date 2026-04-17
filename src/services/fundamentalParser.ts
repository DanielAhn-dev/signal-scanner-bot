export const ANNUAL_COLUMN_COUNT = 4;
export const ACTUAL_ANNUAL_COLUMN_COUNT = 3;

export function parseNum(text: string): number | undefined {
  const t = (text || "").replace(/,/g, "").trim();
  if (!t || t === "-" || t === "N/A") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

export function takeNumbers(row: string[]): number[] {
  return (row || [])
    .map((x) => parseNum(x))
    .filter((x): x is number => x !== undefined);
}

export function takeActualAnnualNumbers(row: string[]): number[] {
  const annualCells = (row || []).slice(0, ANNUAL_COLUMN_COUNT);
  const actualAnnualCells = annualCells.slice(0, ACTUAL_ANNUAL_COLUMN_COUNT);
  const nums = actualAnnualCells
    .map((cell) => parseNum(cell))
    .filter((value): value is number => value !== undefined);

  return nums.length ? nums : takeNumbers(row);
}

export function findLatestActualAnnualValue(row: string[]): number | undefined {
  const nums = takeActualAnnualNumbers(row);
  return nums.length ? nums[nums.length - 1] : undefined;
}

export function growthPctFromRow(row: string[]): number | undefined {
  const nums = takeActualAnnualNumbers(row);
  if (nums.length < 2) return undefined;

  const latest = nums[nums.length - 1];
  const prev = nums[nums.length - 2];
  if (!Number.isFinite(prev) || prev === 0) return undefined;
  return ((latest - prev) / Math.abs(prev)) * 100;
}

export function findFirstNumberInText(text: string): number | undefined {
  const m = (text || "").match(/-?\d+(?:,\d{3})*(?:\.\d+)?/);
  if (!m) return undefined;
  return parseNum(m[0]);
}

export function extractMetricValue(text: string, unit: string): number | undefined {
  const match = (text || "").match(
    new RegExp(`(-?\\d+(?:,\\d{3})*(?:\\.\\d+)?)\\s*${unit}`)
  );
  return match ? parseNum(match[1]) : undefined;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}