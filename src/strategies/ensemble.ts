export type Signal = {
  id: string; // instrument id, e.g., ticker
  score: number; // raw score from strategy (can be negative)
  timestamp?: string; // ISO date
  strategy?: string;
};

export function minMaxNormalize(scores: number[]) {
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  if (max === min) return scores.map(() => 0);
  return scores.map(s => (s - min) / (max - min));
}

export function decayScore(originalScore: number, daysOld: number, halfLifeDays = 7) {
  const lambda = Math.log(2) / halfLifeDays;
  return originalScore * Math.exp(-lambda * daysOld);
}

export function applyTimeDecay(signals: Signal[], asOf = new Date(), halfLifeDays = 7) {
  return signals.map(s => {
    if (!s.timestamp) return s;
    const t = new Date(s.timestamp);
    const days = Math.max(0, (asOf.getTime() - t.getTime()) / (1000 * 60 * 60 * 24));
    return { ...s, score: decayScore(s.score, days, halfLifeDays) };
  });
}

export function combineSignals(signalSets: Signal[][], weights?: number[]) {
  // signalSets: array of strategies, each strategy -> array of signals
  const n = signalSets.length;
  const w = weights && weights.length === n ? weights : Array(n).fill(1 / Math.max(1, n));

  const map = new Map<string, { id: string; score: number }>();
  for (let i = 0; i < signalSets.length; i++) {
    const set = signalSets[i] || [];
    const wi = w[i];
    for (const s of set) {
      const prev = map.get(s.id);
      if (!prev) map.set(s.id, { id: s.id, score: s.score * wi });
      else prev.score += s.score * wi;
    }
  }

  const combined = Array.from(map.values());
  // normalize to 0..1 range to produce comparable scores
  const normed = minMaxNormalize(combined.map(c => c.score));
  return combined.map((c, i) => ({ id: c.id, score: normed[i] }));
}

export function computePortfolioWeights(combinedSignals: { id: string; score: number }[], minWeight = 0) {
  // positive-only proportional weights, sum to 1
  const positives = combinedSignals.map(s => ({ ...s, score: Math.max(0, s.score) }));
  const total = positives.reduce((acc, s) => acc + s.score, 0);
  if (total <= 0) return positives.map(s => ({ id: s.id, weight: 0 }));
  return positives.map(s => ({ id: s.id, weight: Math.max(minWeight, s.score / total) }));
}

export default {
  applyTimeDecay,
  combineSignals,
  computePortfolioWeights,
};
