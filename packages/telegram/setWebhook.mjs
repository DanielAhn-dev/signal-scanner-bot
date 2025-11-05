import "dotenv/config";
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_BOT_SECRET;
const domain = process.env.VERCEL_URL;
const url = `https://api.telegram.org/bot${token}/setWebhook?url=https://${domain}/api/telegram&secret_token=${encodeURIComponent(
  secret
)}`;
const resp = await fetch(url);
console.log(await resp.text());
