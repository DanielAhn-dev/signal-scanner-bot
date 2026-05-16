import { spawn } from "node:child_process";

type Stage = {
  name: string;
  command: string;
  args: string[];
};

function parseArg(name: string): string | undefined {
  const hit = process.argv.find((x) => x.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function parseBoolArg(name: string, fallback: boolean): boolean {
  const raw = parseArg(name);
  if (!raw) return fallback;
  const s = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return fallback;
}

function parseIntArg(name: string, fallback: number): number {
  const raw = parseArg(name);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

async function runStage(stage: Stage): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const isWindows = process.platform === "win32";
    const command = isWindows ? "cmd.exe" : stage.command;
    const args = isWindows ? ["/d", "/s", "/c", stage.command, ...stage.args] : stage.args;

    const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
      env: process.env,
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`[stable-maintenance] stage failed: ${stage.name} (exit ${code ?? -1})`));
      }
    });
    child.on("error", reject);
  });
}

async function main() {
  const maxDates = parseIntArg("maxDates", 200);
  const limit = parseIntArg("limit", 600);
  const concurrency = parseIntArg("concurrency", 6);
  const lookback = parseIntArg("lookback", 520);
  const maxRows = parseIntArg("maxRows", 30000);
  const skipRecentDays = parseIntArg("skipRecentDays", 120);
  const promotionMinSamples = parseIntArg("promotionMinSamples", 50);
  const dryRun = parseBoolArg("dryRun", false);

  const backfillArgs = [
    "backfill:stable-factors:deep",
    "--",
    `--maxDates=${maxDates}`,
    "--onlyMissing=true",
    `--limit=${limit}`,
    `--concurrency=${concurrency}`,
    `--dryRun=${dryRun}`,
  ];

  const verifyArgs = [
    "backtest:stable-accumulation",
    "--",
    `--lookback=${lookback}`,
    `--maxRows=${maxRows}`,
    `--skipRecentDays=${skipRecentDays}`,
    `--promotionMinSamples=${promotionMinSamples}`,
  ];

  const stages: Stage[] = [
    {
      name: "deep-backfill",
      command: "pnpm",
      args: backfillArgs,
    },
    {
      name: "promotion-verify",
      command: "pnpm",
      args: verifyArgs,
    },
  ];

  console.log(
    `[stable-maintenance] start dryRun=${dryRun} maxDates=${maxDates} lookback=${lookback} promotionMinSamples=${promotionMinSamples}`,
  );

  for (const stage of stages) {
    console.log(`[stable-maintenance] stage=${stage.name} running`);
    await runStage(stage);
    console.log(`[stable-maintenance] stage=${stage.name} done`);
  }

  console.log("[stable-maintenance] all stages completed");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
