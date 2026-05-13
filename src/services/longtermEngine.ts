export type LongtermScoreInput = {
  pbr: number | null;
  per: number | null;
  roe: number | null;
  peg: number | null;
  revQoq: number | null;
  opQoq: number | null;
  revAcceleration: number | null;
  opAcceleration: number | null;
  smartMoneyRatioPct: number | null;
  sectorScore: number | null;
};

export type LongtermScoreBreakdown = {
  valueScore: number;
  momentumScore: number;
  smartMoneyScore: number;
  sectorScore: number;
  totalScore: number;
};

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function lin(v: number, x0: number, x1: number, y0: number, y1: number): number {
  if (!Number.isFinite(v)) return y0;
  if (v <= x0) return y0;
  if (v >= x1) return y1;
  return y0 + ((v - x0) / (x1 - x0)) * (y1 - y0);
}

function calcValueScore(
  pbr: number | null,
  per: number | null,
  roe: number | null,
  peg: number | null
): number {
  let score = 0;

  const pbrNum = Number(pbr ?? NaN);
  if (Number.isFinite(pbrNum)) {
    if (pbrNum <= 0.8) score += 15;
    else if (pbrNum <= 1.2) score += 12;
    else if (pbrNum <= 1.6) score += 8;
    else if (pbrNum < 2.0) score += 4;
  }

  const roeNum = Number(roe ?? NaN);
  if (Number.isFinite(roeNum)) {
    if (roeNum >= 20) score += 10;
    else if (roeNum >= 15) score += 8;
    else if (roeNum >= 12) score += 6;
    else if (roeNum >= 8) score += 4;
  }

  const perNum = Number(per ?? NaN);
  if (Number.isFinite(perNum) && perNum > 0) {
    if (perNum <= 8) score += 5;
    else if (perNum <= 12) score += 4;
    else if (perNum <= 18) score += 2;
    else score += 1;
  }

  // PEG 최적화 메뉴(발굴)에서는 PEG가 순위에 직접 영향하도록 가치 점수에 반영한다.
  const pegNum = Number(peg ?? NaN);
  if (Number.isFinite(pegNum) && pegNum > 0) {
    if (pegNum <= 0.8) score += 6;
    else if (pegNum <= 1.2) score += 5;
    else if (pegNum <= 1.8) score += 3;
    else if (pegNum <= 2.5) score += 1;
    else if (pegNum >= 3.5) score -= 3;
  }

  return clamp(score, 0, 30);
}

function calcMomentumScore(
  revQoq: number | null,
  opQoq: number | null,
  revAcceleration: number | null,
  opAcceleration: number | null
): number {
  const rev = Number(revQoq ?? NaN);
  const op = Number(opQoq ?? NaN);
  const revAcc = Number(revAcceleration ?? NaN);
  const opAcc = Number(opAcceleration ?? NaN);

  let score = 0;
  if (Number.isFinite(rev)) score += lin(rev, -5, 35, 0, 16);
  if (Number.isFinite(op)) score += lin(op, -5, 45, 0, 16);

  const accVals = [revAcc, opAcc].filter(Number.isFinite) as number[];
  if (accVals.length) {
    const accAvg = accVals.reduce((a, b) => a + b, 0) / accVals.length;
    score += lin(accAvg, -10, 20, 0, 8);
  }

  return clamp(score, 0, 40);
}

function calcSmartMoneyScore(smartMoneyRatioPct: number | null): number {
  const ratio = Number(smartMoneyRatioPct ?? NaN);
  if (!Number.isFinite(ratio)) return 0;
  return clamp(lin(ratio, -1.0, 2.0, 0, 20), 0, 20);
}

function calcSectorScore(sectorScoreRaw: number | null): number {
  const score = Number(sectorScoreRaw ?? NaN);
  if (!Number.isFinite(score)) return 0;
  return clamp(lin(score, 20, 80, 0, 10), 0, 10);
}

export function calculateLongtermScore(input: LongtermScoreInput): LongtermScoreBreakdown {
  const valueScore = calcValueScore(input.pbr, input.per, input.roe, input.peg);
  const momentumScore = calcMomentumScore(
    input.revQoq,
    input.opQoq,
    input.revAcceleration,
    input.opAcceleration
  );
  const smartMoneyScore = calcSmartMoneyScore(input.smartMoneyRatioPct);
  const sectorScore = calcSectorScore(input.sectorScore);

  const totalScore = clamp(
    valueScore + momentumScore + smartMoneyScore + sectorScore,
    0,
    100
  );

  return {
    valueScore: Math.round(valueScore * 10) / 10,
    momentumScore: Math.round(momentumScore * 10) / 10,
    smartMoneyScore: Math.round(smartMoneyScore * 10) / 10,
    sectorScore: Math.round(sectorScore * 10) / 10,
    totalScore: Math.round(totalScore * 10) / 10,
  };
}
