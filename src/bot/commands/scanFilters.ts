export type ScanFilterKey = "trend" | "accumulation" | "entry" | "stable";

export type ParsedScanInput = {
  query: string;
  filters: ScanFilterKey[];
};

export type ScanScoreSnapshot = {
  total?: number;
  signal?: string;
  stableTrust?: number;
  stableTurn?: string;
  stableAboveAvg?: boolean;
  stableAccumulation?: boolean;
  recentInDays?: number;
  recentAccumulationDays?: number;
  recentBullDays?: number;
};

export type ScanPullbackSnapshot = {
  entryGrade?: string;
  entryScore?: number;
  trendGrade?: string;
  distGrade?: string;
};

type FilterEval = {
  matched: boolean;
  reason: string;
};

type ScanFilterEvaluation = Record<ScanFilterKey, FilterEval>;

const FILTER_TOKEN_MAP: Array<{ filter: ScanFilterKey; tokens: string[] }> = [
  { filter: "trend", tokens: ["trend", "추세", "상승", "trendup"] },
  { filter: "accumulation", tokens: ["acc", "매집", "accumulation"] },
  { filter: "entry", tokens: ["in", "진입", "신규", "entry"] },
  { filter: "stable", tokens: ["stable", "세력", "세력선", "평단"] },
];

const FILTER_LABELS: Record<ScanFilterKey, string> = {
  trend: "추세 정렬",
  accumulation: "매집",
  entry: "IN 타이밍",
  stable: "세력선 우위",
};

function normalizeToken(token: string): string {
  return token.trim().toLowerCase();
}

function isBullTurn(turn?: string): boolean {
  return turn === "bull-weak" || turn === "bull-strong";
}

function isBearTurn(turn?: string): boolean {
  return turn === "bear-weak" || turn === "bear-strong";
}

export function parseScanInput(input: string): ParsedScanInput {
  const rawTokens = String(input || "")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const IGNORE_TOKENS = ["눌림목", "눌림", "기본"];

  const filters = new Set<ScanFilterKey>();
  const remaining: string[] = [];

  for (const rawToken of rawTokens) {
    const token = normalizeToken(rawToken);
    if (IGNORE_TOKENS.includes(token)) continue;
    const matched = FILTER_TOKEN_MAP.find((entry) => entry.tokens.includes(token));
    if (matched) {
      filters.add(matched.filter);
      continue;
    }
    remaining.push(rawToken);
  }

  return {
    query: remaining.join(" ").trim(),
    filters: [...filters],
  };
}

export function matchesScanFilters(
  snapshot: ScanScoreSnapshot | undefined,
  filters: ScanFilterKey[],
  pullback?: ScanPullbackSnapshot
): boolean {
  if (!filters.length) return true;

  const evaluation = evaluateScanFilters(snapshot, pullback);
  return filters.every((filter) => evaluation[filter]?.matched ?? true);
}

