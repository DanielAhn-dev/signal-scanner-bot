/**
 * 진입 신호 백테스트: 어떤 진입 조건이 양(+)의 기대값을 갖는지 찾는다.
 *
 * 청산 규칙 백테스트(backtest_exit_params.ts) 결과, 청산을 어떻게 바꿔도 평균 수익이 음수였다.
 * 문제는 진입이므로, 자동매매가 실제 매수 판단에 쓰는 scores 테이블의 일별 이력(점수·신호·팩터)을
 * 진입 후보로 삼아 운영 청산 규칙(lock+cap)으로 결과를 재현하고, 팩터 구간별 기대값을 비교한다.
 *
 * 과최적화 방지
 *   - 기간을 학습(IS, --split 이전)과 검증(OOS, 이후)으로 나눈다. 조건 선택은 IS에서만 하고 OOS로 확인한다.
 *   - 같은 종목의 연속 신호는 --cooldown 세션 간격으로 솎아 상관된 표본 중복을 줄인다.
 *   - DATA_CONTAMINATION_WINDOWS의 "prices" 구간에 신호일/보유기간이 걸리면 제외한다.
 *   - 신호일 종가가 5일 넘게 오래된(수집 누락) 표본도 제외한다.
 *   - scores에는 TS 엔진(전체 팩터)과 Python 폴백(rsi/roc/수급만) 두 스키마가 섞여 있다. 폴백 행은
 *     게이트가 기본값으로 계산돼 다른 집단처럼 움직이므로, 기본은 전체 팩터(sma200 존재) 행만 쓴다.
 *
 * 사용 예
 *   pnpm dlx tsx scripts/backtest_entry_signals.ts
 *   pnpm dlx tsx scripts/backtest_entry_signals.ts --from=2025-10-01 --split=2026-06-01 --minScore=50
 *   옵션: --to  --maxHold=20  --stop=4  --tp=8  --costPct=0.45  --cooldown=5  --minN=40  --requireFactors=false
 *         --source=engine|legacy|all (engine = TS 엔진/과거 재계산 점수만)
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { evaluateAutoTradeSignalGate } from "../src/services/virtualAutoTradeSignalGate";
import { isInContaminationWindow } from "../src/services/virtualAutoTradeSelection";
import { PRODUCTION_RULE, simulateExit, type Bar } from "./lib/exitSimulation";

type Sample = {
  code: string;
  asof: string;
  period: "IS" | "OOS";
  pnlPct: number;
  fwd10Pct: number | null;
  features: Record<string, string>;
};

type Stats = { n: number; avg: number; win: number; pf: number };

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((x) => x.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function numArg(name: string, fallback: number): number {
  const n = Number(arg(name, String(fallback)));
  return Number.isFinite(n) ? n : fallback;
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function band(value: number | null, edges: number[], labels: string[]): string {
  if (value == null) return "n/a";
  for (let i = 0; i < edges.length; i += 1) if (value < edges[i]) return labels[i];
  return labels[labels.length - 1];
}

function stats(samples: Sample[]): Stats {
  const n = samples.length;
  if (!n) return { n: 0, avg: 0, win: 0, pf: 0 };
  const gw = samples.filter((s) => s.pnlPct > 0).reduce((a, s) => a + s.pnlPct, 0);
  const gl = Math.abs(samples.filter((s) => s.pnlPct <= 0).reduce((a, s) => a + s.pnlPct, 0));
  return {
    n,
    avg: samples.reduce((a, s) => a + s.pnlPct, 0) / n,
    win: (samples.filter((s) => s.pnlPct > 0).length / n) * 100,
    pf: gl > 0 ? gw / gl : Infinity,
  };
}

function fmt(s: Stats): string {
  if (!s.n) return "n=   0".padEnd(34);
  const avg = `${s.avg >= 0 ? "+" : ""}${s.avg.toFixed(2)}%`;
  return `n=${String(s.n).padStart(4)} 평균 ${avg.padStart(7)} 승률 ${s.win.toFixed(0).padStart(3)}% PF ${s.pf.toFixed(2)}`;
}

/**
 * 로드한 전 종목 일봉으로 동일가중 시장지수를 만든다(일간 수익률 평균, ±30% 초과는 분할/오류로 보고 제외).
 * KODEX200 등 지수 프록시 일봉이 stock_daily에 충분히 쌓여 있지 않아 대신 쓴다.
 */
