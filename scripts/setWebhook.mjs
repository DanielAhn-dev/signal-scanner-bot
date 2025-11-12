// scripts/setWebhook.mjs
import "dotenv/config";
const token = process.env.TELEGRAM_BOT_TOKEN || "";
const secret = process.env.TELEGRAM_BOT_SECRET || "";
const arg = process.argv[2];

if (!token) {
  console.error("TELEGRAM_BOT_TOKEN 누락");
  process.exit(1);
}

async function main() {
  if (arg === "delete") {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/deleteWebhook`,
      { method: "POST" }
    );
    console.log(await res.json());
    return;
  }
  const webhookUrl = arg;
  if (!webhookUrl || !secret) {
    console.error("WEBHOOK_URL 또는 TELEGRAM_BOT_SECRET 누락");
    process.exit(1);
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: true,
    }),
  });
  console.log(await res.json());
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
