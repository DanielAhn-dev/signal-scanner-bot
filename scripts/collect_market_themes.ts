import "../src/lib/installTruncationGuard";
/**
 * 네이버 테마(약 260개) 장 마감 스냅샷 → market_themes·theme_daily (db/migrations/037_market_themes.sql)
 *
 * 웹 '오늘 시장'의 뜨는·식는 테마와 보유 연결 테마 근거가 이 기록을 쓴다(src/lib/themeFlow.ts).
 * 네이버가 언론에 뜨는 테마를 새로 추가하므로 테마 목록은 고정하지 않는다. 처음 보는 테마는 first_seen이 그날이 된다.
 * 테마 등락은 그날 값만 주므로 5일 등락·평소 대비는 날마다 쌓아서 계산한다.
 *
 * 장중(marketStatus=OPEN)이면 그날 값이 아직 움직이므로 저장하지 않는다 — GitHub 스케줄이 다음 날 아침까지 밀리면 하루 빠진다.
 * 테마나 구성 종목 조회가 많이 실패하면 일부만 저장하지 않고 종료 코드 1로 끝낸다(부분 적재 방지).
 *
 * 사용: pnpm exec tsx scripts/collect_market_themes.ts [--dryRun=true] [--force=true]
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import {
  matchThemeNews,
  parseMainNewsList,
  parseThemeList,
  parseThemeMembers,
  type Headline,
  type ThemeListRow,
  type ThemeMember,
} from "../src/lib/marketThemes";
import { isKrxTradingDate, previousKrxTradingDate } from "../src/lib/krxCalendar";
import { rankThemes, themeStats, type ThemeDay } from "../src/lib/themeFlow";

const DRY_RUN = process.argv.includes("--dryRun=true");
const FORCE = process.argv.includes("--force=true");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const PAUSE_MS = 120;
const RETENTION_DAYS = 400;
/** 이보다 테마가 적게 오면 응답 구조가 바뀐 것으로 본다 */
const MIN_THEMES = 100;
/** 구성 종목 조회 실패가 이 비율을 넘으면 저장하지 않는다 */
const MAX_MEMBER_FAIL_RATIO = 0.1;
/** 주요 뉴스 20건씩. 월요일은 주말 기사까지 들어와 16쪽(320건)에서 끊겼다(2026-10-19 확인) */
const MAX_NEWS_PAGES = 30;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string): Promise<unknown> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt >= 1) throw new Error(`${url}: ${e instanceof Error ? e.message : String(e)}`);
      await sleep(1_000);
    }
  }
}

async function fetchThemeList(): Promise<{ rows: ThemeListRow[]; marketStatus: string | null }> {
  const rows: ThemeListRow[] = [];
  let marketStatus: string | null = null;
  for (let page = 1; page <= 10; page += 1) {
    const parsed = parseThemeList(await getJson(`https://m.stock.naver.com/api/stocks/theme?page=${page}&pageSize=100`));
    marketStatus ??= parsed.marketStatus;
    rows.push(...parsed.rows);
    if (!parsed.rows.length || rows.length >= parsed.totalCount) break;
    await sleep(PAUSE_MS);
  }
  return { rows, marketStatus };
}

async function fetchMembers(themeNo: number): Promise<ThemeMember[]> {
  const out: ThemeMember[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const parsed = parseThemeMembers(await getJson(`https://m.stock.naver.com/api/stocks/theme/${themeNo}?page=${page}&pageSize=100`));
    out.push(...parsed.members);
    if (!parsed.members.length || out.length >= parsed.totalCount) break;
    await sleep(PAUSE_MS);
  }
  return out;
}

/** 직전 거래일 장 마감(15:30) 뒤 ~ 그 거래일 끝까지의 주요 뉴스 */
async function fetchHeadlines(tradeDate: string): Promise<Headline[]> {
  const prev = previousKrxTradingDate(tradeDate).replace(/-/g, "");
  const since = `${prev}1530`;
  const until = `${tradeDate.replace(/-/g, "")}2359`;
  const seen = new Set<string>();
  const out: Headline[] = [];
  for (let page = 1; page <= MAX_NEWS_PAGES; page += 1) {
    const rows = parseMainNewsList(await getJson(`https://m.stock.naver.com/api/news/list?category=mainnews&pageSize=20&page=${page}`));
    if (!rows.length) break;
    for (const h of rows) {
      if (seen.has(h.link)) continue;
      seen.add(h.link);
      if (h.at > since && h.at <= until) out.push(h);
    }
    // 최신순이라 페이지 마지막 기사가 창보다 오래되면 그만
    if (rows[rows.length - 1].at <= since) break;
    await sleep(PAUSE_MS);
  }
  return out;
}

function mode(xs: string[]): string | null {
  const c = new Map<string, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [k, v] of c) if (v > n) [best, n] = [k, v];
  return best;
}