function buildEqualWeightIndex(barsByCode: Map<string, Bar[]>): Bar[] {
  const sumByDate = new Map<string, { sum: number; n: number }>();
  for (const bars of barsByCode.values()) {
    for (let i = 1; i < bars.length; i += 1) {
      const prev = bars[i - 1].close;
      const cur = bars[i].close;
      if (!(prev > 0) || !(cur > 0)) continue;
      const ret = cur / prev - 1;
      if (Math.abs(ret) > 0.3) continue;
      const agg = sumByDate.get(bars[i].date) ?? { sum: 0, n: 0 };
      agg.sum += ret;
      agg.n += 1;
      sumByDate.set(bars[i].date, agg);
    }
  }
  let level = 100;
  return [...sumByDate.entries()]
    .filter(([, agg]) => agg.n >= 30)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, agg]) => {
      level *= 1 + agg.sum / agg.n;
      return { date, open: level, high: level, low: level, close: level, volume: agg.n };
    });
}

/** 시장 국면: 시장지수 종가가 50일선 위/아래, 20세션 수익률 구간 */
function resolveMarketRegime(indexBars: Bar[], dateKey: string): { trend: string; ret20: string } {
  let idx = -1;
  for (let i = 0; i < indexBars.length; i += 1) {
    if (indexBars[i].date <= dateKey) idx = i;
    else break;
  }
  if (idx < 50) return { trend: "n/a", ret20: "n/a" };
  const window = indexBars.slice(idx - 49, idx + 1);
  const sma50 = window.reduce((a, b) => a + b.close, 0) / window.length;
  const close = indexBars[idx].close;
  const ret20 = ((close - indexBars[idx - 20].close) / indexBars[idx - 20].close) * 100;
  return {
    trend: close >= sma50 ? "above50" : "below50",
    ret20: band(ret20, [-3, 0, 3], ["<-3", "-3~0", "0~3", "3+"]),
  };
}

