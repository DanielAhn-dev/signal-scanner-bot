/**
 * scripts/intraday_pullback_signals.ts
 * 장중간 눌림목 신호 계산 및 저장
 * 
 * 매 시간 또는 주기적으로 실행하여 실시간 신호를 pullback_signals에 부분 저장
 * 매일 밤 크론 실행 시 complete 데이터로 UPSERT 덮어씌워짐
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function safe_float(x: any, default_val: number = 0): number {
  const v = parseFloat(x);
  return !isNaN(v) && isFinite(v) ? v : default_val;
}

function safe_int(x: any, default_val: number = 0): number {
  const v = parseInt(x, 10);
  return !isNaN(v) && isFinite(v) ? v : default_val;
}

interface StockDailyRow {
  date: string;
  ticker: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  value: number;
}

interface PullbackSignal {
  code: string;
  trade_date: string;
  entry_grade: "A" | "B" | "C" | "D";
  entry_score: number;
  trend_grade: string;
  dist_grade: string;
  dist_pct: number;
  pivot_grade: string;
  vol_atr_grade: string;
  warn_grade: "SAFE" | "WATCH" | "WARN" | "SELL";
  warn_score: number;
  ma21: number;
  ma50: number;
  is_intraday?: boolean; // 표시: 이것이 intraday 신호임
}

/**
 * 단순 pullback 신호 계산
 * (complete daily_batch와 동일한 로직, but shorter history due to intraday)
 */
function computeIntradayPullbackSignal(history: StockDailyRow[]): Omit<PullbackSignal, "code" | "trade_date"> | null {
  if (!history || history.length < 5) return null;

  const latest = history[history.length - 1];
  const prev = history[history.length - 2];
  
  if (!latest || !prev) return null;

  const close = latest.close;
  const high = latest.high;
  const low = latest.low;
  const vol = latest.volume || 1;
  const prevClose = prev.close;

  // MA 계산 (5일, 20일 단순이동평균)
  const ma5 = history.slice(-5).reduce((s, r) => s + r.close, 0) / 5;
  const ma20 = history.length >= 20
    ? history.slice(-20).reduce((s, r) => s + r.close, 0) / 20
    : close;
  const ma50 = history.length >= 50
    ? history.slice(-50).reduce((s, r) => s + r.close, 0) / 50
    : close;

  // Entry Grade (간단한 버전)
  let entry_score = 50;
  let entry_grade: "A" | "B" | "C" | "D" = "C";

  // 1. 추세 강도 (close vs MA)
  const trend_vs_ma5 = close / ma5 - 1;
  const trend_vs_ma20 = close / ma20 - 1;
  let trend_grade = "D";

  if (trend_vs_ma20 >= 0.05) {
    entry_score += 15;
    trend_grade = "A";
  } else if (trend_vs_ma20 >= 0.02) {
    entry_score += 10;
    trend_grade = "B";
  } else if (trend_vs_ma20 >= -0.02) {
    entry_score += 5;
    trend_grade = "C";
  } else {
    trend_grade = "D";
  }

  // 2. 거리 (Pullback depth)
  const pullback_depth = (ma5 - low) / ma5;
  let dist_grade = "D";
  let dist_pct = pullback_depth * 100;

  if (pullback_depth >= 0.05 && pullback_depth <= 0.15) {
    entry_score += 10;
    dist_grade = "A";
  } else if (pullback_depth >= 0.02 && pullback_depth <= 0.2) {
    entry_score += 5;
    dist_grade = "B";
  } else if (pullback_depth > 0) {
    dist_grade = "C";
  }

  // 3. Pivot (Support test)
  let pivot_grade = "D";
  const recent_low = Math.min(...history.slice(-10).map(r => r.low));
  if (close <= recent_low * 1.02) {
    entry_score += 8;
    pivot_grade = "A";
  } else if (close <= recent_low * 1.05) {
    entry_score += 4;
    pivot_grade = "B";
  }

  // 4. Volume
  const avg_vol = history.slice(-20).reduce((s, r) => s + r.volume, 0) / 20;
  let vol_atr_grade = "D";
  if (vol > avg_vol * 1.2) {
    entry_score += 5;
    vol_atr_grade = "A";
  } else if (vol > avg_vol * 0.8) {
    vol_atr_grade = "B";
  }

  // Final Entry Grade
  if (entry_score >= 70) {
    entry_grade = "A";
  } else if (entry_score >= 55) {
    entry_grade = "B";
  } else if (entry_score >= 40) {
    entry_grade = "C";
  } else {
    entry_grade = "D";
  }

  // Warning Grade (간단한 버전)
  let warn_score = 0;
  let warn_grade: "SAFE" | "WATCH" | "WARN" | "SELL" = "SAFE";

  // RSI 계산 (간단)
  const changes = history.slice(-14).map((r, i) => {
    if (i === 0) return 0;
    return r.close - history[i - 1].close;
  });
  const gains = changes.filter(c => c > 0).reduce((s, c) => s + c, 0) / 14;
  const losses = -changes.filter(c => c < 0).reduce((s, c) => s + c, 0) / 14;
  const rs = losses === 0 ? 100 : gains / losses;
  const rsi = 100 - 100 / (1 + rs);

  if (rsi > 75) {
    warn_score += 1;
  }
  if (rsi > 85) {
    warn_score += 1;
  }

  // 가격 급등 확인
  if (trend_vs_ma5 > 0.10) {
    warn_score += 1;
  }

  warn_grade = warn_score >= 3 ? "SELL" : warn_score === 2 ? "WARN" : warn_score === 1 ? "WATCH" : "SAFE";

  return {
    entry_grade,
    entry_score,
    trend_grade,
    dist_grade,
    dist_pct: safe_float(dist_pct),
    pivot_grade,
    vol_atr_grade,
    warn_grade,
    warn_score,
    ma21: safe_float(ma20),
    ma50: safe_float(ma50),
    is_intraday: true,
  };
}

