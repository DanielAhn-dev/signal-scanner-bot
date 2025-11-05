#!/usr/bin/env node
require("dotenv").config();

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SECRET = process.env.TELEGRAM_BOT_SECRET;
const VERCEL_URL =
  process.env.PUBLIC_BASE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
const SUBCOMMAND = (process.argv[2] || "set").toLowerCase();

if (!TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN 미설정");
  process.exit(1);
}
if (!SECRET) {
  console.error("❌ TELEGRAM_BOT_SECRET 미설정");
  process.exit(1);
}
if (!VERCEL_URL) {
  console.error("❌ PUBLIC_BASE_URL 또는 VERCEL_URL 미설정");
  process.exit(1);
}

const WEBHOOK_URL = `${VERCEL_URL}/api/telegram`;

async function callTelegram(method, body) {
  const resp = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const ct = resp.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await resp.text();
    throw new Error(
      `Non-JSON response: ${resp.status} ${resp.statusText} :: ${text.slice(
        0,
        200
      )}`
    );
  }
  return resp.json();
}

async function set() {
  console.log(`📤 setting webhook to ${WEBHOOK_URL}`);
  const res = await callTelegram("setWebhook", {
    url: WEBHOOK_URL,
    secret_token: SECRET,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  });
  console.log(JSON.stringify(res, null, 2));
}

async function del() {
  console.log("🗑 deleting webhook");
  const res = await callTelegram("deleteWebhook", {
    drop_pending_updates: true,
  });
  console.log(JSON.stringify(res, null, 2));
}

async function info() {
  const res = await callTelegram("getWebhookInfo", {});
  console.log(JSON.stringify(res, null, 2));
}

(async () => {
  try {
    if (SUBCOMMAND === "delete") await del();
    else if (SUBCOMMAND === "info") await info();
    else await set();
  } catch (e) {
    console.error("❌ error:", e instanceof Error ? e.message : e);
    process.exit(1);
  }
})();
