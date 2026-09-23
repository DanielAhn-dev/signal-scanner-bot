/**
 * 구조 목표(박스 상단·박스 목표·직전 고점대) 익절 vs 현재 % 익절 백테스트
 * + 차트 "매집" 마커(세력선 돌파 + 거래량 1.5배) 진입 검증.
 *
 * 진입 집합
 *   scores : 엔진 팩터가 있는 scores 행(engine/engine_pit/하이브리드), 같은 종목 --cooldown 세션 간격
 *   accum  : web/src/components/CandleChart.tsx의 매집 마커와 같은 조건
 *            (누적 VWAP 세력선을 종가가 아래→위로 돌파 + 당일 거래량 ≥ 직전 20일 평균 × 1.5)
 * 청산 규칙 (모두 운영 규칙 lock+cap의 손절·수익잠금을 공유, 익절 목표만 다름)
 *   prod        : 운영과 동일 (% 목표 하나, 1차 익절 후 다음 점검에서 목표 위면 나머지도 매도)
 *   prod-ladder : 2차 분할 목표를 1차의 2배로
 *   struct      : 1차 = 첫 구조 레벨, 2차 = 다음 구조 레벨(없으면 1차의 2배)
 *   struct-skip : 박스 상단은 건너뛰고 1차 = 두 번째 레벨, 2차 = 세 번째 레벨
 * 구조 레벨: 엔진 stable_box_high/low가 있으면 그것, 없으면 직전 20봉 박스. 직전 고점대 = 직전 120봉 최고가.
 *
 * 사용 예
 *   pnpm dlx tsx scripts/backtest_structural_targets.ts
 *   pnpm dlx tsx scripts/backtest_structural_targets.ts --from=2026-06-15 --maxHold=30 --entries=accum
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { evaluateAutoTradeSignalGate } from "../src/services/virtualAutoTradeSignalGate";
import { evaluateCloseFreshness } from "../src/services/virtualAutoTradeSelection";
import { resolveStructuralTargets, type StructuralTargetLevel } from "../src/services/structuralTargets";
import { PRODUCTION_RULE, simulateExit, summarizeTrades, type Bar, type TradeResult } from "./lib/exitSimulation";

type Entry = { code: string; signalIdx: number; set: "scores" | "scores-gate" | "accum"; factors: Record<string, unknown> | null };
type ExitName = "prod" | "prod-ladder" | "struct" | "struct-skip";
const EXITS: ExitName[] = ["prod", "prod-ladder", "struct", "struct-skip"];

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((x) => x.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function numArg(name: string, fallback: number): number {
  const n = Number(arg(name, String(fallback)));
  return Number.isFinite(n) ? n : fallback;
}

/** CandleChart.computeForceLine과 같은 누적 VWAP(전형가×거래량) — 로드한 첫 봉부터 누적 */
function forceLineCrossIdx(bars: Bar[]): number[] {
  const out: number[] = [];
  let cumPv = 0;
  let cumVol = 0;
  let prevAbove: boolean | null = null;
  for (let i = 0; i < bars.length; i += 1) {
    const b = bars[i];
    const vol = b.volume > 0 ? b.volume : 1;
    cumPv += ((b.high + b.low + b.close) / 3) * vol;
    cumVol += vol;
    const above = b.close >= cumPv / cumVol;
    if (prevAbove === false && above && i >= 20) {
      const avgVol = bars.slice(i - 20, i).reduce((s, x) => s + x.volume, 0) / 20;
      if (b.volume >= avgVol * 1.5) out.push(i);
    }
    prevAbove = above;
  }
  return out;
}

function levelsFor(bars: Bar[], signalIdx: number, entryPrice: number, factors: Record<string, unknown> | null): StructuralTargetLevel[] {
  const boxHighF = Number(factors?.stable_box_high);
  const boxLowF = Number(factors?.stable_box_low);
  const base = bars.slice(Math.max(0, signalIdx - 19), signalIdx + 1);
  const boxHigh = boxHighF > 0 ? boxHighF : Math.max(...base.map((b) => b.high));
  const boxLow = boxLowF > 0 ? boxLowF : Math.min(...base.map((b) => b.low));
  const prior = bars.slice(Math.max(0, signalIdx - 119), signalIdx + 1);
  const priorHigh = prior.length ? Math.max(...prior.map((b) => b.high)) : null;
  return resolveStructuralTargets({ entryPrice, boxHigh, boxLow, priorHigh });
}

