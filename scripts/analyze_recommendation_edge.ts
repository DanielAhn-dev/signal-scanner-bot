import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

type Json = Record<string, unknown>;

type ScoreRow = {
  code: string;
  asof: string;
  total_score: number | null;
  momentum_score: number | null;
  value_score: number | null;
  liquidity_score: number | null;
  signal: string | null;
  factors: Json | null;
};

type PriceRow = {
  ticker: string;
  date: string;
  close: number | null;
};

type EvalRow = {
  code: string;
  asof: string;
  score: number;
  signal: string;
  r5: number | null;
  r20: number | null;
  max5: number | null;
  max20: number | null;
  f: Json;
};

type Rule = {
  name: string;
  test: (row: EvalRow) => boolean;
};

function parseArg(name: string, fallback: string): string {
  const hit = process.argv.find((x) => x.startsWith(`--${name}=`));
  return hit ? String(hit.split("=")[1] ?? fallback) : fallback;
}

function parseNumArg(name: string, fallback: number): number {
  const value = Number(parseArg(name, String(fallback)));
  return Number.isFinite(value) ? value : fallback;
}

function pct(entry: number, close: number): number {
  return ((close - entry) / entry) * 100;
}

function avg(values: Array<number | null>): number {
  const arr = values.filter((v): v is number => Number.isFinite(v));
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function fmtPct(n: number): string {
  return `${n.toFixed(2)}%`;
}

function asNum(obj: Json, key: string, fallback = 0): number {
  const n = Number(obj[key]);
  return Number.isFinite(n) ? n : fallback;
}

function asBool(obj: Json, key: string): boolean {
  return obj[key] === true;
}

function asStr(obj: Json, key: string): string {
  return String(obj[key] ?? "").trim().toLowerCase();
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchScores(input: {
  from: string;
  to: string;
  minScore: number;
}): Promise<ScoreRow[]> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.");
  const supabase = createClient(url, key);

  const pageSize = 1000;
  let fromIdx = 0;
  const rows: ScoreRow[] = [];

  while (true) {
    const { data, error } = await supabase
      .from("scores")
      .select("code, asof, total_score, momentum_score, value_score, liquidity_score, signal, factors")
      .gte("asof", input.from)
      .lte("asof", input.to)
      .gte("total_score", input.minScore)
      .order("asof", { ascending: true })
      .range(fromIdx, fromIdx + pageSize - 1)
      .returns<ScoreRow[]>();

    if (error) throw new Error(`scores 조회 실패: ${error.message}`);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    fromIdx += pageSize;
  }

  return rows;
}

async function fetchPriceMap(input: {
  codes: string[];
  from: string;
  to: string;
}): Promise<Map<string, Array<{ date: string; close: number }>>> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.");
  const supabase = createClient(url, key);

  const out = new Map<string, Array<{ date: string; close: number }>>();
  const uniqueCodes = [...new Set(input.codes.map((c) => c.trim()).filter(Boolean))];
  const codeChunks = chunk(uniqueCodes, 200);

  for (const codes of codeChunks) {
    const { data, error } = await supabase
      .from("stock_daily")
      .select("ticker, date, close")
      .in("ticker", codes)
      .gte("date", input.from)
      .lte("date", input.to)
      .order("date", { ascending: true })
      .returns<PriceRow[]>();

    if (error) throw new Error(`stock_daily 조회 실패: ${error.message}`);

    for (const row of data ?? []) {
      const code = String(row.ticker ?? "").trim();
      const close = Number(row.close ?? 0);
      if (!code || close <= 0 || !row.date) continue;
      const list = out.get(code) ?? [];
      list.push({ date: row.date, close });
      out.set(code, list);
    }
  }

  return out;
}

function evalForward(series: Array<{ date: string; close: number }>, asof: string, holdDays: number) {
  const idx = series.findIndex((x) => x.date === asof);
  if (idx < 0) return null;
  const entry = series[idx]?.close ?? 0;
  if (entry <= 0) return null;
  const future = series.slice(idx + 1, idx + 1 + holdDays);
  if (!future.length) return null;

  const ret = pct(entry, future[future.length - 1].close);
  let maxRet = -999;
  for (const p of future) {
    const r = pct(entry, p.close);
    if (r > maxRet) maxRet = r;
  }
  return { ret, maxRet };
}

function summarize(name: string, rows: EvalRow[]) {
  const n = rows.length;
  const hit10w = rows.filter((r) => (r.max5 ?? -999) >= 10).length;
  const hit20w = rows.filter((r) => (r.max5 ?? -999) >= 20).length;
  const hit10m = rows.filter((r) => (r.max20 ?? -999) >= 10).length;
  const hit20m = rows.filter((r) => (r.max20 ?? -999) >= 20).length;

  console.log(`\n[${name}] n=${n}`);
  if (!n) return;
  console.log(`  5일 max +10% 도달률: ${fmtPct((hit10w / n) * 100)}`);
  console.log(`  5일 max +20% 도달률: ${fmtPct((hit20w / n) * 100)}`);
  console.log(`  20일 max +10% 도달률: ${fmtPct((hit10m / n) * 100)}`);
  console.log(`  20일 max +20% 도달률: ${fmtPct((hit20m / n) * 100)}`);
  console.log(`  5일 종가 평균수익률: ${fmtPct(avg(rows.map((r) => r.r5)))}`);
  console.log(`  20일 종가 평균수익률: ${fmtPct(avg(rows.map((r) => r.r20)))}`);
}

