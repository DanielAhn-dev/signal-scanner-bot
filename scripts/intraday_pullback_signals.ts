/**
 * scripts/intraday_pullback_signals.ts
 * 장중간 눌림목 신호 계산 및 저장
 *
 * 매 시간 또는 주기적으로 실행하여 실시간 신호를 pullback_signals에 저장한다.
 * 밤 배치(scripts/batch_modules/signals.py)와 같은 계산(src/lib/pullbackSignal.ts)을 써서 같은 표의 값이
 * 낮과 밤에 다른 척도가 되지 않게 한다. 밤 배치가 같은 날짜 행을 마감 값으로 다시 덮는다.
 */

import { createClient } from "@supabase/supabase-js";
import { fetchRealtimePriceBatch } from "../src/utils/fetchRealtimePrice";
import { isKrxTradingDay } from "../src/lib/krxCalendar";
import { computePullbackSignal, withIntradayBar, type PullbackBar } from "../src/lib/pullbackSignal";
import { selectPaged } from "../src/services/supabasePaging";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/** 밤 배치와 같은 이력 창(달력 100일) */
const HISTORY_DAYS = 100;
const CODES_PER_QUERY = 50;

type HistoryRow = { date: string; ticker: string; high: number; low: number; close: number; volume: number };

/**
 * 메인: 장중간 신호 계산 및 저장
 */
async function generateIntradayPullbackSignals(): Promise<void> {
  console.log(`\n📊 [Intraday] Pullback Signal Generation: ${new Date().toISOString()}`);

  // 휴장일엔 실시간 가격이 전일 종가라 같은 신호가 휴장일 날짜로 복제 저장된다
  // (2026-06-03·07-17·08-17·09-24·09-25 pullback_signals). 거래일에만 실행한다.
  if (!isKrxTradingDay()) {
    console.log("  -> KRX 휴장일(주말·공휴일) — 장중 신호 생성 생략");
    return;
  }

  try {
    // 오늘 날짜 (KST)
    const tradeDate = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const fromDate = new Date(Date.parse(`${tradeDate}T00:00:00Z`) - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);

    const { data: stocks, error: stockError } = await supabase
      .from("stocks")
      .select("code")
      .in("universe_level", ["core", "extended"])
      .limit(1000);

    if (stockError || !stocks?.length) {
      console.error("Failed to fetch stocks:", stockError);
      return;
    }

    const codes = stocks.map((s) => s.code as string);
    console.log(`  -> 대상 종목: ${codes.length}개`);

    const realtimeMap = await fetchRealtimePriceBatch(codes).catch(() => ({} as Record<string, any>));

    const upserts: Array<Record<string, unknown>> = [];
    let failCount = 0;
    let shortHistory = 0;

    for (let i = 0; i < codes.length; i += CODES_PER_QUERY) {
      const batch = codes.slice(i, i + CODES_PER_QUERY);
      // 예전엔 100종목 × 약 70거래일을 limit(1000) 한 번으로 받아 종목마다 최근 10일치만 남았다 — 끝까지 넘겨 받는다
      const historyData = await selectPaged<HistoryRow>(
        async (from, to) =>
          await supabase
            .from("stock_daily")
            .select("date, ticker, high, low, close, volume")
            .in("ticker", batch)
            .gte("date", fromDate)
            .lt("date", tradeDate)
            .order("ticker")
            .order("date")
            .range(from, to),
        { logLabel: "intraday.pullback_history" }
      ).catch((e) => {
        console.error(`  ⚠️ 이력 조회 실패: ${e}`);
        return [] as HistoryRow[];
      });

      const byTicker = new Map<string, PullbackBar[]>();
      for (const row of historyData) {
        const list = byTicker.get(row.ticker) ?? [];
        list.push({ date: String(row.date).slice(0, 10), high: +row.high, low: +row.low, close: +row.close, volume: +row.volume });
        byTicker.set(row.ticker, list);
      }

      for (const ticker of batch) {
        try {
          const history = (byTicker.get(ticker) ?? []).sort((a, b) => a.date.localeCompare(b.date));
          const rt = realtimeMap[ticker];
          const bars = withIntradayBar(history, tradeDate, Number(rt?.price ?? 0), rt?.volume);
          const signal = computePullbackSignal(bars);
          if (!signal) {
            shortHistory += 1;
            continue;
          }
          upserts.push({ code: ticker, trade_date: tradeDate, ...signal });
        } catch (e) {
          failCount++;
        }
      }
    }

    console.log(`  -> ${upserts.length}개 신호 계산 완료 (실패: ${failCount}, 이력 21일 미만 생략: ${shortHistory})`);

    // 저장 (UPSERT — 밤 크론이 덮어씌울 것)
    if (upserts.length > 0) {
      for (let i = 0; i < upserts.length; i += 200) {
        const batch = upserts.slice(i, i + 200);
        try {
          const { error } = await supabase.from("pullback_signals").upsert(batch);
          if (error) {
            console.error(`  ⚠️ 배치 업로드 실패: ${error.message}`);
          }
        } catch (e) {
          console.error(`  ⚠️ 배치 업로드 예외: ${e}`);
        }
      }
      console.log(`  ✅ ${upserts.length}개 인트라데이 신호 저장 완료`);
    }
  } catch (e) {
    console.error(`  ❌ 인트라데이 신호 생성 실패:`, e);
  }

  console.log(`\n🏁 Intraday Pullback Signal Generation End: ${new Date().toISOString()}`);
}

// 직접 실행 또는 수동 호출
(async () => {
  await generateIntradayPullbackSignals();
})();