/**
 * 메인: 장중간 신호 계산 및 저장
 */
async function generateIntradayPullbackSignals(): Promise<void> {
  console.log(`\n📊 [Intraday] Pullback Signal Generation: ${new Date().toISOString()}`);

  try {
    // 오늘 날짜 (KST)
    const now = new Date();
    const kstDate = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const tradeDate = kstDate.toISOString().split("T")[0]; // YYYY-MM-DD

    // 코어/확장 종목 조회
    const { data: stocks, error: stockError } = await supabase
      .from("stocks")
      .select("code")
      .in("universe_level", ["core", "extended"])
      .limit(500);

    if (stockError || !stocks?.length) {
      console.error("Failed to fetch stocks:", stockError);
      return;
    }

    const codes = stocks.map(s => s.code);
    console.log(`  -> 대상 종목: ${codes.length}개`);

    const upserts: PullbackSignal[] = [];
    let fail_count = 0;

    // 100개씩 배치 처리
    for (let i = 0; i < codes.length; i += 100) {
      const batch = codes.slice(i, i + 100);

      // 최근 100일 데이터 조회
      const { data: historyData, error: histError } = await supabase
        .from("stock_daily")
        .select("date, ticker, open, high, low, close, volume, value")
        .in("ticker", batch)
        .gte("date", new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString().split("T")[0])
        .order("date", { ascending: false })
        .limit(1000);

      if (histError || !historyData?.length) {
        fail_count += batch.length;
        continue;
      }

      // 종목별로 그룹핑
      const byTicker = new Map<string, StockDailyRow[]>();
      for (const row of historyData) {
        if (!byTicker.has(row.ticker)) {
          byTicker.set(row.ticker, []);
        }
        byTicker.get(row.ticker)!.push(row as StockDailyRow);
      }

      // 각 종목 신호 계산
      for (const [ticker, history] of byTicker) {
        try {
          const sorted = history.sort((a, b) => a.date.localeCompare(b.date));
          const signal = computeIntradayPullbackSignal(sorted);

          if (signal) {
            upserts.push({
              code: ticker,
              trade_date: tradeDate,
              ...signal,
            });
          }
        } catch (e) {
          fail_count++;
        }
      }

      if ((i / 100 + 1) % 2 === 0) {
        console.log(`  -> 진행: ${Math.min(i + 100, codes.length)}/${codes.length}`);
      }
    }

    console.log(`  -> ${upserts.length}개 신호 계산 완료 (실패: ${fail_count})`);

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