function ladderFor(exit: ExitName, levels: StructuralTargetLevel[]): { pct?: number[]; mult?: number[] } {
  if (exit === "prod") return {};
  if (exit === "prod-ladder") return { mult: [1, 2] };
  if (!levels.length) return {}; // 위쪽 구조 레벨이 없으면 운영과 동일
  const p = levels.map((l) => l.pct);
  if (exit === "struct") return { pct: [p[0], p[1] ?? p[0] * 2] };
  const first = p[1] ?? p[0];
  return { pct: [first, p[2] ?? first * 1.5] };
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required");
  const supabase = createClient(url, key);

  const from = arg("from", "2026-06-15");
  const to = arg("to", new Date().toISOString().slice(0, 10));
  const maxHold = numArg("maxHold", 30);
  const baseStop = numArg("stop", 4);
  const baseTp = numArg("tp", 8);
  const costPct = numArg("costPct", 0.45);
  const cooldown = numArg("cooldown", 5);
  const entrySets = arg("entries", "scores,scores-gate,accum").split(",");

  // 1) 엔진 팩터 scores
  const factorsByKey = new Map<string, { score: number; factors: Record<string, unknown> }>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("scores")
      .select("code, asof, score, factors")
      .gte("asof", from)
      .lte("asof", to)
      .order("asof", { ascending: true })
      .order("code", { ascending: true })
      .range(offset, offset + 999);
    if (error) throw error;
    for (const r of data ?? []) {
      const f = (r.factors ?? {}) as Record<string, unknown>;
      const src = String(f.score_source ?? "");
      if (src !== "engine" && src !== "engine_pit" && src !== "legacy_score+engine_factors") continue;
      factorsByKey.set(`${r.code}|${String(r.asof).slice(0, 10)}`, { score: Number(r.score) || 0, factors: f });
    }
    if (!data || data.length < 1000) break;
  }
  const codes = [...new Set([...factorsByKey.keys()].map((k) => k.split("|")[0]))];
  console.log(`[struct-bt] engine-factor rows=${factorsByKey.size} codes=${codes.length} ${from}~${to} maxHold=${maxHold}`);

  // 2) 일봉 (세력선 누적·직전 고점 계산용으로 전체 이력)
  const barsByCode = new Map<string, Bar[]>();
  for (let i = 0; i < codes.length; i += 8) {
    await Promise.all(
      codes.slice(i, i + 8).map(async (code) => {
        const { data } = await supabase
          .from("stock_daily")
          .select("date, open, high, low, close, volume")
          .eq("ticker", code)
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

  // 3) 진입 집합
  const entries: Entry[] = [];
  for (const code of codes) {
    const bars = barsByCode.get(code) ?? [];
    if (bars.length < 150) continue;
    let lastScoresIdx = -Infinity;
    let lastGateIdx = -Infinity;
    for (let i = 120; i < bars.length - 1; i += 1) {
      const date = bars[i].date;
      if (date < from || date > to) continue;
      const row = factorsByKey.get(`${code}|${date}`);
      if (!row) continue;
      if (i - lastScoresIdx >= cooldown) {
        entries.push({ code, signalIdx: i, set: "scores", factors: row.factors });
        lastScoresIdx = i;
      }
      const gate = evaluateAutoTradeSignalGate({ currentPrice: bars[i].close, score: row.score, factors: row.factors, minTrustScore: 62 });
      if (gate.passed && i - lastGateIdx >= cooldown) {
        entries.push({ code, signalIdx: i, set: "scores-gate", factors: row.factors });
        lastGateIdx = i;
      }
    }
    for (const i of forceLineCrossIdx(bars)) {
      const date = bars[i].date;
      if (date < from || date > to || i >= bars.length - 1) continue;
      entries.push({ code, signalIdx: i, set: "accum", factors: factorsByKey.get(`${code}|${date}`)?.factors ?? null });
    }
  }

  // 4) 시뮬레이션
  for (const set of entrySets) {
    const setEntries = entries.filter((e) => e.set === set);
    const results = new Map<ExitName, TradeResult[]>(EXITS.map((x) => [x, []]));
    const hit = [0, 0, 0];
    const levelCount = [0, 0, 0];
    let frozen = 0;
    let used = 0;
    for (const e of setEntries) {
      const bars = barsByCode.get(e.code)!;
      const entryIdx = e.signalIdx + 1;
      const window = bars.slice(entryIdx, entryIdx + maxHold + 1);
      let isFrozen = false;
      for (let k = 4; k <= window.length && !isFrozen; k += 1) {
        const slice = window.slice(k - 4, k).reverse();
        isFrozen = !evaluateCloseFreshness(slice, { nowMs: Date.parse(slice[0].date) }).ok;
      }
      if (isFrozen) {
        frozen += 1;
        continue;
      }
      const entryPrice = bars[entryIdx].open > 0 ? bars[entryIdx].open : bars[entryIdx].close;
      const levels = levelsFor(bars, e.signalIdx, entryPrice, e.factors);
      const maxHigh = Math.max(...window.map((b) => b.high));
      levels.forEach((l, idx) => {
        levelCount[idx] += 1;
        if (maxHigh >= l.price) hit[idx] += 1;
      });
      let complete = true;
      const perExit: Array<[ExitName, TradeResult]> = [];
      for (const exit of EXITS) {
        const ladder = ladderFor(exit, levels);
        const sim = simulateExit(PRODUCTION_RULE, bars, entryIdx, {
          baseTp,
          baseStop,
          maxHold,
          costPct,
          takeProfitLadderPct: ladder.pct ?? null,
          takeProfitLadderMultipliers: ladder.mult ?? null,
        });
        if (!sim) {
          complete = false;
          break;
        }
        perExit.push([exit, sim.result]);
      }
      if (!complete) continue; // 보유기간이 끝나지 않은 최근 진입은 모든 규칙에서 제외(같은 표본 비교)
      used += 1;
      for (const [exit, r] of perExit) results.get(exit)!.push(r);
    }
    console.log(`\n=== 진입: ${set} (표본 ${used}, 동결구간 제외 ${frozen}) ===`);
    console.log(
      `구조 레벨 도달률(보유기간 내 고가 기준): ${["1차", "2차", "3차"]
        .map((label, i) => `${label} ${levelCount[i] ? ((hit[i] / levelCount[i]) * 100).toFixed(0) : "-"}% (n=${levelCount[i]})`)
        .join(" · ")}`
    );
    for (const exit of EXITS) {
      const s = summarizeTrades(results.get(exit)!);
      if (!s) continue;
      console.log(
        `${exit.padEnd(12)} n=${String(s.n).padStart(4)} 승률 ${s.winRate.toFixed(1).padStart(5)}% · 평균 ${s.avgPnl >= 0 ? "+" : ""}${s.avgPnl.toFixed(2)}% · PF ${s.profitFactor.toFixed(2)} · 보유 ${s.avgHold.toFixed(1)}일 · 고점포착 ${s.capture.toFixed(0)}%`
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
