import "dotenv/config";
import { getFundamentalSnapshot } from "../src/services/fundamentalService";
import fs from "fs";
import path from "path";

const defaultCodes = ["035420", "005930", "000660", "035720", "207940"];
const args = process.argv.slice(2);

async function loadAllCodes(limit?: number) {
  const file = path.resolve(__dirname, "../data/all_krx.json");
  try {
    const txt = fs.readFileSync(file, "utf8");
    const all = JSON.parse(txt) as Array<{ code: string }>;
    const codes = all.map((row) => row.code);
    return typeof limit === "number" ? codes.slice(0, limit) : codes;
  } catch (error) {
    console.error("Failed to load all_krx.json, falling back to defaults:", error);
    return defaultCodes;
  }
}

type Warning = {
  code: string;
  issues: string[];
};

type AuditEntry = {
  code: string;
  sectorName?: string;
  sectorCategory?: string;
  profileLabel?: string;
  per?: number;
  pbr?: number;
  roe?: number;
  debtRatio?: number;
  sales?: number;
  salesGrowthPct?: number;
  qualityScore: number;
  warnings: string[];
  critical: string[];
};

function resolveReportPath(): string {
  const fromEnv = process.env.AUDIT_OUTPUT_PATH?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(__dirname, "fundamental_audit_latest.json");
}

function collectIssues(snapshot: Awaited<ReturnType<typeof getFundamentalSnapshot>>): {
  warnings: string[];
  critical: string[];
} {
  const warnings: string[] = [];
  const critical: string[] = [];

  if (snapshot.sales !== undefined && snapshot.sales < 100) {
    critical.push(`매출이 비정상적으로 작음: ${snapshot.sales}`);
  }
  if (snapshot.pbr !== undefined && snapshot.pbr > 20) {
    warnings.push(`PBR 과대값 가능성: ${snapshot.pbr.toFixed(2)}`);
  }
  if (snapshot.roe !== undefined && Math.abs(snapshot.roe) > 100) {
    critical.push(`ROE 과대값 가능성: ${snapshot.roe.toFixed(2)}%`);
  }
  if (snapshot.salesGrowthPct !== undefined && Math.abs(snapshot.salesGrowthPct) > 200) {
    warnings.push(
      `매출 성장률 과대값 가능성: ${snapshot.salesGrowthPct.toFixed(2)}%${
        snapshot.salesGrowthLowBase ? " (낮은 기저 영향 가능성)" : ""
      }`
    );
  }
  if (snapshot.opIncomeGrowthPct !== undefined && Math.abs(snapshot.opIncomeGrowthPct) > 300) {
    warnings.push(
      `영업이익 성장률 과대값 가능성: ${snapshot.opIncomeGrowthPct.toFixed(2)}%${
        snapshot.opIncomeTurnaround
          ? " (턴어라운드)"
          : snapshot.opIncomeGrowthLowBase
            ? " (낮은 기저 영향 가능성)"
            : ""
      }`
    );
  }
  if (snapshot.netIncomeGrowthPct !== undefined && Math.abs(snapshot.netIncomeGrowthPct) > 500) {
    warnings.push(
      `순이익 성장률 과대값 가능성: ${snapshot.netIncomeGrowthPct.toFixed(2)}%${
        snapshot.netIncomeTurnaround
          ? " (턴어라운드)"
          : snapshot.netIncomeGrowthLowBase
            ? " (낮은 기저 영향 가능성)"
            : ""
      }`
    );
  }
  if (snapshot.per === undefined && snapshot.netIncome !== undefined && snapshot.netIncome > 0) {
    warnings.push("흑자 추정인데 PER 누락");
  }

  return { warnings, critical };
}

(async () => {
  let codes: string[];
  if (args.includes("--all")) {
    const idx = args.indexOf("--all");
    const maybeLimit = args[idx + 1] || process.env.AUDIT_LIMIT;
    const limit = maybeLimit ? Number(maybeLimit) : undefined;
    codes = await loadAllCodes(Number.isFinite(limit) ? limit : undefined);
  } else {
    codes = args.length ? args : defaultCodes;
  }

  const warnings: Warning[] = [];
  const criticalIssues: Warning[] = [];
  const entries: AuditEntry[] = [];

  for (const code of codes) {
    const snapshot = await getFundamentalSnapshot(code);
    const { warnings: itemWarnings, critical } = collectIssues(snapshot);
    if (itemWarnings.length) warnings.push({ code, issues: itemWarnings });
    if (critical.length) criticalIssues.push({ code, issues: critical });
    const entry: AuditEntry = {
      code,
      sectorName: snapshot.sectorName,
      sectorCategory: snapshot.sectorCategory,
      profileLabel: snapshot.profileLabel,
      per: snapshot.per,
      pbr: snapshot.pbr,
      roe: snapshot.roe,
      debtRatio: snapshot.debtRatio,
      sales: snapshot.sales,
      salesGrowthPct: snapshot.salesGrowthPct,
      qualityScore: snapshot.qualityScore,
      warnings: itemWarnings,
      critical,
    };
    entries.push(entry);
    console.log(JSON.stringify(entry, null, 2));
  }

  const reportPath = resolveReportPath();
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        codeCount: codes.length,
        warningCount: warnings.length,
        criticalCount: criticalIssues.length,
        entries,
      },
      null,
      2
    ),
    "utf8"
  );
  console.log(`audit report saved to ${reportPath}`);

  if (warnings.length) {
    console.log(`audit completed with ${warnings.length} warning entries`);
  }

  if (criticalIssues.length) {
    console.log(`audit completed with ${criticalIssues.length} critical entries`);
    process.exitCode = 1;
    return;
  }

  if (warnings.length) {
    console.log("audit completed without critical issues");
    return;
  }

  console.log("audit completed without suspicious values");
})();