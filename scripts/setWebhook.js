require("dotenv").config();

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SECRET = process.env.TELEGRAM_BOT_SECRET;
const VERCEL_URL = process.env.VERCEL_URL || "signal-scanner-bot.vercel.app";

// 🔍 디버깅: 환경변수 확인
console.log("🔍 환경변수 체크:");
console.log("TOKEN:", TOKEN ? `${TOKEN.slice(0, 10)}...` : "❌ 없음");
console.log("SECRET:", SECRET ? `${SECRET.slice(0, 10)}...` : "❌ 없음");
console.log("VERCEL_URL:", VERCEL_URL);
console.log("");

if (!TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN이 설정되지 않았습니다!");
  console.error("   .env 파일을 확인하세요.");
  process.exit(1);
}

const webhookURL = `https://${VERCEL_URL}/api/telegram`;

async function setWebhook() {
  const url = `https://api.telegram.org/bot${TOKEN}/setWebhook`;

  const params = new URLSearchParams({
    url: webhookURL,
    secret_token: SECRET,
    allowed_updates: JSON.stringify(["message"]),
    drop_pending_updates: "true",
  });

  console.log("📤 웹훅 등록 URL:", webhookURL);

  try {
    const response = await fetch(`${url}?${params.toString()}`);
    const result = await response.json();

    console.log("\n✅ Webhook 설정 결과:");
    console.log(JSON.stringify(result, null, 2));

    if (result.ok) {
      console.log(`\n🎉 웹훅 등록 완료: ${webhookURL}`);
    } else {
      console.error(`\n❌ 웹훅 등록 실패: ${result.description}`);
      console.error("   error_code:", result.error_code);
    }
  } catch (error) {
    console.error("❌ 오류 발생:", error);
  }
}

async function getWebhookInfo() {
  const url = `https://api.telegram.org/bot${TOKEN}/getWebhookInfo`;

  try {
    const response = await fetch(url);
    const result = await response.json();

    console.log("\n📋 현재 웹훅 상태:");
    console.log(JSON.stringify(result.result, null, 2));
  } catch (error) {
    console.error("❌ 상태 조회 실패:", error);
  }
}

// 실행
(async () => {
  await setWebhook();
  await getWebhookInfo();
})();
