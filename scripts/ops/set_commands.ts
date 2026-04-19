// scripts/ops/set_commands.ts
import "dotenv/config";

type TelegramResponse = {
  ok: boolean;
  result?: any;
  description?: string;
};

const commands = [
  { command: "start", description: "시작 · 메뉴" },
  { command: "onboarding", description: "초보자 온보딩 가이드" },
  { command: "sector", description: "주도 섹터 랭킹" },
  { command: "scan", description: "눌림목 스캐너" },
  { command: "analyze", description: "종목 분석" },
  { command: "finance", description: "재무 요약" },
  { command: "capital", description: "투자금 설정" },
  { command: "brief", description: "장전 브리핑" },
  { command: "report", description: "리포트 도움말 · /리포트 주간" },
  { command: "alert", description: "이상징후 점검" },
  { command: "economy", description: "글로벌 경제지표" },
  { command: "news", description: "시장·종목 뉴스" },
  { command: "market", description: "종합 시장 진단" },
  { command: "watchlist", description: "관심 종목 추적" },
  { command: "watchadd", description: "관심 종목 추가" },
  { command: "watchremove", description: "관심 종목 제거" },
  { command: "watchplan", description: "관심 종목 대응 플랜" },
  { command: "kospi", description: "코스피 추천 TOP5" },
  { command: "kosdaq", description: "코스닥 추천 TOP5" },
  { command: "etf", description: "ETF 추천 TOP5" },
  { command: "etfhub", description: "ETF 허브 메뉴" },
  { command: "etfcore", description: "ETF 적립형 추천" },
  { command: "etftheme", description: "ETF 테마형 추천" },
  { command: "etfinfo", description: "ETF NAV·괴리율 조회" },
  { command: "etfdiv", description: "ETF 분배금·배당락 조회" },
  { command: "holdings", description: "가상 보유 포트폴리오" },
  { command: "paperbuy", description: "가상 매수" },
  { command: "papersell", description: "가상 매도" },
  { command: "holdingedit", description: "보유 단가·수량 수정" },
  { command: "holdingrestore", description: "누락 보유 포지션 복구" },
  { command: "autosellcheck", description: "자동 매도 점검" },
  { command: "autocycle", description: "자동매매 1회 실행" },
  { command: "holdingplan", description: "보유 대응 플랜" },
  { command: "tradelog", description: "거래 기록" },
  { command: "flow", description: "외국인·기관 수급" },
  { command: "nextsector", description: "수급 유입 섹터" },
  { command: "pullback", description: "눌림목 매집 후보" },
  { command: "ranking", description: "포트폴리오 랭킹" },
  { command: "profile", description: "내 프로필" },
  { command: "follow", description: "트레이더 팔로우" },
  { command: "feed", description: "팔로잉 피드" },
  { command: "help", description: "도움말" },
];

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

if (!TELEGRAM_BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN is not defined in .env file.");
  process.exit(1);
}

async function setCommands() {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setMyCommands`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands }),
    });

    // 🔧 res.json() 결과를 명시적으로 TelegramResponse로 단언
    const json = (await res.json()) as TelegramResponse;

    if (json.ok) {
      console.log("✅ Telegram bot commands updated successfully!");
    } else {
      console.error("❌ Failed to update commands:", json);
    }
  } catch (e) {
    console.error("❌ Exception while updating commands:", e);
  }
}

setCommands().catch((e) => {
  console.error(e);
  process.exit(1);
});
