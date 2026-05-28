import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

type PagingLogRow = {
  label: string;
  rows: number;
  pages: number;
  pageSize: number;
  stop: string;
};

type PagingSummaryRow = {
  label: string;
  calls: number;
  rows: number;
  pages: number;
  avgRows: number;
  avgPages: number;
  maxRows: number;
  maxPages: number;
};

function getArgValue(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.findIndex((item) => item === flag);
  if (index < 0) return undefined;
  return args[index + 1];
}

function parsePagingLogs(content: string): PagingLogRow[] {
  const rows: PagingLogRow[] = [];
  const regex = /^\[supabasePaging\]\s+(\S+)\s+rows=(\d+)\s+pages=(\d+)\s+page_size=(\d+)\s+stop=(\S+)$/;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(regex);
    if (!m) continue;
    rows.push({
      label: m[1],
      rows: Number(m[2]),
      pages: Number(m[3]),
      pageSize: Number(m[4]),
      stop: m[5],
    });
  }

  return rows;
}

function buildSummary(rows: PagingLogRow[]): {
  totalRows: number;
  totalPages: number;
  entries: number;
  ranked: PagingSummaryRow[];
} {
  const summary = new Map<string, { calls: number; rows: number; pages: number; maxRows: number; maxPages: number }>();
  let totalRows = 0;
  let totalPages = 0;

  for (const row of rows) {
    totalRows += row.rows;
    totalPages += row.pages;
    const item = summary.get(row.label) ?? { calls: 0, rows: 0, pages: 0, maxRows: 0, maxPages: 0 };
    item.calls += 1;
    item.rows += row.rows;
    item.pages += row.pages;
    item.maxRows = Math.max(item.maxRows, row.rows);
    item.maxPages = Math.max(item.maxPages, row.pages);
    summary.set(row.label, item);
  }

  const ranked = Array.from(summary.entries())
    .map(([label, item]) => ({
      label,
      calls: item.calls,
      rows: item.rows,
      pages: item.pages,
      avgRows: Math.round(item.rows / item.calls),
      avgPages: Math.round((item.pages / item.calls) * 10) / 10,
      maxRows: item.maxRows,
      maxPages: item.maxPages,
    }))
    .sort((a, b) => b.rows - a.rows);

  return {
    totalRows,
    totalPages,
    entries: rows.length,
    ranked,
  };
}

function main() {
  const fileArg = getArgValue("--file");
  const beforeArg = getArgValue("--before");
  const afterArg = getArgValue("--after");
  const topArg = Number(getArgValue("--top") ?? 15);
  const top = Number.isFinite(topArg) && topArg > 0 ? Math.floor(topArg) : 15;

  if (!!beforeArg !== !!afterArg) {
    console.error("[paging-report] --before and --after must be used together");
    process.exit(1);
  }

  if (beforeArg && afterArg) {
    const beforePath = path.resolve(process.cwd(), beforeArg);
    const afterPath = path.resolve(process.cwd(), afterArg);

    if (!fs.existsSync(beforePath)) {
      console.error(`[paging-report] before file not found: ${beforePath}`);
      process.exit(1);
    }
    if (!fs.existsSync(afterPath)) {
      console.error(`[paging-report] after file not found: ${afterPath}`);
      process.exit(1);
    }

    const beforeRows = parsePagingLogs(fs.readFileSync(beforePath, "utf8"));
    const afterRows = parsePagingLogs(fs.readFileSync(afterPath, "utf8"));

    const before = buildSummary(beforeRows);
    const after = buildSummary(afterRows);

    console.log(`[paging-report] compare before=${beforePath} after=${afterPath}`);
    console.log(
      `[paging-report] totals rows ${before.totalRows} -> ${after.totalRows} (delta=${after.totalRows - before.totalRows}), pages ${before.totalPages} -> ${after.totalPages} (delta=${after.totalPages - before.totalPages}), entries ${before.entries} -> ${after.entries}`
    );

    const beforeMap = new Map(before.ranked.map((row) => [row.label, row]));
    const afterMap = new Map(after.ranked.map((row) => [row.label, row]));
    const labels = Array.from(new Set([...beforeMap.keys(), ...afterMap.keys()]));
    const deltas = labels
      .map((label) => {
        const b = beforeMap.get(label);
        const a = afterMap.get(label);
        const beforeRowsVal = b?.rows ?? 0;
        const afterRowsVal = a?.rows ?? 0;
        const beforePagesVal = b?.pages ?? 0;
        const afterPagesVal = a?.pages ?? 0;
        return {
          label,
          beforeRows: beforeRowsVal,
          afterRows: afterRowsVal,
          deltaRows: afterRowsVal - beforeRowsVal,
          beforePages: beforePagesVal,
          afterPages: afterPagesVal,
          deltaPages: afterPagesVal - beforePagesVal,
        };
      })
      .sort((x, y) => Math.abs(y.deltaRows) - Math.abs(x.deltaRows))
      .slice(0, top);

    console.log("[paging-report] top label deltas:");
    for (const row of deltas) {
      console.log(
        `- ${row.label} rows ${row.beforeRows} -> ${row.afterRows} (delta=${row.deltaRows}), pages ${row.beforePages} -> ${row.afterPages} (delta=${row.deltaPages})`
      );
    }

    return;
  }

  const defaultPath = path.resolve(process.cwd(), "logs", "paging-debug.log");
  const targetPath = fileArg ? path.resolve(process.cwd(), fileArg) : defaultPath;

  if (!fs.existsSync(targetPath)) {
    console.error(`[paging-report] log file not found: ${targetPath}`);
    console.error("[paging-report] usage: pnpm ops:paging-report -- --file <log-file> [--top <n>]");
    process.exit(1);
  }

  const raw = fs.readFileSync(targetPath, "utf8");
  const parsed = parsePagingLogs(raw);
  if (!parsed.length) {
    console.log(`[paging-report] no paging rows found in ${targetPath}`);
    return;
  }

  const summary = buildSummary(parsed);
  const ranked = summary.ranked.slice(0, top);

  console.log(`[paging-report] file=${targetPath}`);
  console.log(`[paging-report] entries=${summary.entries} total_rows=${summary.totalRows} total_pages=${summary.totalPages}`);
  console.log("[paging-report] top labels by rows:");
  for (const row of ranked) {
    console.log(
      `- ${row.label} calls=${row.calls} rows=${row.rows} pages=${row.pages} avg_rows=${row.avgRows} avg_pages=${row.avgPages} max_rows=${row.maxRows} max_pages=${row.maxPages}`
    );
  }
}

main();
