import "dotenv/config";

function getArgValue(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.findIndex((item) => item === flag);
  if (index < 0) return undefined;
  return args[index + 1];
}

async function main() {
  const task = getArgValue("--task") ?? "virtualAutoTradeIntraday";
  const cliBaseUrl = getArgValue("--baseUrl");
  let baseUrl = cliBaseUrl || process.env.CRON_BASE_URL || "";
  if (!baseUrl) {
    const vercelUrl = process.env.VERCEL_URL || "";
    if (vercelUrl) {
      baseUrl = vercelUrl.startsWith("http") ? vercelUrl : `https://${vercelUrl}`;
    }
  }
  if (!baseUrl) {
    baseUrl = "https://signal-scanner-bot.vercel.app";
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    throw new Error("CRON_SECRET is required");
  }

  const normalizedBase = String(baseUrl).replace(/\/$/, "");
  const targetUrl = `${normalizedBase}/api/cron?task=${encodeURIComponent(task)}`;

  const response = await fetch(targetUrl, {
    method: "GET",
    headers: {
      authorization: `Bearer ${cronSecret}`,
    },
  });

  const text = await response.text();
  const body = text.length > 2000 ? `${text.slice(0, 2000)}...` : text;

  console.log(`[cron-trigger] task=${task}`);
  console.log(`[cron-trigger] status=${response.status}`);
  console.log(`[cron-trigger] body=${body}`);

  if (!response.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
