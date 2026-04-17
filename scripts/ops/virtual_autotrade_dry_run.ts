import "dotenv/config";
import { runVirtualAutoTradingCycle } from "../../src/services/virtualAutoTradeService";

type Mode = "auto" | "daily" | "monday";

function parseMode(raw?: string): Mode {
  if (raw === "daily") return "daily";
  if (raw === "monday") return "monday";
  return "auto";
}

function parsePositiveInt(raw?: string): number | undefined {
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const mode = parseMode(args.find((arg) => arg.startsWith("--mode="))?.split("=")[1]);
  const maxUsers = parsePositiveInt(args.find((arg) => arg.startsWith("--maxUsers="))?.split("=")[1]);

  console.log(`[virtual-autotrade] dry-run started mode=${mode} maxUsers=${maxUsers ?? "default"}`);

  const summary = await runVirtualAutoTradingCycle({
    mode,
    maxUsers,
    dryRun: true,
  });

  console.log("[virtual-autotrade] dry-run summary");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error("[virtual-autotrade] dry-run failed:", error);
  process.exit(1);
});
