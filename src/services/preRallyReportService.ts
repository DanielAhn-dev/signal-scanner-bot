import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type PreRallyPattern = {
  name: string;
  samples: number;
  winRatePct: number;
  liftVsBasePct: number;
  avgForwardReturnPct: number;
  avgMaxDrawdownPct: number;
};

export type PreRallyReport = {
  generatedAt?: string;
  config?: {
    horizonBars?: number;
    rallyThresholdPct?: number;
    minSamples?: number;
  };
  dataset?: {
    labeledRows?: number;
  };
  baseline?: {
    trainWinRatePct?: number;
    testWinRatePct?: number;
    trainAvgReturnPct?: number;
    testAvgReturnPct?: number;
  };
  stablePatterns?: PreRallyPattern[];
  notes?: string[];
};

export type LoadedPreRallyReport = {
  fileName: string;
  data: PreRallyReport;
};

function safeReadJson(path: string): PreRallyReport | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PreRallyReport;
  } catch {
    return null;
  }
}

function matchesHorizon(fileName: string, horizon: number): boolean {
  if (fileName.includes(`h${horizon}`)) return true;
  return false;
}

export function getLatestPreRallyReport(horizon: number): LoadedPreRallyReport | null {
  const tmpDir = join(process.cwd(), "tmp");
  const files = readdirSync(tmpDir)
    .filter((name) => /^pre_rally_.*\.json$/i.test(name))
    .filter((name) => matchesHorizon(name, horizon));

  const ranked = files
    .map((name) => {
      const fullPath = join(tmpDir, name);
      const data = safeReadJson(fullPath);
      const ts = Date.parse(String(data?.generatedAt || ""));
      return {
        fileName: name,
        generatedAtTs: Number.isFinite(ts) ? ts : 0,
        data,
      };
    })
    .filter((item): item is { fileName: string; generatedAtTs: number; data: PreRallyReport } => !!item.data)
    .sort((a, b) => b.generatedAtTs - a.generatedAtTs);

  const best = ranked[0];
  if (!best) return null;

  return {
    fileName: best.fileName,
    data: best.data,
  };
}
