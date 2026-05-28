export const DEFAULT_PAGE_SIZE = 1000;

export function chunkValues<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items.slice()];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export async function selectPaged<T>(
  fetchPage: (from: number, to: number) => Promise<{ data?: T[] | null; error?: { message?: string } | null }>,
  options?: { pageSize?: number; maxRows?: number }
): Promise<T[]> {
  const pageSize = Math.max(1, options?.pageSize ?? DEFAULT_PAGE_SIZE);
  const maxRows = Math.max(pageSize, options?.maxRows ?? 100000);
  const out: T[] = [];

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const { data, error } = await fetchPage(offset, offset + pageSize - 1);
    if (error) {
      throw new Error(error.message || "paged select failed");
    }
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }

  return out;
}