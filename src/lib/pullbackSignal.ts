/**
 * 눌림목 신호 계산 — 밤 배치(scripts/batch_modules/signals.py compute_pullback_signal)와 같은 정의.
 *
 * 장중 갱신(scripts/intraday_pullback_signals.ts)이 예전엔 별도의 "단순 버전"을 써서 같은 pullback_signals 표에
 * 척도가 다른 값을 덮어썼다(entry_score 밤 0~4 vs 장중 50~90, 등급 기준·경고 항목도 달랐음). 게다가 이력 조회가
 * 100종목당 1000행 상한에 걸려 종목마다 최근 10일치만 받아 20·50일 평균이 현재가로 대체됐고, RSI는 잘라낸 배열과
 * 원래 배열의 인덱스를 섞어 엉뚱한 날짜끼리 비교했다. 그 값이 14:30~밤 배치 사이 자동매매 후보 순위에 쓰였다.
 * 같은 표에 쓰는 값은 같은 함수로 만든다. Python 쪽을 바꾸면 여기도 바꾸고 tests/pullbackSignal.test.ts 기대값을 갱신한다.
 */

export type PullbackBar = { date: string; high: number; low: number; close: number; volume: number };

export type PullbackSignalValues = {
  entry_grade: "A" | "B" | "C";
  entry_score: number;
  trend_grade: "A" | "B" | "C";
  dist_grade: "A" | "B" | "C";
  dist_pct: number;
  pivot_grade: "A" | "B" | "C";
  vol_atr_grade: "A" | "B" | "C";
  warn_grade: "SAFE" | "WATCH" | "WARN" | "SELL";
  warn_score: number;
  warn_overheat: boolean;
  warn_vol_spike: boolean;
  warn_atr_spike: boolean;
  warn_rsi_ob: boolean;
  warn_ma_break: boolean;
  warn_dead_cross: boolean;
  ma21: number;
  ma50: number;
};

