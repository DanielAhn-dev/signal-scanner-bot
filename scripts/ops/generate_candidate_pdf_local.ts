import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { handleReportCommand } from "../../src/bot/commands/report";

type TgResult = { ok: boolean; description?: string };

async function main() {
  const topic = String(process.argv[2] ?? "공개추천").trim() || "공개추천";
  const chatId = Number(process.argv[3] ?? process.env.LOCAL_PREVIEW_CHAT_ID ?? 1);
  const outputDir = path.resolve(process.cwd(), "tmp");
  let savedPath = "";

  const tgSend = async (method: string, payload: any): Promise<TgResult> => {
    if (method === "sendDocument") {
      const form = payload as FormData;
      const documentEntry = form.get("document");
      if (!documentEntry || typeof (documentEntry as Blob).arrayBuffer !== "function") {
        return { ok: false, description: "document payload missing" };
      }

      const blob = documentEntry as Blob;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const fileName = (documentEntry as any).name || `candidate_preview_${Date.now()}.pdf`;

      await mkdir(outputDir, { recursive: true });
      savedPath = path.join(outputDir, fileName);
      await writeFile(savedPath, bytes);
      console.log(`[local-preview] saved: ${savedPath}`);
      return { ok: true };
    }

    if (method === "sendMessage") {
      const text = String(payload?.text ?? "");
      const firstLine = text.split("\n")[0] || "(empty)";
      console.log(`[local-preview] message: ${firstLine}`);
      return { ok: true };
    }

    return { ok: true };
  };

  await handleReportCommand(
    { chatId, from: { id: chatId } },
    tgSend,
    topic
  );

  if (!savedPath) {
    throw new Error("PDF file was not generated. Check logs for report generation errors.");
  }

  console.log(`[local-preview] done: topic=${topic}, chatId=${chatId}`);
}

main().catch((err) => {
  console.error("[local-preview] failed", err);
  process.exit(1);
});
