export type PreMarketAdaptiveProfile = {
  stance: "defensive" | "standard" | "opportunity" | "press-winner";
  label: string;
  reason: string;
  scoreAdjustment: number;
  maxOrders: number;
  minRiskReward: number;
};

export type RecentPerformanceMetrics = {
  windowDays: number;
  realizedPnl: number;
  sellCount: number;
  winningSellCount: number;
  winRate: number | null;
  buyActions: number;
  skipActions: number;
  topSkipReasons: Array<{ reason: string; count: number }>;
};

export function derivePreMarketAdaptiveProfile(input: {
  seedCapital: number;
  metrics: RecentPerformanceMetrics | null;
}): PreMarketAdaptiveProfile {
  const metrics = input.metrics;
  if (!metrics) {
    return {
      stance: "standard",
      label: "기본",
      reason: "최근 성과 데이터 부족으로 기본 모드 유지",
      scoreAdjustment: 0,
      maxOrders: 2,
      minRiskReward: 1.5,
    };
  }

  const lossGuard = Math.max(50_000, Math.round(Math.max(0, input.seedCapital) * 0.005));
  const topSkipReason = metrics.topSkipReasons[0]?.reason ?? "";

  if (
    metrics.realizedPnl <= -lossGuard ||
    (metrics.winRate != null && metrics.sellCount >= 2 && metrics.winRate < 40)
  ) {
    return {
      stance: "defensive",
      label: "보수강화",
      reason: "최근 손익 부진 또는 승률 저하로 진입 수를 축소",
      scoreAdjustment: 2,
      maxOrders: 1,
      minRiskReward: 1.8,
    };
  }

  if (
    metrics.realizedPnl > 0 &&
    metrics.sellCount >= 2 &&
    metrics.winRate != null &&
    metrics.winRate >= 55
  ) {
    return {
      stance: "press-winner",
      label: "확장",
      reason: "최근 성과 우위로 상위 후보를 조금 더 적극 반영",
      scoreAdjustment: -2,
      maxOrders: 3,
      minRiskReward: 1.3,
    };
  }

  if (topSkipReason === "no-candidates" && metrics.skipActions >= Math.max(5, metrics.buyActions * 2)) {
    return {
      stance: "opportunity",
      label: "기회확대",
      reason: "후보 부족이 반복돼 점수 기준을 소폭 완화",
      scoreAdjustment: -1,
      maxOrders: 2,
      minRiskReward: 1.4,
    };
  }

  return {
    stance: "standard",
    label: "기본",
    reason: "최근 성과와 스킵 패턴이 중립 구간",
    scoreAdjustment: 0,
    maxOrders: 2,
    minRiskReward: 1.5,
  };
}