/** 밤 배치가 신호를 내는 최소 이력 */
export const PULLBACK_MIN_BARS = 21;

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** pandas ewm(alpha=1/period, min_periods=period, adjust=False) 기반 RSI의 마지막 값. 계산 불가면 null */
export function wilderRsiLast(closes: number[], period = 14): number | null {
  if (closes.length < period) return null;
  let avgGain = 0;
  let avgLoss = 0;
  const alpha = 1 / period;
  // diff()의 첫 값은 NaN → fillna(0) 이라 0부터 시작한다 (Python과 같게)
  for (let i = 0; i < closes.length; i += 1) {
    const d = i === 0 ? 0 : closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    if (i === 0) {
      avgGain = g;
      avgLoss = l;
    } else {
      avgGain = alpha * g + (1 - alpha) * avgGain;
      avgLoss = alpha * l + (1 - alpha) * avgLoss;
    }
  }
  if (avgLoss === 0) return avgGain === 0 ? null : 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function trueRange(bars: PullbackBar[], i: number): number {
  const h = bars[i].high;
  const l = bars[i].low;
  const pc = bars[i - 1].close;
  return Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
}

export function computePullbackSignal(bars: PullbackBar[]): PullbackSignalValues | null {
  const n = bars.length;
  if (n < PULLBACK_MIN_BARS) return null;
  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const volumes = bars.map((b) => b.volume);

  const ma21 = mean(closes.slice(-21));
  const ma50 = n >= 50 ? mean(closes.slice(-50)) : ma21;
  const c = closes[n - 1];
  const dist = ma21 > 0 ? ((c - ma21) / ma21) * 100 : 0;

  const pivotLow10 = Math.min(...lows.slice(-10));
  const high5 = Math.max(...highs.slice(-5));
  const volSma20 = mean(volumes.slice(-20));

  const trs: number[] = [];
  for (let i = Math.max(1, n - 14); i < n; i += 1) trs.push(trueRange(bars, i));
  const atr14 = trs.length ? mean(trs) : 0;

  let atrSma20 = atr14;
  if (n >= 34) {
    const series: number[] = [];
    for (let j = Math.max(14, n - 20); j < n; j += 1) {
      const local: number[] = [];
      for (let k = Math.max(1, j - 13); k <= j; k += 1) local.push(trueRange(bars, k));
      series.push(mean(local));
    }
    atrSma20 = mean(series);
  }

  const rsi14 = wilderRsiLast(closes, 14) ?? 50;

  const trendAligned = ma21 > ma50 && c > ma21;
  const trendGrade = trendAligned ? "A" : ma21 > ma50 ? "B" : "C";
  const distOk = dist > -3 && dist < 5;
  const distGrade = dist > -1 && dist < 3 ? "A" : distOk ? "B" : "C";
  const nearPivot = c <= pivotLow10 * 1.03;
  const belowHigh = c < high5;
  const pivotGrade = nearPivot && belowHigh ? "A" : nearPivot || belowHigh ? "B" : "C";
  const volDry = volumes[n - 1] < volSma20;
  const atrOk = atr14 < atrSma20;
  const volAtrGrade = volDry && atrOk ? "A" : volDry || atrOk ? "B" : "C";

  const rsiEntryOk = rsi14 >= 40 && rsi14 <= 60;
  const rsiEntryOkB = rsi14 >= 35 && rsi14 <= 68;
  const entryScore =
    (trendAligned ? 1 : 0) + (distOk ? 1 : 0) + (nearPivot && belowHigh ? 1 : 0) + (volDry && atrOk ? 1 : 0);
  const base = entryScore >= 3 ? "A" : entryScore === 2 ? "B" : "C";
  let entryGrade: "A" | "B" | "C" = base;
  if (base === "B" && rsiEntryOk) entryGrade = "A";
  else if (base === "C" && rsiEntryOkB && entryScore === 1) entryGrade = "B";
  else if (base === "A" && rsi14 > 72) entryGrade = "B";

  const warnOverheat = dist > 7;
  const warnVolSpike = volumes[n - 1] > volSma20 * 2;
  const warnAtrSpike = atr14 > atrSma20 * 1.5;
  const warnRsiOb = rsi14 > 70 || rsi14 < 30;
  const warnMaBreak = c < ma21;
  const warnDeadCross = ma21 < ma50;
  const warnScore = [warnOverheat, warnVolSpike, warnAtrSpike, warnRsiOb, warnMaBreak, warnDeadCross].filter(Boolean).length;
  const warnGrade = warnScore >= 3 ? "SELL" : warnScore === 2 ? "WARN" : warnScore === 1 ? "WATCH" : "SAFE";

  return {
    entry_grade: entryGrade,
    entry_score: entryScore,
    trend_grade: trendGrade,
    dist_grade: distGrade,
    dist_pct: Math.round(dist * 100) / 100,
    pivot_grade: pivotGrade,
    vol_atr_grade: volAtrGrade,
    warn_grade: warnGrade,
    warn_score: warnScore,
    warn_overheat: warnOverheat,
    warn_vol_spike: warnVolSpike,
    warn_atr_spike: warnAtrSpike,
    warn_rsi_ob: warnRsiOb,
    warn_ma_break: warnMaBreak,
    warn_dead_cross: warnDeadCross,
    ma21: Math.round(ma21),
    ma50: Math.round(ma50),
  };
}

/**
 * 장중 현재가로 오늘 봉을 만든다. 실시간 조회엔 오늘 고가·저가가 없어 현재가 하나로 둔다
 * (예전엔 어제 고가·저가를 오늘 봉에 복사해 ATR·지지선 판정이 어제 값으로 계산됐다).
 * 거래량은 장중 누적치라 마감 전엔 작게 잡힌다 — 장중 신호의 거래량 건조(vol_dry) 판정은 마감 후 값보다 느슨하다.
 */
export function withIntradayBar(
  history: PullbackBar[],
  tradeDate: string,
  price: number | null | undefined,
  volume: number | null | undefined
): PullbackBar[] {
  if (!history.length || !price || !Number.isFinite(price) || price <= 0) return history;
  const bar: PullbackBar = {
    date: tradeDate,
    high: price,
    low: price,
    close: price,
    volume: volume != null && Number.isFinite(volume) && volume >= 0 ? volume : 0,
  };
  const base = history[history.length - 1].date === tradeDate ? history.slice(0, -1) : history;
  return [...base, bar];
}
