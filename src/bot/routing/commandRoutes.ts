import { KO_MESSAGES } from "../messages/ko";
import { handleBriefCommand } from "../commands/brief";
import { handleBuyCommand } from "../commands/buy";
import { handleSectorCommand } from "../commands/sector";
import { handleOnboardingCommand, handleRiskProfileCommand } from "../commands/onboarding";
import { handlePullbackCommand } from "../commands/pullback";
import { handleAlertCommand } from "../commands/alert";
import { handleEconomyCommand } from "../commands/economy";
import { handleMarketCommand } from "../commands/market";
import { handleFinanceCommand } from "../commands/finance";
import { handleNewsCommand } from "../commands/news";
import { handleScanCommand } from "../commands/scan";
import { handleStocksCommand } from "../commands/stocks";
import { handleFlowCommand } from "../commands/flow";
import { handleNextSectorCommand } from "../commands/sector";
import { handleCapitalCommand } from "../commands/capital";
import {
  handleAutoBacktestCommand,
  handleAutoShadowCommand,
  handleAutoTrustCommand,
} from "../commands/autoTradeOps";
import { handleAutoReportCommand } from "../commands/autoReport";
import { handleReportCommand } from "../commands/report";
import {
  handleKospiCommand,
  handleKosdaqCommand,
  handleEtfCoreCommand,
  handleEtfThemeCommand,
} from "../commands/marketPicks";
import {
  handleEtfDistributionCommand,
  handleEtfHubCommand,
  handleEtfInfoCommand,
} from "../commands/etf";
import { handleAutoCycleCommand } from "../commands/autoCycle";
import { handleOpsTriggerCommand } from "../commands/opsTrigger";
import { handlePreMarketPlanCommand } from "../commands/preMarketPlan";
import { handleStrategySelect } from "../commands/strategySelect";
import {
  handleWatchlistCommand,
  handleWatchOnlyCommand,
  handleWatchOnlyAdd,
  handleWatchOnlyRemove,
  handleWatchOnlyReset,
  handleWatchOnlyResponseCommand,
  handleWatchlistAdd,
  handleWatchlistRemove,
  handleWatchlistEdit,
  handleWatchlistRestoreCommand,
  handleWatchlistAutoCommand,
  handleWatchlistResponseCommand,
  handleWatchlistHistoryCommand,
  handleWatchlistLiquidateAllCommand,
} from "../commands/watchlist";
import { handleProfileCommand } from "../commands/profile";
import { handleRankingCommand } from "../commands/ranking";
import { handleWeeklyCopilotCommand } from "../commands/weeklyCopilot";
import {
  handleFollowCommand,
  handleUnfollowCommand,
  handleFeedCommand,
} from "../commands/follow";
import { CMD } from "./commandPatterns";
import type { CommandRouteSpec } from "./types";

