import "../src/lib/installTruncationGuard";
/**
 * 규칙 점수판 실행 (src/services/ruleScoreboard.ts).
 *
 *   pnpm ops:rule-scoreboard                         # 저장된 기록으로 집계만 (읽기 전용)
 *   pnpm ops:rule-scoreboard -- --record             # 가장 최근 거래일 기록 저장 + 점수판 저장 (매일)
 *   pnpm ops:rule-scoreboard -- --telegram           # --record + 점수판을 TELEGRAM_ADMIN_CHAT_ID로 전송 (금·토)
 *   pnpm ops:rule-scoreboard -- --from=2026-09-28    # 빠진 날짜를 일봉으로 다시 만들어 기록(사후 재구성 표시)
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { isExchangeTradedProduct } from "../src/lib/securitiesTax";
import type { DailyBar } from "../src/services/chaseEntrySignal";
import {
  RULE_SCOREBOARD_DIR,
  RULE_SCOREBOARD_RESULT_PATH,
  buildRuleSnapshot,
  evaluateRuleScoreboard,
  formatRuleScoreboard,
  type RuleSnapshot,
} from "../src/services/ruleScoreboard";

const arg = (name: string): string | undefined => process.argv.find((x) => x.startsWith(`--${name}=`))?.split("=")[1];
const SEND_TELEGRAM = process.argv.includes("--telegram");
const FROM = arg("from");
const RECORD = SEND_TELEGRAM || process.argv.includes("--record") || !!FROM;
// 이미 기록된 날을 다시 쓴다(기록을 바로잡을 때만). 기본은 유지 — 나중에 바뀐 자료로 당시 판단을 덮지 않는다.
const OVERWRITE = process.argv.includes("--overwrite");
const INDEX_CODE = "069500";
const BUCKET = "market-snapshots";
/** 일봉 252개가 필요하다. 달력 420일이면 휴장일을 빼도 넉넉하다. */
const BARS_LOOKBACK_DAYS = 420;

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const shiftDate = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

async function fetchPaged<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

async function loadSnapshots(): Promise<RuleSnapshot[]> {
  const bucket = supabase.storage.from(BUCKET);
  const { data: files } = await bucket.list(RULE_SCOREBOARD_DIR, { limit: 1000 });
  const out: RuleSnapshot[] = [];
  for (const f of files ?? []) {
    const { data } = await bucket.download(`${RULE_SCOREBOARD_DIR}/${f.name}`);
    if (!data) continue;
    try {
      out.push(JSON.parse(await data.text()) as RuleSnapshot);
    } catch {
      console.warn(`규칙 기록 파싱 실패: ${f.name}`);
    }
  }
  return out;
}

async function uploadJson(path: string, value: unknown): Promise<boolean> {
  const { error } = await supabase.storage.from(BUCKET).upload(path, JSON.stringify(value), { upsert: true, contentType: "application/json" });
  if (error) console.warn(`저장 실패 ${path}: ${error.message}`);
  return !error;
}

/** asof 이하 가장 최근 membership 날짜의 core·extended 비ETF 종목. 기록이 전혀 없으면 현재 stocks 표. */
async function universeAt(asof: string, fallback: string[]): Promise<string[]> {
  const { data: latest } = await supabase
    .from("universe_membership_daily")
    .select("trade_date")
    .lte("trade_date", asof)
    .order("trade_date", { ascending: false })
    .limit(1);
  const day = latest?.[0]?.trade_date ? String(latest[0].trade_date).slice(0, 10) : null;
  if (!day) return fallback;
  const rows = await fetchPaged<any>((a, b) =>
    supabase
      .from("universe_membership_daily")
      .select("code, name, universe_level, is_active")
      .eq("trade_date", day)
      .order("code")
      .range(a, b)
  );
  const codes = rows
    .filter((r) => r.is_active && ["core", "extended"].includes(String(r.universe_level)) && !isExchangeTradedProduct(r.code, r.name))
    .map((r) => String(r.code));
  return codes.length ? codes : fallback;
}