function evaluateScanFilters(
  snapshot: ScanScoreSnapshot | undefined,
  pullback?: ScanPullbackSnapshot
): ScanFilterEvaluation {
  const total = Number(snapshot?.total ?? 0);
  const signal = String(snapshot?.signal ?? "").trim().toLowerCase();
  const stableTrust = Number(snapshot?.stableTrust ?? 0);
  const stableTurn = String(snapshot?.stableTurn ?? "").trim().toLowerCase();
  const stableAboveAvg = Boolean(snapshot?.stableAboveAvg ?? false);
  const stableAccumulation = Boolean(snapshot?.stableAccumulation ?? false);
  const recentInDays = Number(snapshot?.recentInDays ?? 0);
  const recentAccumulationDays = Number(snapshot?.recentAccumulationDays ?? 0);
  const recentBullDays = Number(snapshot?.recentBullDays ?? 0);
  const entryGrade = String(pullback?.entryGrade ?? "").trim().toUpperCase();
  const entryScore = Number(pullback?.entryScore ?? 0);
  const trendGrade = String(pullback?.trendGrade ?? "").trim().toUpperCase();
  const distGrade = String(pullback?.distGrade ?? "").trim().toUpperCase();
  const bullTurn = isBullTurn(stableTurn);
  const bearTurn = isBearTurn(stableTurn);
  const buyLikeSignal = signal === "buy" || signal === "strong_buy" || signal === "watch";
  const pullbackEntryLike = entryGrade === "A" || entryGrade === "B" || entryScore >= 3;
  const pullbackAccumulationLike =
    (trendGrade === "A" || trendGrade === "B") &&
    (distGrade === "A" || distGrade === "B") &&
    pullbackEntryLike;
  const stablePositive = stableAboveAvg && stableTrust >= 50 && !bearTurn;
  const trendLike = !bearTurn && ((stableAboveAvg && total >= 55) || buyLikeSignal || bullTurn);
  const entryLike =
    !bearTurn &&
    (recentInDays >= 1 ||
      bullTurn ||
      ((signal === "buy" || signal === "strong_buy") && stableAboveAvg && stableTrust >= 58) ||
      (stableAboveAvg && stableTrust >= 64 && total >= 68));
  const accumulationLike =
    stableAccumulation ||
    recentAccumulationDays >= 2 ||
    (stableAboveAvg && stableTrust >= 62 && total >= 62 && !bearTurn) ||
    (!bearTurn && recentInDays >= 1 && stableAboveAvg && stableTrust >= 58) ||
    (!bearTurn && pullbackAccumulationLike && stableAboveAvg && stableTrust >= 60);

  return {
    stable: {
      matched: bullTurn || recentBullDays >= 1 || stablePositive,
      reason: bullTurn
        ? "세력 상승턴"
        : recentBullDays >= 1
          ? `최근 상승턴 ${recentBullDays}회`
          : stablePositive
            ? "세력선/신뢰도 우위"
            : "세력 우위 부족",
    },
    trend: {
      matched: trendLike,
      reason: bullTurn
        ? "상승턴 확인"
        : stableAboveAvg && total >= 55
          ? `기준선 상회·점수 ${Math.round(total)}`
          : buyLikeSignal
            ? `신호 ${signal.toUpperCase()}`
            : bearTurn
              ? "하락턴"
              : "추세 신호 부족",
    },
    accumulation: {
      matched: accumulationLike,
      reason: stableAccumulation
        ? "Stable 매집"
        : recentAccumulationDays >= 2
          ? `최근 매집 ${recentAccumulationDays}일`
          : stableAboveAvg && stableTrust >= 62 && total >= 62 && !bearTurn
            ? `안정구간·신뢰도 ${Math.round(stableTrust)}점`
            : !bearTurn && recentInDays >= 1 && stableAboveAvg && stableTrust >= 58
              ? "최근 IN + 안정구간"
              : !bearTurn && pullbackAccumulationLike && stableAboveAvg && stableTrust >= 60
                ? "눌림목 품질 + 안정구간"
                : "매집 신호 부족",
    },
    entry: {
      matched: entryLike,
      reason: recentInDays >= 1
        ? recentInDays === 1
          ? "오늘 IN 계열"
          : `최근 IN ${recentInDays}일`
        : bullTurn
          ? "상승턴 진입"
          : (signal === "buy" || signal === "strong_buy") && stableAboveAvg && stableTrust >= 58
            ? `신호 ${signal.toUpperCase()} + 안정구간`
            : stableAboveAvg && stableTrust >= 64 && total >= 68
              ? `고신뢰 안정구간(${Math.round(stableTrust)}점)`
              : bearTurn
                ? "하락턴"
                : "진입 신호 부족",
    },
  };
}

export function describeScanFilterReasons(
  snapshot: ScanScoreSnapshot | undefined,
  filters: ScanFilterKey[],
  pullback?: ScanPullbackSnapshot
): string[] {
  if (!filters.length) return [];
  const evaluation = evaluateScanFilters(snapshot, pullback);
  return filters
    .filter((filter) => evaluation[filter]?.matched)
    .map((filter) => `${FILTER_LABELS[filter]}(${evaluation[filter].reason})`);
}

export function formatScanFilterLabels(filters: ScanFilterKey[]): string[] {
  return filters.map((filter) => FILTER_LABELS[filter]).filter(Boolean);
}