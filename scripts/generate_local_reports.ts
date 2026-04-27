import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createDailyCandidatePlanningReportResult } from "../src/services/marketInsightService";
import {
  buildPublicDailyCandidateText,
  createDailyCandidateReportPdf,
} from "../src/bot/commands/report";

type CliMode = "private" | "public" | "both";
type RiskProfile = "safe" | "balanced" | "active";

type CliOptions = {
  outDir: string;
  chatId: number;
  mode: CliMode;
  riskProfile: RiskProfile;
};

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    outDir: path.resolve(process.cwd(), "tmp", "reports"),
    chatId: 999999,
    mode: "both",
    riskProfile: "balanced",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--out" && argv[i + 1]) {
      options.outDir = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--chatId" && argv[i + 1]) {
      const parsed = Number(argv[i + 1]);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--chatId 는 양수 정수여야 합니다.");
      }
      options.chatId = Math.floor(parsed);
      i += 1;
      continue;
    }
    if (token === "--mode" && argv[i + 1]) {
      const mode = argv[i + 1].toLowerCase();
      if (mode === "private" || mode === "public" || mode === "both") {
        options.mode = mode;
      } else {
        throw new Error("--mode 는 private|public|both 중 하나여야 합니다.");
      }
      i += 1;
      continue;
    }
    if (token === "--risk" && argv[i + 1]) {
      const risk = argv[i + 1].toLowerCase();
      if (risk === "safe" || risk === "balanced" || risk === "active") {
        options.riskProfile = risk;
      } else {
        throw new Error("--risk 는 safe|balanced|active 중 하나여야 합니다.");
      }
      i += 1;
      continue;
    }
  }

  return options;
}

function createSupabaseFromEnv() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.");
  }

  return createClient(url, key);
}

async function generatePrivateReport(options: CliOptions) {
  const supabase = createSupabaseFromEnv();
  const report = await createDailyCandidatePlanningReportResult(supabase, {
    riskProfile: options.riskProfile,
    chatId: options.chatId,
  });

  const pdf = await createDailyCandidateReportPdf(options.chatId, report);
  const filePath = path.join(options.outDir, pdf.fileName);
  await writeFile(filePath, Buffer.from(pdf.bytes));
  console.log(`private report generated: ${filePath}`);
}

async function generatePublicReport(options: CliOptions) {
  const supabase = createSupabaseFromEnv();
  const baseReport = await createDailyCandidatePlanningReportResult(supabase, {
    riskProfile: "balanced",
  });

  const report = {
    ...baseReport,
    text: buildPublicDailyCandidateText(baseReport.text),
  };

  const pdf = await createDailyCandidateReportPdf(options.chatId, report, {
    title: "오늘의 투자 후보 리포트",
    subtitle: "개인 보유·자금·리스크 정보를 제외한 요약입니다.",
    filePrefix: "public_candidate_report",
    captionTitle: "오늘의 투자 후보 리포트",
    captionSubtitle: "추천 엔진 기준 일일 후보 PDF (개인정보 제외)",
    summaryText: "오늘의 투자 후보 리포트 PDF를 보냈습니다.",
  });

  const filePath = path.join(options.outDir, pdf.fileName);
  await writeFile(filePath, Buffer.from(pdf.bytes));
  console.log(`public report generated: ${filePath}`);
}

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  await mkdir(options.outDir, { recursive: true });

  if (options.mode === "private" || options.mode === "both") {
    await generatePrivateReport(options);
  }
  if (options.mode === "public" || options.mode === "both") {
    await generatePublicReport(options);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`local report generation failed: ${message}`);
  process.exitCode = 1;
});
