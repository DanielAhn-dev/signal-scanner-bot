import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createPreviewReportPdf } from "../src/services/weeklyReportService";

async function main() {
  const topics = process.argv.slice(2);
  const reportTopics = topics.length > 0 ? topics : ["economy"];

  for (const topic of reportTopics) {
    const bytes = await createPreviewReportPdf(topic);
    const normalizedTopic = topic.trim().toLowerCase().replace(/\s+/g, "_");
    const outPath = path.resolve(process.cwd(), `preview_${normalizedTopic}_report.pdf`);
    await writeFile(outPath, bytes);
    console.log(`preview generated: ${outPath}`);
  }
}

main().catch((err) => {
  console.error("preview generation failed", err);
  process.exitCode = 1;
});
