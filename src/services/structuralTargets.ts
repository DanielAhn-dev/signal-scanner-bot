/**
 * 가격 구조 기반 목표가(익절 참고 레벨).
 *
 * % 고정 목표(예: +8~14%)는 종목의 저항 위치와 무관하다. 매집 스크립트들이 보여주는 익절 포인트처럼
 * "매도 물량이 나오기 쉬운 자리"를 구조로 계산한다. 예측값이 아니라 도달 시 매도 압력이 커지는 참고 레벨이다.
 *   - 박스 상단: 엔진 stable_box_high (매집 박스의 윗변 = 첫 저항)
 *   - 박스 목표: 박스 상단 + 박스 높이 (차트 분석의 측정 목표, measured move)
 *   - 직전 고점대: 최근 N세션 최고가 (이전 고점에 물린 매물)
 *
 * 표시 전용. scripts/backtest_structural_targets.ts(2026-06~09, 엔진 팩터 진입 약 2.9천건) 결과
 * 20~40세션 내 도달률이 1차 21~41%, 2차 2~13%, 3차 0~2%였고, 이 레벨로 익절해도 % 목표보다
 * 성과가 낫지 않아 자동 매도 규칙에는 쓰지 않는다.
 */

export type StructuralTargetLevel = {
  kind: "box-high" | "measured-move" | "prior-high";
  label: string;
  price: number;
  pct: number;
};

/** 진입가 대비 이 비율 이상 위에 있는 레벨만 목표로 본다 (바로 위 레벨은 의미 없음) */
const MIN_GAP_PCT = 3;
/** 서로 이 비율 이내로 붙은 레벨은 하나로 합친다 (낮은 쪽 유지) */
const MERGE_GAP_PCT = 3;

function positive(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function resolveStructuralTargets(input: {
  entryPrice: number;
  boxHigh?: number | null;
  boxLow?: number | null;
  priorHigh?: number | null;
  maxLevels?: number;
}): StructuralTargetLevel[] {
  const entry = positive(input.entryPrice);
  if (!entry) return [];
  const boxHigh = positive(input.boxHigh);
  const boxLow = positive(input.boxLow);
  const priorHigh = positive(input.priorHigh);

  const candidates: Array<Omit<StructuralTargetLevel, "pct">> = [];
  if (boxHigh) candidates.push({ kind: "box-high", label: "박스 상단", price: boxHigh });
  if (boxHigh && boxLow && boxHigh > boxLow) {
    candidates.push({ kind: "measured-move", label: "박스 목표", price: boxHigh + (boxHigh - boxLow) });
  }
  if (priorHigh) candidates.push({ kind: "prior-high", label: "직전 고점대", price: priorHigh });

  const above = candidates
    .map((level) => ({ ...level, price: Math.round(level.price), pct: ((level.price - entry) / entry) * 100 }))
    .filter((level) => level.pct >= MIN_GAP_PCT)
    .sort((a, b) => a.price - b.price);

  const merged: StructuralTargetLevel[] = [];
  for (const level of above) {
    const last = merged[merged.length - 1];
    if (last && ((level.price - last.price) / last.price) * 100 < MERGE_GAP_PCT) continue;
    merged.push({ ...level, pct: Number(level.pct.toFixed(1)) });
  }
  return merged.slice(0, Math.max(1, input.maxLevels ?? 3));
}
