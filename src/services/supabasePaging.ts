function getEnvNumber(name: string, fallback: number): number {
  try {
    const env = (globalThis as any)?.process?.env;
    const raw = env?.[name];
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  } catch {
    // ignore
  }
  return fallback;
}

function getEnvBool(name: string, fallback = false): boolean {
  try {
    const env = (globalThis as any)?.process?.env;
    const raw = String(env?.[name] ?? "").trim().toLowerCase();
    if (!raw) return fallback;
    return ["1", "true", "yes", "y", "on"].includes(raw);
  } catch {
    return fallback;
  }
}

export const DEFAULT_PAGE_SIZE = getEnvNumber("SUPABASE_PAGING_PAGE_SIZE", 1000);
export const DEFAULT_MAX_ROWS = getEnvNumber("SUPABASE_PAGING_MAX_ROWS", 100000);
export const DEFAULT_IN_CHUNK_SIZE = getEnvNumber("SUPABASE_IN_CHUNK_SIZE", 200);
export const DEFAULT_PAGING_DEBUG = getEnvBool("SUPABASE_PAGING_DEBUG", false);

type PagingStopReason = "short_page" | "max_rows" | "custom_stop";

export type PagingRunStat = {
  label: string;
  rows: number;
  pages: number;
  pageSize: number;
  stop: PagingStopReason;
};

const MAX_PAGING_STATS = 300;
const pagingRunStats: PagingRunStat[] = [];

export function resetPagingRunStats(): void {
  pagingRunStats.length = 0;
}

export function getPagingRunStats(): PagingRunStat[] {
  return pagingRunStats.slice();
}

export function getPagingRunStatsSummary(): {
  runs: number;
  rows: number;
  pages: number;
  byLabel: Array<{ label: string; runs: number; rows: number; pages: number }>;
} {
  const byLabel = new Map<string, { runs: number; rows: number; pages: number }>();
  let rows = 0;
  let pages = 0;

  for (const stat of pagingRunStats) {
    rows += stat.rows;
    pages += stat.pages;
    const current = byLabel.get(stat.label) ?? { runs: 0, rows: 0, pages: 0 };
    current.runs += 1;
    current.rows += stat.rows;
    current.pages += stat.pages;
    byLabel.set(stat.label, current);
  }

  return {
    runs: pagingRunStats.length,
    rows,
    pages,
    byLabel: Array.from(byLabel.entries())
      .map(([label, v]) => ({ label, runs: v.runs, rows: v.rows, pages: v.pages }))
      .sort((a, b) => b.rows - a.rows),
  };
}

export function chunkValues<T>(items: T[], size = DEFAULT_IN_CHUNK_SIZE): T[][] {
  if (size <= 0) return [items.slice()];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export async function selectPaged<T>(
  fetchPage: (from: number, to: number) => Promise<{ data?: T[] | null; error?: { message?: string } | null }>,
  options?: {
    pageSize?: number;
    maxRows?: number;
    logLabel?: string;
    debug?: boolean;
    logger?: (message: string) => void;
    collectRows?: boolean;
    onPage?: (rows: T[], context: { offset: number; page: number; pageSize: number }) => void;
    shouldStop?: () => boolean;
  }
): Promise<T[]> {
  const pageSize = Math.max(1, options?.pageSize ?? DEFAULT_PAGE_SIZE);
  const maxRows = Math.max(pageSize, options?.maxRows ?? DEFAULT_MAX_ROWS);
  const debug = options?.debug ?? DEFAULT_PAGING_DEBUG;
  const logLabel = options?.logLabel ?? "paged_select";
  const logger = options?.logger ?? ((msg: string) => console.log(msg));
  const collectRows = options?.collectRows ?? true;

  const out: T[] = [];
  let pages = 0;
  let totalRows = 0;
  let reason: PagingStopReason = "max_rows";

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const { data, error } = await fetchPage(offset, offset + pageSize - 1);
    if (error) {
      throw new Error(error.message || "paged select failed");
    }
    const rows = data ?? [];
    pages += 1;
    totalRows += rows.length;
    if (collectRows) {
      out.push(...rows);
    }

    options?.onPage?.(rows, { offset, page: pages, pageSize });
    if (options?.shouldStop?.()) {
      reason = "custom_stop";
      break;
    }

    if (rows.length < pageSize) {
      reason = "short_page";
      break;
    }
  }

  pagingRunStats.push({
    label: logLabel,
    rows: totalRows,
    pages,
    pageSize,
    stop: reason,
  });
  if (pagingRunStats.length > MAX_PAGING_STATS) {
    pagingRunStats.splice(0, pagingRunStats.length - MAX_PAGING_STATS);
  }

  if (debug) {
    // collectRows=false 시 out.length는 항상 0이므로 실제 스캔 행 수(totalRows)를 사용
    logger(`[supabasePaging] ${logLabel} rows=${totalRows} pages=${pages} page_size=${pageSize} stop=${reason}`);
  }

  return out;
}