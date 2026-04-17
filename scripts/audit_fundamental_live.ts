import "dotenv/config";
import { getFundamentalSnapshot } from "../src/services/fundamentalService";

const defaultCodes = ["035420", "005930", "000660", "035720", "207940"];
const codes = process.argv.slice(2).length ? process.argv.slice(2) : defaultCodes;

type Warning = {
  code: string;
  issues: string[];
};

function collectIssues(code: string, snapshot: Awaited<ReturnType<typeof getFundamentalSnapshot>>): string[] {
  const issues: string[] = [];

  if (snapshot.sales !== undefined && snapshot.sales < 100) {
    issues.push(`매출이 비정상적으로 작음: ${snapshot.sales}`);
  }
  if (snapshot.pbr !== undefined && snapshot.pbr > 20) {
    issues.push(`PBR 과대값 가능성: ${snapshot.pbr.toFixed(2)}`);
  }
  if (snapshot.roe !== undefined && Math.abs(snapshot.roe) > 100) {
    issues.push(`ROE 과대값 가능성: ${snapshot.roe.toFixed(2)}%`);
  }
  if (snapshot.salesGrowthPct !== undefined && Math.abs(snapshot.salesGrowthPct) > 200) {
    issues.push(`매출 성장률 과대값 가능성: ${snapshot.salesGrowthPct.toFixed(2)}%`);
  }
  if (snapshot.opIncomeGrowthPct !== undefined && Math.abs(snapshot.opIncomeGrowthPct) > 300) {
    issues.push(`영업이익 성장률 과대값 가능성: ${snapshot.opIncomeGrowthPct.toFixed(2)}%`);
  }
  if (snapshot.netIncomeGrowthPct !== undefined && Math.abs(snapshot.netIncomeGrowthPct) > 500) {
    issues.push(`순이익 성장률 과대값 가능성: ${snapshot.netIncomeGrowthPct.toFixed(2)}%`);
  }
  if (snapshot.per === undefined && snapshot.netIncome !== undefined && snapshot.netIncome > 0) {
    issues.push("흑자 추정인데 PER 누락");
  }

  return issues;
}

(async () => {
  const warnings: Warning[] = [];

  for (const code of codes) {
    const snapshot = await getFundamentalSnapshot(code);
    const issues = collectIssues(code, snapshot);
    if (issues.length) warnings.push({ code, issues });
    console.log(
      JSON.stringify(
        {
          code,
          per: snapshot.per,
          pbr: snapshot.pbr,
          roe: snapshot.roe,
          debtRatio: snapshot.debtRatio,
          sales: snapshot.sales,
          salesGrowthPct: snapshot.salesGrowthPct,
          qualityScore: snapshot.qualityScore,
          issues,
        },
        null,
        2
      )
    );
  }

  if (warnings.length) {
    console.log(`audit completed with ${warnings.length} warnings`);
    process.exitCode = 1;
    return;
  }

  console.log("audit completed without suspicious values");
})();