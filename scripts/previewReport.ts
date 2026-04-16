import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createPreviewReportPdf } from "../src/services/weeklyReportService";

async function main() {
  const bytes = await createPreviewReportPdf("economy");
  const outPath = path.resolve(process.cwd(), "preview_economy_report.pdf");
  await writeFile(outPath, bytes);
  console.log(`preview generated: ${outPath}`);
}

main().catch((err) => {
  console.error("preview generation failed", err);
  process.exitCode = 1;
});
