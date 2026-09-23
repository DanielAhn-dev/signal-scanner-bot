/**
 * 청산 규칙 백테스트: 과거 진입 신호에 서로 다른 청산 규칙을 적용해 성과를 비교한다.
 *
 * 실매매 표본(오염구간 제외 시 매도 수 건)으로는 청산 파라미터를 튜닝할 수 없어서,
 * pullback_signals(기본: entry_grade A)의 과거 신호를 진입으로 삼고 stock_daily 일봉으로
 * 자동매매 일일점검과 같은 청산 판단(종가 기준)을 재현한다.
 *
 * 비교 규칙
 *   legacy  : ATR 손절 상한 12% · 익절 ≥ 손절+1.5%p · 트레일링(+5% 이상에서 고점 -10%)
 *   rr      : legacy + 손익비 1.5 강제 (익절 상한 18%)
 *   capped  : rr + ATR 손절 확장 상한을 프로필 손절의 2.5배로 제한
 *   lock    : legacy + 수익잠금 트레일링
 *   lock+rr : lock + 손익비 1.5 강제
 *   lock+cap: lock + ATR 손절 확장 상한 (손익비 강제 없음)
 *   new     : capped + lock
 *   → 2026-09 결과: lock+cap 채택(운영 반영), 손익비 강제(rr)는 전 조합에서 악화돼 미채택
 *
 * 사용 예
 *   pnpm dlx tsx scripts/backtest_exit_params.ts --from=2026-03-01 --stop=4 --tp=8
 *   pnpm dlx tsx scripts/backtest_exit_params.ts --grid=true --maxHold=20
 *   옵션: --grade=A|B  --to=YYYY-MM-DD  --limit=3000  --costPct=0.45  --rules=legacy,lock

 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { calcATR } from "../src/indicators/atr";
import { planAutoTradeExit } from "../src/services/virtualAutoTradePositionStrategy";
import {
  evaluateCloseFreshness,
  resolveProfileStopCapPct,
  resolveProfitLockTrailingStop,
  resolveVolatilityAdjustedStopPct,
} from "../src/services/virtualAutoTradeSelection";

type Bar = { date: string; open: number; high: number; low: number; close: number; volume: number };
type Signal = { code: string; tradeDate: string };
type RuleName = "legacy" | "rr" | "capped" | "lock" | "lock+rr" | "lock+cap" | "new";
type TradeResult = { pnlPct: number; holdDays: number; exitReason: string; mfePct: number };

const ALL_RULES: RuleName[] = ["legacy", "rr", "capped", "lock", "lock+rr", "lock+cap", "new"];
const usesCap = (rule: RuleName) => rule === "capped" || rule === "lock+cap" || rule === "new";
const usesRr = (rule: RuleName) => rule === "rr" || rule === "capped" || rule === "lock+rr" || rule === "new";
const usesLock = (rule: RuleName) =>
  rule === "lock" || rule === "lock+rr" || rule === "lock+cap" || rule === "new";

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((x) => x.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function numArg(name: string, fallback: number): number {
  const n = Number(arg(name, String(fallback)));
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * 손익비 강제(연구용 비교 규칙). 익절폭 < 손절폭 × minRatio이면 익절을 올리고(상한 18%),
 * 그래도 부족하면 손절을 좁힌다. 운영 로직에는 채택하지 않았다(백테스트상 성과 악화).
 */
function enforceMinRewardRisk(input: { takeProfitPct: number; stopLossPct: number }, minRatio = 1.5, maxTp = 18) {
  let takeProfitPct = input.takeProfitPct;
  let stopLossPct = input.stopLossPct;
  if (takeProfitPct < stopLossPct * minRatio) takeProfitPct = Math.min(maxTp, stopLossPct * minRatio);
  if (takeProfitPct < stopLossPct * minRatio) stopLossPct = takeProfitPct / minRatio;
  return { takeProfitPct, stopLossPct };
}

