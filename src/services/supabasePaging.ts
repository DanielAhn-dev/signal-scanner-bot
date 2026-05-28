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
  }
): Promise<T[]> {
  const pageSize = Math.max(1, options?.pageSize ?? DEFAULT_PAGE_SIZE);
  const maxRows = Math.max(pageSize, options?.maxRows ?? DEFAULT_MAX_ROWS);
  const debug = options?.debug ?? DEFAULT_PAGING_DEBUG;
  const logLabel = options?.logLabel ?? "paged_select";
  const logger = options?.logger ?? ((msg: string) => console.log(msg));

  const out: T[] = [];
  let pages = 0;
  let stoppedByShortPage = false;

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const { data, error } = await fetchPage(offset, offset + pageSize - 1);
    if (error) {
      throw new Error(error.message || "paged select failed");
    }
    const rows = data ?? [];
    pages += 1;
    out.push(...rows);
    if (rows.length < pageSize) {
      stoppedByShortPage = true;
      break;
    }
  }

  if (debug) {
    const reason = stoppedByShortPage ? "short_page" : "max_rows";
    logger(`[supabasePaging] ${logLabel} rows=${out.length} pages=${pages} page_size=${pageSize} stop=${reason}`);
  }

  return out;
}