async function fetchBars(codes: string[], from: string): Promise<Map<string, DailyBar[]>> {
  const out = new Map<string, DailyBar[]>();
  const unique = [...new Set(codes)];
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    const rows = await fetchPaged<any>((a, b) =>
      supabase.from("stock_daily").select("ticker, date, open, high, close, volume").in("ticker", chunk).gte("date", from).order("ticker").order("date").range(a, b)
    );
    for (const r of rows) {
      const list = out.get(r.ticker) ?? [];
      list.push({ date: String(r.date).slice(0, 10), open: +r.open, high: +r.high, close: +r.close, volume: +r.volume });
      out.set(r.ticker, list);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const { data: stocks } = await supabase.from("stocks").select("code, name").in("universe_level", ["core", "extended"]);
  const currentUniverse = (stocks ?? []).filter((s: any) => !isExchangeTradedProduct(s.code, s.name)).map((s: any) => String(s.code));

  const snapshots = await loadSnapshots();
  const existing = new Set(snapshots.map((s) => s.asof));

  // 지수 거래일 달력(가장 최근 일봉이 기록 기준일)
  const indexRows = await fetchPaged<any>((a, b) =>
    supabase.from("stock_daily").select("date").eq("ticker", INDEX_CODE).gte("date", shiftDate(FROM ?? "2026-09-28", -BARS_LOOKBACK_DAYS)).order("date").range(a, b)
  );
  const tradingDates = indexRows.map((r) => String(r.date).slice(0, 10));
  const latestBar = tradingDates[tradingDates.length - 1];
  if (!latestBar) {
    console.log("지수 일봉이 없습니다.");
    return;
  }

  // 기록할 날짜: --from 이면 그 이후 전체 거래일, --record 이면 가장 최근 거래일
  const targets = !RECORD ? [] : FROM ? tradingDates.filter((d) => d >= FROM) : [latestBar];
  const toWrite = targets.filter((d) => OVERWRITE || !existing.has(d));
  for (const d of targets) if (!toWrite.includes(d)) console.log(`규칙 기록 ${d}: 이미 기록됨 — 유지`);

  // 시세: 기록할 날짜와 기존 기록의 후보군 전체
  const codes = new Set<string>([INDEX_CODE, ...currentUniverse]);
  for (const s of snapshots) s.universe.forEach((c) => codes.add(c));
  const earliest = [...toWrite, ...snapshots.map((s) => s.asof)].sort()[0] ?? latestBar;
  const barsByCode = await fetchBars([...codes], shiftDate(earliest, -BARS_LOOKBACK_DAYS));

  for (const asof of toWrite) {
    const universe = await universeAt(asof, currentUniverse);
    universe.forEach((c) => codes.add(c));
    if (universe.some((c) => !barsByCode.has(c))) {
      const missing = universe.filter((c) => !barsByCode.has(c));
      const extra = await fetchBars(missing, shiftDate(earliest, -BARS_LOOKBACK_DAYS));
      extra.forEach((v, k) => barsByCode.set(k, v));
    }
    const snap = buildRuleSnapshot({ asof, universe, barsByCode, recordedAt: new Date().toISOString(), backfilled: asof !== latestBar });
    if (snap.universe.length < 10) {
      console.warn(`규칙 기록 ${asof}: 그날 거래된 후보군 ${snap.universe.length}종목뿐이라 기록하지 않음`);
      continue;
    }
    if (!(await uploadJson(`${RULE_SCOREBOARD_DIR}/${asof}.json`, snap))) continue;
    const i = snapshots.findIndex((s) => s.asof === asof);
    if (i >= 0) snapshots[i] = snap;
    else snapshots.push(snap);
    console.log(
      `규칙 기록 ${asof}${snap.backfilled ? " (사후 재구성)" : ""}: 후보군 ${snap.universe.length} · 급등 ${snap.flags.chase.length} · 윗꼬리 ${snap.flags.wick.length} · 급락 ${snap.flags.knife.length} · 선호 상위 ${snap.flags["pref-top"].length}`
    );
  }

  const openByCode = new Map<string, Map<string, number>>();
  for (const [code, bars] of barsByCode) openByCode.set(code, new Map(bars.map((b) => [b.date, b.open])));
  const board = evaluateRuleScoreboard({
    snapshots,
    tradingDates,
    openAt: (code, date) => {
      const v = openByCode.get(code)?.get(date);
      return v && v > 0 ? v : null;
    },
    indexCode: INDEX_CODE,
    generatedAt: new Date().toISOString(),
  });
  const report = formatRuleScoreboard(board);
  console.log(report);

  if (RECORD) await uploadJson(RULE_SCOREBOARD_RESULT_PATH, board);

  if (SEND_TELEGRAM) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (token && chatId) {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: report }),
      }).catch((e) => console.warn(`전송 실패: ${e}`));
    } else {
      console.log("TELEGRAM_BOT_TOKEN / TELEGRAM_ADMIN_CHAT_ID 없음 — 전송 생략");
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