async function main() {
  const from = parseArg("from", "2026-04-01");
  const to = parseArg("to", "2026-04-30");
  const minScore = parseNumArg("minScore", 55);
  const topWinners = parseNumArg("topWinners", 20);

  const toPlus = new Date(`${to}T00:00:00.000Z`);
  toPlus.setDate(toPlus.getDate() + 35);
  const toWithForward = toPlus.toISOString().slice(0, 10);

  console.log(`[edge] window=${from}~${to} minScore=${minScore}`);

  const scoreRows = await fetchScores({ from, to, minScore });
  if (!scoreRows.length) {
    console.log("분석 대상 점수 데이터가 없습니다.");
    return;
  }

  const codes = [...new Set(scoreRows.map((r) => r.code))];
  const priceMap = await fetchPriceMap({ codes, from, to: toWithForward });

  const evalRows: EvalRow[] = [];
  for (const row of scoreRows) {
    const code = String(row.code ?? "").trim();
    const asof = String(row.asof ?? "").slice(0, 10);
    if (!code || !asof) continue;
    const series = priceMap.get(code);
    if (!series?.length) continue;

    const w = evalForward(series, asof, 5);
    const m = evalForward(series, asof, 20);
    const f = (row.factors ?? {}) as Json;
    evalRows.push({
      code,
      asof,
      score: Number(row.total_score ?? 0),
      signal: String(row.signal ?? "").trim().toLowerCase(),
      r5: w?.ret ?? null,
      r20: m?.ret ?? null,
      max5: w?.maxRet ?? null,
      max20: m?.maxRet ?? null,
      f,
    });
  }

  const rules: Rule[] = [
    { name: "전체", test: () => true },
    { name: "score>=70", test: (r) => r.score >= 70 },
    { name: "score>=75", test: (r) => r.score >= 75 },
    { name: "buy/sbuy", test: (r) => r.signal === "buy" || r.signal === "strong_buy" },
    {
      name: "accumulation-entry",
      test: (r) => {
        const turn = asStr(r.f, "stable_turn");
        const bullTurn = turn === "bull-weak" || turn === "bull-strong";
        const stable = asBool(r.f, "stable_accumulation") || Number(r.f["stable_accumulation_days"] ?? 0) >= 2;
        return r.score >= 70 && stable && bullTurn;
      },
    },
    {
      name: "scan-evolved-core",
      test: (r) => {
        const rsi14 = asNum(r.f, "rsi14", 50);
        const avwap = asNum(r.f, "avwap_support", 0);
        const vol = asNum(r.f, "vol_ratio", 0);
        const stableAbove = asBool(r.f, "stable_above_avg");
        const stableAcc = asBool(r.f, "stable_accumulation") || Number(r.f["stable_accumulation_days"] ?? 0) >= 2;
        const turn = asStr(r.f, "stable_turn");
        const bullTurn = turn === "bull-weak" || turn === "bull-strong";
        return (
          r.score >= 72 &&
          (r.signal === "buy" || r.signal === "strong_buy") &&
          rsi14 >= 45 && rsi14 <= 64 &&
          avwap >= 60 &&
          vol >= 1.05 &&
          stableAbove &&
          stableAcc &&
          bullTurn
        );
      },
    },
  ];

  console.log(`scores rows=${scoreRows.length}, eval rows=${evalRows.length}, codes=${codes.length}`);

  for (const rule of rules) {
    const matched = evalRows.filter(rule.test);
    summarize(rule.name, matched);
  }

  const winners = evalRows
    .filter((r) => (r.max5 ?? -999) >= 10 || (r.max20 ?? -999) >= 20)
    .sort((a, b) => (b.max20 ?? b.max5 ?? -999) - (a.max20 ?? a.max5 ?? -999))
    .slice(0, topWinners)
    .map((r) => {
      const turn = asStr(r.f, "stable_turn");
      const acc = asBool(r.f, "stable_accumulation") || Number(r.f["stable_accumulation_days"] ?? 0) >= 2;
      const avwap = asNum(r.f, "avwap_support", 0);
      const rsi = asNum(r.f, "rsi14", 0);
      return {
        asof: r.asof,
        code: r.code,
        score: Number(r.score.toFixed(1)),
        signal: r.signal,
        max5: r.max5 != null ? Number(r.max5.toFixed(2)) : null,
        max20: r.max20 != null ? Number(r.max20.toFixed(2)) : null,
        r5: r.r5 != null ? Number(r.r5.toFixed(2)) : null,
        r20: r.r20 != null ? Number(r.r20.toFixed(2)) : null,
        turn,
        acc,
        avwap: Number(avwap.toFixed(1)),
        rsi: Number(rsi.toFixed(1)),
      };
    });

  console.log("\n=== Top winners (샘플) ===");
  console.table(winners);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