/** resolveAdaptiveExitThreshold(virtualAutoTradeService.ts)의 신호 보정을 뺀 최종 클램프 단계 */
function resolveThresholds(rule: RuleName, baseTp: number, baseStop: number, atrPct: number | null) {
  const stop = resolveVolatilityAdjustedStopPct({
    baseStopLossPct: baseStop,
    atrPct,
    maxStopPct: usesCap(rule) ? resolveProfileStopCapPct(baseStop) : undefined,
  });
  const tp = clamp(baseTp, 3, 14);
  const sl = clamp(stop, 1.5, 12);
  if (usesRr(rule)) return enforceMinRewardRisk({ takeProfitPct: tp, stopLossPct: sl });
  return { takeProfitPct: tp < sl + 1.5 ? Math.min(14, sl + 1.5) : tp, stopLossPct: sl };
}

function simulate(
  rule: RuleName,
  bars: Bar[],
  entryIdx: number,
  opts: { baseTp: number; baseStop: number; maxHold: number; costPct: number }
): { result: TradeResult; exitIdx: number } | null {
  const entry = bars[entryIdx].open > 0 ? bars[entryIdx].open : bars[entryIdx].close;
  if (!(entry > 0)) return null;
  const history = bars.slice(Math.max(0, entryIdx - 40), entryIdx);
  const atr = calcATR(history.map((b) => ({ ...b, code: "", amount: 0 })));
  const { takeProfitPct, stopLossPct } = resolveThresholds(rule, opts.baseTp, opts.baseStop, atr?.atrPct ?? null);

  const UNITS = 100;
  let units = UNITS;
  let tranchesDone = 0;
  let peak = entry;
  let realized = 0; // Σ(청산 비중 × 수익률%)
  let mfePct = 0;
  let lastReason = "time-exit";

  const lastIdx = Math.min(bars.length - 1, entryIdx + opts.maxHold);
  for (let i = entryIdx; i <= lastIdx; i += 1) {
    const close = bars[i].close;
    if (!(close > 0)) continue;
    peak = Math.max(peak, close);
    const pnlPct = ((close - entry) / entry) * 100;
    mfePct = Math.max(mfePct, ((bars[i].high > 0 ? bars[i].high : close) - entry) / entry * 100);

    const trailingBreached = usesLock(rule)
      ? resolveProfitLockTrailingStop({ buyPrice: entry, peakPrice: peak, currentPrice: close }).breached
      : pnlPct >= 5 && close < peak * 0.9;

    let sellUnits = 0;
    let reason = "";
    if (trailingBreached) {
      sellUnits = units;
      reason = "trailing";
    } else {
      const plan = planAutoTradeExit({
        quantity: units,
        pnlPct,
        takeProfitPct,
        stopLossPct,
        takeProfitSplitCount: 2,
        takeProfitTranchesDone: tranchesDone,
      });
      if (plan.action !== "HOLD") {
        sellUnits = plan.quantityToSell;
        reason = plan.reason;
        tranchesDone = plan.nextTakeProfitTranchesDone;
      }
    }
    if (i === lastIdx && sellUnits < units) {
      sellUnits = units;
      reason = reason || "time-exit";
    }
    if (sellUnits > 0) {
      realized += (sellUnits / UNITS) * (pnlPct - opts.costPct);
      units -= sellUnits;
      lastReason = reason;
    }
    if (units <= 0) {
      return {
        result: { pnlPct: realized, holdDays: i - entryIdx + 1, exitReason: lastReason, mfePct },
        exitIdx: i,
      };
    }
  }
  return null; // 데이터 부족으로 시뮬레이션 미완료
}

