// scripts/setWebhook.mjs
import "dotenv/config";
const token = process.env.TELEGRAM_BOT_TOKEN || "";
const secret = process.env.TELEGRAM_BOT_SECRET || "";
const arg = process.argv[2];
const baseUrl = (process.env.BASE_URL || "").replace(/\/+$/, "");

if (!token) {
  console.error("TELEGRAM_BOT_TOKEN 누락");
  process.exit(1);
}

const api = (method, body) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());

async function registerCommands() {
  const commands = [
    { command: "start", description: "시작 · 메뉴" },
    { command: "sector", description: "📊 주도 섹터 랭킹" },
    { command: "scan", description: "🔍 눌림목 스캐너" },
    { command: "score", description: "💯 종목 점수·시그널" },
    { command: "buy", description: "💰 매수 판독" },
    { command: "brief", description: "📋 장전 브리핑" },
    { command: "economy", description: "🌍 글로벌 경제지표" },
    { command: "news", description: "📰 시장·종목 뉴스" },
    { command: "market", description: "🏥 종합 시장 진단" },
    { command: "watchlist", description: "⭐ 관심종목 포트폴리오" },
    { command: "flow", description: "💹 외국인·기관 수급" },
    { command: "nextsector", description: "🔄 수급 유입 섹터" },
    { command: "pullback", description: "📉 눌림목 매집 후보" },
    { command: "ranking", description: "🏆 포트폴리오 랭킹" },
    { command: "profile", description: "👤 내 프로필" },
    { command: "follow", description: "👥 트레이더 팔로우" },
    { command: "feed", description: "📡 팔로잉 피드" },
    { command: "help", description: "❓ 도움말" },
  ];

  const [r1, r2, r3] = await Promise.all([
    api("setMyCommands", { commands }),
    api("setMyCommands", { commands, language_code: "ko" }),
    api("setChatMenuButton", { menu_button: { type: "commands" } }),
  ]);
  console.log("명령어 등록:", r1.ok ? "✅" : "❌", r1.description || "");
  console.log("한국어 메뉴:", r2.ok ? "✅" : "❌");
  console.log("메뉴 버튼:", r3.ok ? "✅" : "❌");
}

async function main() {
  if (arg === "delete") {
    const res = await api("deleteWebhook", {});
    console.log(res);
    return;
  }

  if (arg === "commands") {
    await registerCommands();
    return;
  }

  const webhookUrl = arg || (baseUrl ? `${baseUrl}/api/telegram` : "");
  if (!webhookUrl || !secret) {
    console.error("사용법:");
    console.error("  node setWebhook.mjs <WEBHOOK_URL>  -- 웹훅 설정");
    console.error("  node setWebhook.mjs commands        -- 메뉴 명령어 등록");
    console.error("  node setWebhook.mjs delete           -- 웹훅 삭제");
    process.exit(1);
  }

  if (!/\/api\/telegram$/i.test(webhookUrl)) {
    console.error("Telegram 웹훅은 /api/telegram 엔드포인트로만 설정해야 합니다.");
    console.error(`입력값: ${webhookUrl}`);
    process.exit(1);
  }

  const res = await api("setWebhook", {
    url: webhookUrl,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
  console.log("웹훅 설정:", res);

  // 웹훅 설정 후 자동으로 명령어도 등록
  await registerCommands();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