function extractFeatures(input: {
  score: number;
  signal: string;
  factors: Record<string, unknown>;
  close: number;
  market: string;
  regime: { trend: string; ret20: string };
}): Record<string, string> {
  const f = input.factors;
  const gate = evaluateAutoTradeSignalGate({
    currentPrice: input.close,
    score: input.score,
    factors: f,
    minTrustScore: 62,
  });
  const sma200 = num(f.sma200);
  const sma50 = num(f.sma50);
  return {
    score: band(input.score, [60, 70, 80], ["50-59", "60-69", "70-79", "80+"]),
    signal: input.signal || "n/a",
    trustGrade: gate.grade,
    gatePassed: gate.passed ? "pass" : "reject",
    sma200: sma200 && sma200 > 0 ? (input.close >= sma200 ? "above" : "below") : "n/a",
    sma50: sma50 && sma50 > 0 ? (input.close >= sma50 ? "above" : "below") : "n/a",
    macd: String(f.macd_cross ?? "none") || "none",
    stableTurn: String(f.stable_turn ?? "none") || "none",
    rsi: band(num(f.rsi14), [35, 48, 68, 74], ["<35", "35-48", "48-68", "68-74", "74+"]),
    volRatio: band(num(f.vol_ratio), [0.9, 1.2, 1.8], ["<0.9", "0.9-1.2", "1.2-1.8", "1.8+"]),
    atrPct: band(num(f.atr_pct), [2, 3, 4.5], ["<2", "2-3", "3-4.5", "4.5+"]),
    roc21: band(num(f.roc21), [-10, 0, 10, 25], ["<-10", "-10~0", "0~10", "10~25", "25+"]),
    instSignal: String(f.institutional_signal ?? "n/a"),
    avwapRegime: String(f.avwap_regime ?? "n/a"),
    netBuy5d: band(num(f.net_buying_pressure_5d), [0], ["<=0", ">0"]),
    accumulation: f.stable_accumulation === true ? "yes" : f.stable_accumulation === false ? "no" : "n/a",
    accDays: band(num(f.stable_accumulation_days), [1, 3, 6], ["0", "1-2", "3-5", "6+"]),
    stableAboveAvg: f.stable_above_avg === true ? "yes" : f.stable_above_avg === false ? "no" : "n/a",
    market: input.market || "n/a",
    mktTrend: input.regime.trend,
    mktRet20: input.regime.ret20,
  };
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required");
  const supabase = createClient(url, key);

  const from = arg("from", "2025-10-01");
  const to = arg("to", new Date().toISOString().slice(0, 10));
  const split = arg("split", "2026-06-01");
  const minScore = numArg("minScore", 50);
  const maxHold = numArg("maxHold", 20);
  const baseStop = numArg("stop", 4);
  const baseTp = numArg("tp", 8);
  const costPct = numArg("costPct", 0.45);
  const cooldown = numArg("cooldown", 5);
  const minN = numArg("minN", 40);
  const requireFactors = arg("requireFactors", "true") !== "false";
  // engine: TS 엔진 점수(실시간 engine + 과거 재계산 engine_pit)만 사용. legacy: Python 폴백만. all: 전부
  const sourceFilter = arg("source", "all");

  // 1) 점수 이력
  type ScoreRow = { code: string; asof: string; score: number; signal: string; factors: Record<string, unknown> };
  const scoreRows: ScoreRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("scores")
      .select("code, asof, score, signal, factors")
      .gte("asof", from)
      .lte("asof", to)
      .gte("score", minScore)
      .order("asof", { ascending: true })
      .order("code", { ascending: true })
      .range(offset, offset + 999);
    if (error) throw error;
    for (const r of data ?? []) {
      scoreRows.push({
        code: String(r.code),
        asof: String(r.asof).slice(0, 10),
        score: Number(r.score) || 0,
        signal: String(r.signal ?? "").toUpperCase(),
        factors: (r.factors ?? {}) as Record<string, unknown>,
      });
    }
    if (!data || data.length < 1000) break;
  }
  const codes = [...new Set(scoreRows.map((r) => r.code))];
  console.log(`[backtest-entry] scores=${scoreRows.length} codes=${codes.length} ${from}~${to} split=${split} minScore=${minScore}`);

  // 2) 시장 구분 + 일봉
  const marketByCode = new Map<string, string>();
  for (let i = 0; i < codes.length; i += 500) {
    const { data } = await supabase.from("stocks").select("code, market").in("code", codes.slice(i, i + 500));
    for (const r of data ?? []) marketByCode.set(String(r.code), String(r.market ?? ""));
  }
  const barsByCode = new Map<string, Bar[]>();
  const priceFrom = new Date(Date.parse(from) - 70 * 86_400_000).toISOString().slice(0, 10);
  const CONCURRENCY = 8;
  for (let i = 0; i < codes.length; i += CONCURRENCY) {
    await Promise.all(
      codes.slice(i, i + CONCURRENCY).map(async (code) => {
        const { data } = await supabase
          .from("stock_daily")
          .select("date, open, high, low, close, volume")
          .eq("ticker", code)
          .gte("date", priceFrom)
          .order("date", { ascending: true })
          .limit(1000);
        barsByCode.set(
          code,
          ((data ?? []) as Record<string, unknown>[]).map((r) => ({
            date: String(r.date).slice(0, 10),
            open: Number(r.open) || 0,
            high: Number(r.high) || 0,
            low: Number(r.low) || 0,
            close: Number(r.close) || 0,
            volume: Number(r.volume) || 0,
          }))
        );
      })
    );
  }

  const indexBars = buildEqualWeightIndex(barsByCode);

  // 3) 표본 생성
  const samples: Sample[] = [];
  const lastKeptIdx = new Map<string, number>();
  const dropped = { noBars: 0, partialFactors: 0, contaminated: 0, stale: 0, cooldown: 0, incomplete: 0 };
  for (const row of scoreRows) {
    const scoreSource = String(row.factors.score_source ?? "legacy_fallback");
    const isEngine = scoreSource === "engine" || scoreSource === "engine_pit";
    if ((sourceFilter === "engine" && !isEngine) || (sourceFilter === "legacy" && isEngine)) {
      dropped.partialFactors += 1;
      continue;
    }
    if (requireFactors && row.factors.sma200 == null) {
      dropped.partialFactors += 1;
      continue;
    }
    const bars = barsByCode.get(row.code);
    if (!bars?.length) {
      dropped.noBars += 1;
      continue;
    }
    const entryIdx = bars.findIndex((b) => b.date > row.asof);
    if (entryIdx < 21) {
      dropped.incomplete += 1;
      continue;
    }
    const signalBar = bars[entryIdx - 1];
    if ((Date.parse(row.asof) - Date.parse(signalBar.date)) / 86_400_000 > 5) {
      dropped.stale += 1;
      continue;
    }
    const holdWindow = bars.slice(entryIdx, entryIdx + maxHold + 1);
    if (
      isInContaminationWindow(row.asof, "prices") ||
      holdWindow.some((b) => isInContaminationWindow(b.date, "prices"))
    ) {
      dropped.contaminated += 1;
      continue;
    }
    const prevIdx = lastKeptIdx.get(row.code);
    if (prevIdx != null && entryIdx - prevIdx < cooldown) {
      dropped.cooldown += 1;
      continue;
    }
    const sim = simulateExit(PRODUCTION_RULE, bars, entryIdx, { baseTp, baseStop, maxHold, costPct });
    if (!sim) {
      dropped.incomplete += 1;
      continue;
    }
    lastKeptIdx.set(row.code, entryIdx);
    const entry = bars[entryIdx].open > 0 ? bars[entryIdx].open : bars[entryIdx].close;
    const fwdBar = bars[entryIdx + 9];
    samples.push({
      code: row.code,
      asof: row.asof,
      period: row.asof < split ? "IS" : "OOS",
      pnlPct: sim.result.pnlPct,
      fwd10Pct: fwdBar && entry > 0 ? ((fwdBar.close - entry) / entry) * 100 : null,
      features: extractFeatures({
        score: row.score,
        signal: row.signal,
        factors: row.factors,
        close: signalBar.close,
        market: marketByCode.get(row.code) ?? "",
        regime: resolveMarketRegime(indexBars, row.asof),
      }),
    });
  }
  const is = samples.filter((s) => s.period === "IS");
  const oos = samples.filter((s) => s.period === "OOS");
  console.log(
    `표본 ${samples.length} (IS ${is.length} / OOS ${oos.length}) · 제외: 일봉없음 ${dropped.noBars}, 팩터누락 ${dropped.partialFactors}, 오염구간 ${dropped.contaminated}, 종가누락 ${dropped.stale}, 쿨다운 ${dropped.cooldown}, 데이터부족 ${dropped.incomplete}`
  );
  console.log(`청산규칙 ${PRODUCTION_RULE} · 기본 손절 ${baseStop}% / 익절 ${baseTp}% · 최대보유 ${maxHold}세션 · 왕복비용 ${costPct}%`);
  console.log(`\n[기준선] 전체   IS: ${fmt(stats(is))}   OOS: ${fmt(stats(oos))}`);

  // 운영 매수 게이트 근사: 점수 ≥ min_buy_score(기본 72) + 신호 게이트 통과
  const prodMinScore = numArg("prodMinScore", 72);
  const isProd = (s: Sample) =>
    s.features.gatePassed === "pass" && (s.features.score === "70-79" || s.features.score === "80+");
  console.log(
    `[운영게이트 근사] 점수 70+ & 게이트 통과  IS: ${fmt(stats(is.filter(isProd)))}   OOS: ${fmt(stats(oos.filter(isProd)))}  (min_buy_score=${prodMinScore}는 70+ 구간으로 근사)`
  );

  // 4) 단일 팩터 구간별
  const featureNames = Object.keys(samples[0]?.features ?? {});
  console.log(`\n=== 팩터 구간별 기대값 (✓ = IS·OOS 모두 평균>0, 각 n≥${minN}) ===`);
  for (const feature of featureNames) {
    const values = [...new Set(samples.map((s) => s.features[feature]))].sort();
    console.log(`\n[${feature}]`);
    for (const value of values) {
      const a = stats(is.filter((s) => s.features[feature] === value));
      const b = stats(oos.filter((s) => s.features[feature] === value));
      const ok = a.n >= minN && b.n >= minN && a.avg > 0 && b.avg > 0 ? " ✓" : "";
      console.log(`  ${value.padEnd(12)} IS ${fmt(a)} | OOS ${fmt(b)}${ok}`);
    }
  }

  // 5) 2개 조건 조합 탐색: IS에서만 순위를 매기고 OOS로 확인
  type Cond = { feature: string; value: string };
  const conds: Cond[] = featureNames.flatMap((feature) =>
    [...new Set(samples.map((s) => s.features[feature]))].map((value) => ({ feature, value }))
  );
  const combos: Array<{ label: string; isStats: Stats; oosStats: Stats }> = [];
  for (let i = 0; i < conds.length; i += 1) {
    for (let j = i; j < conds.length; j += 1) {
      const c1 = conds[i];
      const c2 = conds[j];
      if (i !== j && c1.feature === c2.feature) continue;
      const match = (s: Sample) =>
        s.features[c1.feature] === c1.value && s.features[c2.feature] === c2.value;
      const isStats = stats(is.filter(match));
      if (isStats.n < minN) continue;
      combos.push({
        label: i === j ? `${c1.feature}=${c1.value}` : `${c1.feature}=${c1.value} & ${c2.feature}=${c2.value}`,
        isStats,
        oosStats: stats(oos.filter(match)),
      });
    }
  }
  combos.sort((a, b) => b.isStats.avg - a.isStats.avg);
  const top = combos.slice(0, numArg("top", 25));
  const oosPositive = top.filter((c) => c.oosStats.n >= minN && c.oosStats.avg > 0).length;
  console.log(`\n=== IS 상위 ${top.length}개 조건 → OOS 검증 (OOS 양수 ${oosPositive}/${top.length}) ===`);
  for (const c of top) {
    const ok = c.oosStats.n >= minN && c.oosStats.avg > 0 ? " ✓" : c.oosStats.n < minN ? " (OOS 표본부족)" : "";
    console.log(`${c.label}\n    IS ${fmt(c.isStats)} | OOS ${fmt(c.oosStats)}${ok}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
