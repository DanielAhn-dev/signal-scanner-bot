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
  const bullTurn = isBullTurn(stableTurn);
  const bearTurn = isBearTurn(stableTurn);

  return filters.every((filter) => {
    if (filter === "stable") {
      return stableAboveAvg && stableTrust >= 55 && !bearTurn;
    }
    if (filter === "trend") {
      return stableAboveAvg && !bearTurn && (signal === "buy" || total >= 60);
    }
    if (filter === "accumulation") {
      return stableAccumulation;
    }
    if (filter === "entry") {
      return !bearTurn && (bullTurn || signal === "buy") && stableTrust >= 55;
    }
    return true;
  });
}

export function formatScanFilterLabels(filters: ScanFilterKey[]): string[] {
  return filters.map((filter) => FILTER_LABELS[filter]).filter(Boolean);
}