export const COMMAND_ROUTE_SPECS: CommandRouteSpec[] = [
  {
    pattern: CMD.WEEKLY_COPILOT,
    userErrorLabel: "주간 코파일럿",
    tokens: ["weekly", "weeklycopilot", "주간코파일럿"],
    run: (match, ctx, tgSend) =>
      handleWeeklyCopilotCommand(ctx, tgSend, match[2] ?? ""),
  },
  {
    pattern: CMD.BRIEF,
    userErrorLabel: "브리핑",
    tokens: ["brief", "morning", "브리핑", "장전"],
    run: (_match, ctx, tgSend) => handleBriefCommand(ctx, tgSend),
  },
  {
    pattern: CMD.PREMARKET,
    userErrorLabel: "장전 주문 플랜",
    tokens: ["premarket", "장전플랜", "직장인플랜", "오늘주문"],
    run: (_match, ctx, tgSend) => handlePreMarketPlanCommand("", ctx, tgSend),
  },
  {
    pattern: CMD.REPORT,
    userErrorLabel: "리포트",
    tokens: ["report", "리포트"],
    run: (match, ctx, tgSend) => handleReportCommand(ctx, tgSend, match[2]),
  },
  {
    pattern: CMD.GUIDEPDF,
    userErrorLabel: "가이드 PDF",
    tokens: ["guidepdf", "가이드pdf", "운영가이드pdf"],
    run: (_match, ctx, tgSend) => handleReportCommand(ctx, tgSend, "가이드"),
  },
  {
    pattern: CMD.HELP,
    tokens: ["help", "도움말"],
    run: async (_match, ctx, tgSend) => {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: KO_MESSAGES.HELP,
      });
    },
  },
  {
    pattern: CMD.STRATEGY_SELECT,
    userErrorLabel: "전략 선택",
    tokens: ["전략선택", "strategy"],
    run: (_match, ctx, tgSend) => handleStrategySelect(ctx, tgSend),
  },
  {
    pattern: CMD.ONBOARDING,
    tokens: ["onboarding", "온보딩", "시작하기", "가이드"],
    run: (_match, ctx, tgSend) => handleOnboardingCommand(ctx, tgSend),
  },
  {
    pattern: CMD.SECTOR,
    userErrorLabel: "업종",
    tokens: ["sector", "섹터", "업종", "테마"],
    run: (_match, ctx, tgSend) => handleSectorCommand(ctx, tgSend),
  },
  {
    pattern: CMD.PULLBACK,
    userErrorLabel: "눌림목",
    tokens: ["pullback", "눌림목"],
    run: (_match, ctx, tgSend) => handlePullbackCommand(ctx, tgSend),
  },
  {
    pattern: CMD.ECONOMY,
    userErrorLabel: "경제지표",
    tokens: ["economy", "경제"],
    run: (_match, ctx, tgSend) => handleEconomyCommand(ctx, tgSend),
  },
  {
    pattern: CMD.MARKET,
    userErrorLabel: "시장",
    tokens: ["market", "시장"],
    run: (_match, ctx, tgSend) => handleMarketCommand(ctx, tgSend),
  },
  {
    pattern: CMD.TRADE,
    tokens: ["analyze", "종목분석"],
    run: (match, ctx, tgSend) => handleBuyCommand(match[2], ctx, tgSend),
  },
  {
    pattern: CMD.STOCKS,
    userErrorLabel: "종목",
    tokens: ["stocks", "종목"],
    run: (match, ctx, tgSend) => handleStocksCommand(match[2], ctx, tgSend),
  },
  {
    pattern: CMD.SCAN,
    userErrorLabel: "스캔",
    tokens: ["scan", "스캔"],
    run: (match, ctx, tgSend) => handleScanCommand(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.NEWS,
    tokens: ["news", "뉴스"],
    run: (match, ctx, tgSend) => handleNewsCommand(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.FLOW,
    userErrorLabel: "수급",
    tokens: ["flow", "수급"],
    run: (match, ctx, tgSend) => handleFlowCommand(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.FINANCE,
    tokens: ["finance", "재무"],
    run: (match, ctx, tgSend) => handleFinanceCommand(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.CAPITAL,
    tokens: ["capital", "투자금"],
    run: (match, ctx, tgSend) => handleCapitalCommand(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.AUTOTRUST,
    tokens: ["신뢰도", "autotrust"],
    run: (match, ctx, tgSend) => handleAutoTrustCommand(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.AUTOSHADOW,
    tokens: ["섀도우", "shadow"],
    run: (match, ctx, tgSend) => handleAutoShadowCommand(match[2] ?? "status", ctx, tgSend),
  },
  {
    pattern: CMD.AUTOBACKTEST,
    tokens: ["자동백테스트", "autobacktest"],
    run: (match, ctx, tgSend) => handleAutoBacktestCommand(match[2] ?? "3", ctx, tgSend),
  },
  {
    pattern: CMD.AUTOREPORT,
    tokens: ["자동리포트", "autoreport"],
    run: (_match, ctx, tgSend) => handleAutoReportCommand(ctx, tgSend),
  },
  {
    pattern: CMD.RISK_PROFILE,
    tokens: ["투자성향", "성향", "risk", "riskprofile"],
    run: (match, ctx, tgSend) => handleRiskProfileCommand(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.WATCHONLYLIST,
    tokens: ["watchlist", "관심"],
    run: (_match, ctx, tgSend) => handleWatchOnlyCommand(ctx, tgSend),
  },
  {
    pattern: CMD.WATCHONLYADD,
    tokens: ["watchadd", "관심추가"],
    run: (match, ctx, tgSend) => handleWatchOnlyAdd(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.WATCHONLYREMOVE,
    tokens: ["watchremove", "관심제거"],
    run: (match, ctx, tgSend) => handleWatchOnlyRemove(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.WATCHONLYRESET,
    tokens: ["watchreset", "관심초기화"],
    run: (match, ctx, tgSend) => handleWatchOnlyReset(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.WATCHONLYRESP,
    tokens: ["watchplan", "관심대응"],
    run: (_match, ctx, tgSend) => handleWatchOnlyResponseCommand(ctx, tgSend),
  },
  {
    pattern: CMD.WATCHADD,
    tokens: ["paperbuy", "가상매수"],
    run: (match, ctx, tgSend) => handleWatchlistAdd(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.WATCHREMOVE,
    tokens: ["papersell", "가상매도"],
    run: (match, ctx, tgSend) => handleWatchlistRemove(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.WATCHEDIT,
    tokens: ["holdingedit", "보유수정"],
    run: (match, ctx, tgSend) => handleWatchlistEdit(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.WATCHRESTORE,
    tokens: ["holdingrestore", "보유복구"],
    run: (match, ctx, tgSend) => handleWatchlistRestoreCommand(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.RECORD,
    tokens: ["tradelog", "거래기록"],
    run: (match, ctx, tgSend) => handleWatchlistHistoryCommand(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.LIQUIDATEALL,
    tokens: ["liquidateall", "전체매도"],
    run: (match, ctx, tgSend) =>
      handleWatchlistLiquidateAllCommand(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.WATCHAUTO,
    tokens: ["autosellcheck", "자동매도점검"],
    run: (_match, ctx, tgSend) => handleWatchlistAutoCommand(ctx, tgSend),
  },
  {
    pattern: CMD.WATCHRESP,
    tokens: ["holdingplan", "보유대응", "관심대응"],
    run: (_match, ctx, tgSend) => handleWatchlistResponseCommand(ctx, tgSend),
  },
  {
    pattern: CMD.ALERT,
    tokens: ["alert", "이상징후", "알림"],
    run: (_match, ctx, tgSend) => handleAlertCommand(ctx, tgSend),
  },
  {
    pattern: CMD.WATCHLIST,
    tokens: ["holdings", "보유"],
    run: (_match, ctx, tgSend) => handleWatchlistCommand(ctx, tgSend),
  },
  {
    pattern: CMD.AUTOCYCLE,
    tokens: ["autocycle", "자동사이클"],
    run: (match, ctx, tgSend) => handleAutoCycleCommand(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.OPSTRIGGER,
    tokens: ["opsrun", "cronrun", "자동트리거", "운영트리거"],
    run: (match, ctx, tgSend) => handleOpsTriggerCommand(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.RANKING,
    tokens: ["ranking", "랭킹", "순위"],
    run: (_match, ctx, tgSend) => handleRankingCommand(ctx, tgSend),
  },
  {
    pattern: CMD.PROFILE,
    tokens: ["profile", "프로필", "내정보"],
    run: (_match, ctx, tgSend) => handleProfileCommand(ctx, tgSend),
  },
  {
    pattern: CMD.FOLLOW,
    tokens: ["follow", "팔로우"],
    run: (match, ctx, tgSend) => handleFollowCommand(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.UNFOLLOW,
    tokens: ["unfollow", "언팔로우"],
    run: (match, ctx, tgSend) => handleUnfollowCommand(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.FEED,
    tokens: ["feed", "피드"],
    run: (_match, ctx, tgSend) => handleFeedCommand(ctx, tgSend),
  },
  {
    pattern: CMD.NEXTSECTOR,
    tokens: ["nextsector", "다음섹터", "수급섹터"],
    run: (_match, ctx, tgSend) => handleNextSectorCommand(ctx, tgSend),
  },
  {
    pattern: CMD.KOSPI,
    userErrorLabel: "코스피",
    tokens: ["kospi", "코스피"],
    run: (_match, ctx, tgSend) => handleKospiCommand(ctx, tgSend),
  },
  {
    pattern: CMD.KOSDAQ,
    userErrorLabel: "코스닥",
    tokens: ["kosdaq", "코스닥"],
    run: (_match, ctx, tgSend) => handleKosdaqCommand(ctx, tgSend),
  },
  {
    pattern: CMD.ETFINFO,
    userErrorLabel: "ETF 정보",
    tokens: ["etfinfo"],
    run: (match, ctx, tgSend) => handleEtfInfoCommand(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.ETFDIV,
    userErrorLabel: "ETF 분배금",
    tokens: ["etfdiv"],
    run: (match, ctx, tgSend) =>
      handleEtfDistributionCommand(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.ETFCORE,
    userErrorLabel: "ETF 적립형",
    tokens: ["etfcore"],
    run: (_match, ctx, tgSend) => handleEtfCoreCommand(ctx, tgSend),
  },
  {
    pattern: CMD.ETFTHEME,
    userErrorLabel: "ETF 테마형",
    tokens: ["etftheme"],
    run: (_match, ctx, tgSend) => handleEtfThemeCommand(ctx, tgSend),
  },
  {
    pattern: CMD.ETFHUB,
    userErrorLabel: "ETF 허브",
    tokens: ["etfhub", "이티에프허브", "etf허브"],
    run: (match, ctx, tgSend) => handleEtfHubCommand(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.ETF,
    userErrorLabel: "ETF 허브",
    tokens: ["etf", "이티에프"],
    run: (match, ctx, tgSend) => handleEtfHubCommand(match[2] ?? "", ctx, tgSend),
  },
];