async function main() {
  const { rows: themes, marketStatus } = await fetchThemeList();
  console.log(`테마 ${themes.length}개, 시장 상태 ${marketStatus}`);
  if (themes.length < MIN_THEMES) throw new Error(`테마가 ${themes.length}개뿐 — 응답 구조 확인 필요`);
  if (marketStatus === "OPEN" && !FORCE) {
    console.log("장중이라 저장하지 않음 (--force=true로 강제)");
    return;
  }

  const members = new Map<number, ThemeMember[]>();
  const failed: number[] = [];
  for (const t of themes) {
    try {
      members.set(t.themeNo, await fetchMembers(t.themeNo));
    } catch (e) {
      failed.push(t.themeNo);
      console.warn(`구성 종목 실패 ${t.themeNo} ${t.name}: ${e instanceof Error ? e.message : e}`);
    }
    await sleep(PAUSE_MS);
  }
  if (failed.length / themes.length > MAX_MEMBER_FAIL_RATIO) {
    throw new Error(`구성 종목 조회 실패 ${failed.length}/${themes.length} — 저장하지 않음`);
  }

  const tradeDate = mode([...members.values()].flat().map((m) => m.tradedDate).filter((d): d is string => !!d));
  if (!tradeDate) throw new Error("거래일을 알 수 없음");
  if (!isKrxTradingDate(tradeDate) && !FORCE) {
    console.log(`${tradeDate}는 거래일이 아님 — 저장하지 않음`);
    return;
  }
  console.log(`거래일 ${tradeDate}, 구성 종목 실패 ${failed.length}`);

  const headlines = await fetchHeadlines(tradeDate);
  const news = matchThemeNews(themes, headlines);
  console.log(`주요 뉴스 ${headlines.length}건`);

  // 실패한 테마는 그날 행을 만들지 않는다(0으로 넣으면 '거래 없음'으로 읽힌다)
  const dayRows = themes
    .filter((t) => members.has(t.themeNo))
    .map((t) => {
      const ms = members.get(t.themeNo)!;
      const n = news.get(t.themeNo) ?? { count: 0, items: [] };
      return {
        trade_date: tradeDate,
        theme_no: t.themeNo,
        change_rate: t.changeRate,
        rise_count: t.riseCount,
        fall_count: t.fallCount,
        total_count: t.totalCount || ms.length,
        trading_value: Math.round(ms.reduce((a, m) => a + m.tradingValue, 0)),
        news_count: n.count,
        news: n.items,
      };
    });

  if (DRY_RUN) {
    const asDays: ThemeDay[] = dayRows.map((r) => ({
      tradeDate: r.trade_date,
      themeNo: r.theme_no,
      changeRate: r.change_rate,
      riseCount: r.rise_count,
      totalCount: r.total_count,
      tradingValue: r.trading_value,
      newsCount: r.news_count,
      news: r.news,
    }));
    const ranked = rankThemes(asDays.map((d) => themeStats([d])!));
    const name = new Map(themes.map((t) => [t.themeNo, t.name]));
    console.log("오늘 하루치 상위 10 (dryRun, 저장 안 함):");
    for (const r of ranked.slice(0, 10)) {
      console.log(`  ${r.rank}. ${name.get(r.themeNo)}  ${r.ret5.toFixed(2)}%  폭 ${Math.round((r.breadth5 ?? 0) * 100)}%  뉴스 ${r.news5}`);
    }
    const mentioned = [...news.entries()].filter(([, v]) => v.count > 0).sort((a, b) => b[1].count - a[1].count).slice(0, 10);
    console.log("뉴스 언급 상위:", mentioned.map(([no, v]) => `${name.get(no)} ${v.count}`).join(", "));
    return;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const existing = new Map<number, string>();
  for (let off = 0; ; off += 1000) {
    const { data, error } = await supabase.from("market_themes").select("theme_no, first_seen").range(off, off + 999);
    // 조회 실패를 "처음 보는 테마"로 취급하면 전부 '새로 등장'이 되므로 멈춘다
    if (error) throw new Error(`market_themes 조회 실패: ${error.message}`);
    for (const r of data ?? []) existing.set(Number(r.theme_no), String(r.first_seen));
    if (!data || data.length < 1000) break;
  }

  const metaRows = themes
    .filter((t) => members.has(t.themeNo))
    .map((t) => ({
      theme_no: t.themeNo,
      name: t.name,
      member_codes: [...new Set(members.get(t.themeNo)!.map((m) => m.code))],
      first_seen: existing.get(t.themeNo) ?? tradeDate,
      last_seen: tradeDate,
      updated_at: new Date().toISOString(),
    }));
  const { error: metaErr } = await supabase.from("market_themes").upsert(metaRows, { onConflict: "theme_no" });
  if (metaErr) throw new Error(`market_themes 저장 실패: ${metaErr.message}`);

  const { error: dayErr } = await supabase.from("theme_daily").upsert(dayRows, { onConflict: "trade_date,theme_no" });
  if (dayErr) throw new Error(`theme_daily 저장 실패: ${dayErr.message}`);

  const cutoff = new Date(Date.parse(`${tradeDate}T00:00:00Z`) - RETENTION_DAYS * 86_400_000).toISOString().slice(0, 10);
  const { error: delErr } = await supabase.from("theme_daily").delete().lt("trade_date", cutoff);
  if (delErr) console.warn(`오래된 행 정리 실패(다음 실행에 다시): ${delErr.message}`);

  const fresh = metaRows.filter((r) => !existing.has(r.theme_no) && existing.size > 0);
  console.log(`저장: 테마 ${metaRows.length}, 일별 ${dayRows.length}${fresh.length ? `, 새 테마 ${fresh.map((r) => r.name).join(", ")}` : ""}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