function summarize(results: TradeResult[]) {
  const n = results.length;
  if (!n) return null;
  const wins = results.filter((r) => r.pnlPct > 0);
  const losses = results.filter((r) => r.pnlPct <= 0);
  const grossWin = wins.reduce((s, r) => s + r.pnlPct, 0);
  const grossLoss = Math.abs(losses.reduce((s, r) => s + r.pnlPct, 0));
  const avg = results.reduce((s, r) => s + r.pnlPct, 0) / n;
  const avgHold = results.reduce((s, r) => s + r.holdDays, 0) / n;
  // 고점포착률: 보유 중 최대 수익(MFE) 합 대비 실현 수익 합 (승리 거래 기준)
  const winMfe = wins.reduce((s, r) => s + Math.max(0, r.mfePct), 0);
  const capture = winMfe > 0 ? grossWin / winMfe : 0;
  const reasons = new Map<string, number>();
  for (const r of results) reasons.set(r.exitReason, (reasons.get(r.exitReason) ?? 0) + 1);
  return {
    n,
    winRate: (wins.length / n) * 100,
    avgPnl: avg,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : Infinity,
    avgHold,
    capture: capture * 100,
    reasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", "),
  };
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required");
  const supabase = createClient(url, key);

  const from = arg("from", "2026-03-01");
  const to = arg("to", new Date().toISOString().slice(0, 10));
  const grade = arg("grade", "A");
  const limit = numArg("limit", 20000);
  const maxHold = numArg("maxHold", 20);
  const costPct = numArg("costPct", 0.45); // 슬리피지 왕복 0.2 + 수수료 0.03 + 거래세 0.18 + 여유
  const grid = arg("grid", "false") === "true";
  const RULES = arg("rules", ALL_RULES.join(","))
    .split(",")
    .map((r) => r.trim())
    .filter((r): r is RuleName => (ALL_RULES as string[]).includes(r));
  const paramSets = grid
    ? [2, 3, 4, 5].flatMap((stop) => [6, 8, 10, 12].map((tp) => ({ baseStop: stop, baseTp: tp })))
    : [{ baseStop: numArg("stop", 4), baseTp: numArg("tp", 8) }];

  // 1) 진입 신호
  const signals: Signal[] = [];
  for (let offset = 0; signals.length < limit; offset += 1000) {
    const { data, error } = await supabase
      .from("pullback_signals")
      .select("code, trade_date")
      .eq("entry_grade", grade)
      .gte("trade_date", from)
      .lte("trade_date", to)
      .order("trade_date", { ascending: true })
      .range(offset, offset + 999);
    if (error) throw error;
    for (const row of data ?? []) signals.push({ code: String(row.code), tradeDate: String(row.trade_date) });
    if (!data || data.length < 1000) break;
  }
  signals.splice(limit);
  const codes = [...new Set(signals.map((s) => s.code))];
  console.log(`[backtest-exit] signals=${signals.length} codes=${codes.length} grade=${grade} ${from}~${to} maxHold=${maxHold} cost=${costPct}%`);

  // 2) 일봉
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

  // 3) 시뮬레이션
  for (const params of paramSets) {
    const resultsByRule = new Map<RuleName, TradeResult[]>(RULES.map((r) => [r, []]));
    let droppedFrozen = 0;
    for (const rule of RULES) {
      const busyUntil = new Map<string, string>(); // 종목당 동시 1포지션
      for (const signal of signals) {
        const bars = barsByCode.get(signal.code);
        if (!bars?.length) continue;
        if ((busyUntil.get(signal.code) ?? "") >= signal.tradeDate) continue;
        const entryIdx = bars.findIndex((b) => b.date > signal.tradeDate);
        if (entryIdx < 20) continue;
        // 종가 동결(2026-06~07 파이프라인 사고) 구간이 보유기간에 걸리면 제외
        const window = bars.slice(entryIdx, entryIdx + maxHold + 1);
        let frozen = false;
        for (let k = 4; k <= window.length && !frozen; k += 1) {
          const slice = window.slice(k - 4, k).reverse();
          frozen = !evaluateCloseFreshness(slice, { nowMs: Date.parse(slice[0].date) }).ok;
        }
        if (frozen) {
          if (rule === RULES[0]) droppedFrozen += 1;
          continue;
        }
        const sim = simulate(rule, bars, entryIdx, { ...params, maxHold, costPct });
        if (!sim) continue;
        resultsByRule.get(rule)!.push(sim.result);
        busyUntil.set(signal.code, bars[sim.exitIdx].date);
      }
    }

    console.log(`\n=== 기본 손절 ${params.baseStop}% · 기본 익절 ${params.baseTp}% (동결구간 제외 ${droppedFrozen}건) ===`);
    for (const rule of RULES) {
      const s = summarize(resultsByRule.get(rule)!);
      if (!s) {
        console.log(`${rule.padEnd(8)} 표본 없음`);
        continue;
      }
      console.log(
        `${rule.padEnd(8)} n=${String(s.n).padStart(4)} 승률 ${s.winRate.toFixed(1).padStart(5)}% · 평균 ${s.avgPnl >= 0 ? "+" : ""}${s.avgPnl.toFixed(2)}% · PF ${s.profitFactor.toFixed(2)} · 보유 ${s.avgHold.toFixed(1)}일 · 고점포착 ${s.capture.toFixed(0)}%`
      );
      if (!grid) console.log(`         청산사유: ${s.reasons}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
