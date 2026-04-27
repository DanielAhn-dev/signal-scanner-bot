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

  const filters = new Set<ScanFilterKey>();
  const remaining: string[] = [];

  for (const rawToken of rawTokens) {
    const token = normalizeToken(rawToken);
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
  filters: ScanFilterKey[]
): boolean {
  if (!filters.length) return true;

  const total = Number(snapshot?.total ?? 0);
  const signal = String(snapshot?.signal ?? "").trim().toLowerCase();
  const stableTrust = Number(snapshot?.stableTrust ?? 0);
  const stableTurn = String(snapshot?.stableTurn ?? "").trim().toLowerCase();
  const stableAboveAvg = Boolean(snapshot?.stableAboveAvg ?? false);
  const stableAccumulation = Boolean(snapshot?.stableAccumulation ?? false);
  const recentInDays = Number(snapshot?.recentInDays ?? 0);
  const recentAccumulationDays = Number(snapshot?.recentAccumulationDays ?? 0);
  const recentBullDays = Number(snapshot?.recentBullDays ?? 0);
  const bullTurn = isBullTurn(stableTurn);
  const bearTurn = isBearTurn(stableTurn);
  const buyLikeSignal = signal === "buy" || signal === "strong_buy" || signal === "watch";
  const stablePositive = stableAboveAvg && stableTrust >= 50 && !bearTurn;
  const accumulationLike =
    stableAccumulation ||
    recentAccumulationDays >= 2 ||
    (stableAboveAvg && stableTrust >= 58 && total >= 58 && !bearTurn);

  return filters.every((filter) => {
    if (filter === "stable") {
      return bullTurn || recentBullDays >= 1 || stablePositive;
    }
    if (filter === "trend") {
      return !bearTurn && ((stableAboveAvg && total >= 55) || buyLikeSignal || bullTurn);
    }
    if (filter === "accumulation") {
      return accumulationLike;
    }
    if (filter === "entry") {
      return !bearTurn && (recentInDays >= 1 || bullTurn || signal === "buy" || signal === "strong_buy" || (stableAboveAvg && stableTrust >= 60 && total >= 65));
    }
    return true;
  });
}

export function formatScanFilterLabels(filters: ScanFilterKey[]): string[] {
  return filters.map((filter) => FILTER_LABELS[filter]).filter(Boolean);
}