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

function main() {
  const fileArg = getArgValue("--file");
  const topArg = Number(getArgValue("--top") ?? 15);
  const top = Number.isFinite(topArg) && topArg > 0 ? Math.floor(topArg) : 15;

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

  const summary = new Map<string, { calls: number; rows: number; pages: number; maxRows: number; maxPages: number }>();
  let totalRows = 0;
  let totalPages = 0;

  for (const row of parsed) {
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
    .sort((a, b) => b.rows - a.rows)
    .slice(0, top);

  console.log(`[paging-report] file=${targetPath}`);
  console.log(`[paging-report] entries=${parsed.length} total_rows=${totalRows} total_pages=${totalPages}`);
  console.log("[paging-report] top labels by rows:");
  for (const row of ranked) {
    console.log(
      `- ${row.label} calls=${row.calls} rows=${row.rows} pages=${row.pages} avg_rows=${row.avgRows} avg_pages=${row.avgPages} max_rows=${row.maxRows} max_pages=${row.maxPages}`
    );
  }
}

main();
