import { KO_MESSAGES } from "./messages/ko";
import { handleBriefCommand } from "./commands/brief";
import { handleBuyCommand } from "./commands/buy";
import { handleSectorCommand } from "./commands/sector";
import { handleOnboardingCommand, handleRiskProfileCommand } from "./commands/onboarding";
import { handlePullbackCommand } from "./commands/pullback";
import { handleAlertCommand } from "./commands/alert";
import { handleEconomyCommand } from "./commands/economy";
import { handleMarketCommand } from "./commands/market";
import { handleFinanceCommand } from "./commands/finance";
import { handleNewsCommand } from "./commands/news";
import { handleScanCommand } from "./commands/scan";
import { handleStocksCommand } from "./commands/stocks";
import { handleFlowCommand } from "./commands/flow";
import { handleNextSectorCommand } from "./commands/sector";
import { handleCapitalCommand } from "./commands/capital";
import { handleReportCommand } from "./commands/report";
import {
  handleKospiCommand,
  handleKosdaqCommand,
  handleEtfCoreCommand,
  handleEtfThemeCommand,
} from "./commands/marketPicks";
import {
  handleEtfDistributionCommand,
  handleEtfHubCommand,
  handleEtfInfoCommand,
} from "./commands/etf";
import { handleAutoCycleCommand } from "./commands/autoCycle";
import { handlePreMarketPlanCommand } from "./commands/preMarketPlan";
import { handleStrategySelect } from "./commands/strategySelect";
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
} from "./commands/watchlist";
import { handleProfileCommand } from "./commands/profile";
import { handleRankingCommand } from "./commands/ranking";
import { handleWeeklyCopilotCommand } from "./commands/weeklyCopilot";
import {
  handleFollowCommand,
  handleUnfollowCommand,
  handleFeedCommand,
} from "./commands/follow";
import { getUserInvestmentPrefs } from "../services/userService";
import { actionButtons } from "./messages/layout";

export type ChatContext = {
  chatId: number;
  messageId?: number;
  from?: any;
};

// 텍스트 명령 패턴 (한글/영문 모두 지원)
const CMD = {
  START:       /^\/(start|시작|메뉴)$/i,
  HELP:        /^\/(help|도움말)$/i,
  BRIEF:       /^\/(brief|morning|브리핑|장전)$/i,
  WEEKLY_COPILOT: /^\/(weekly|weeklycopilot|주간코파일럿)(?:\s+(.+))?$/i,
  REPORT:      /^\/(report|리포트)(?:\s+(.+))?$/i,
  GUIDEPDF:    /^\/(guidepdf|가이드pdf|운영가이드pdf)$/i,
  TRADE:       /^\/(analyze|종목분석)\s+(.+)$/i,
  SECTOR:      /^\/(sector|섹터|업종|테마)$/i,
  STOCKS:      /^\/(stocks|종목)\s+(.+)$/i,
  PULLBACK:    /^\/(pullback|눌림목)$/i,
  ECONOMY:     /^\/(economy|경제)$/i,
  MARKET:      /^\/(market|시장)$/i,
  ONBOARDING:  /^\/(onboarding|온보딩|시작하기|가이드)$/i,
  SCAN:        /^\/(scan|스캔)(?:\s+(.+))?$/i,
  NEWS:        /^\/(news|뉴스)(?:\s+(.+))?$/i,
  FLOW:        /^\/(flow|수급)(?:\s+(.+))?$/i,
  FINANCE:     /^\/(finance|재무)(?:\s+(.+))?$/i,
  CAPITAL:     /^\/(capital|투자금)(?:\s+(.+))?$/i,
  RISK_PROFILE:/^\/(투자성향|성향|risk|riskprofile)(?:\s+(.+))?$/i,
  WATCHONLYLIST: /^\/(watchlist|관심)$/i,
  WATCHONLYADD:  /^\/(watchadd|관심추가)(?:\s+(.+))?$/i,
  WATCHONLYREMOVE:/^\/(watchremove|관심제거)(?:\s+(.+))?$/i,
  WATCHONLYRESET:/^\/(watchreset|관심초기화)(?:\s+(.+))?$/i,
  WATCHONLYRESP: /^\/(watchplan|관심대응)$/i,
  WATCHADD:    /^\/(paperbuy|가상매수)(?:\s+(.+))?$/i,
  WATCHREMOVE: /^\/(papersell|가상매도)(?:\s+(.+))?$/i,
  WATCHEDIT:   /^\/(holdingedit|보유수정)(?:\s+(.+))?$/i,
  WATCHRESTORE:/^\/(holdingrestore|보유복구)(?:\s+(.+))?$/i,
  WATCHAUTO:   /^\/(autosellcheck|자동매도점검)$/i,
  WATCHRESP:   /^\/(holdingplan|보유대응|관심대응)$/i,
  RECORD:      /^\/(tradelog|거래기록)(?:\s+(.+))?$/i,
  LIQUIDATEALL:/^\/(liquidateall|전체매도)(?:\s+(.+))?$/i,
  ALERT:       /^\/(alert|이상징후|알림)$/i,
  WATCHLIST:   /^\/(holdings|보유)$/i,
  AUTOCYCLE:   /^\/(autocycle|자동사이클)(?:\s+(.+))?$/i,
  PREMARKET:   /^\/(premarket|장전플랜|직장인플랜|오늘주문)(?:\s+(.+))?$/i,
  RANKING:     /^\/(ranking|랭킹|순위)$/i,
  PROFILE:     /^\/(profile|프로필|내정보)$/i,
  FOLLOW:      /^\/(follow|팔로우)(?:\s+(.+))?$/i,
  UNFOLLOW:    /^\/(unfollow|언팔로우)(?:\s+(.+))?$/i,
  FEED:        /^\/(feed|피드)$/i,
  NEXTSECTOR:  /^\/(nextsector|다음섹터|수급섹터)$/i,
  KOSPI:       /^(?:\/)?(kospi|코스피)$/i,
  KOSDAQ:      /^(?:\/)?(kosdaq|코스닥)$/i,
  ETF:         /^(?:\/)?(etf|이티에프)(?:\s+(.+))?$/i,
  ETFHUB:      /^(?:\/)?(etfhub|이티에프허브|etf허브)(?:\s+(.+))?$/i,
  ETFCORE:     /^\/(etfcore)(?:\s+(.+))?$/i,
  ETFTHEME:    /^\/(etftheme)(?:\s+(.+))?$/i,
  ETFINFO:     /^\/(etfinfo)(?:\s+(.+))?$/i,
  ETFDIV:      /^\/(etfdiv)(?:\s+(.+))?$/i,
  STRATEGY_SELECT: /^\/(전략선택|strategy)$/i,
};

const SEND_ERR = (cmd: string) =>
  `⚠️ ${cmd} 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.`;

async function runWithUserError(
  ctx: ChatContext,
  tgSend: any,
  commandLabel: string,
  run: () => Promise<void>
): Promise<void> {
  try {
    await run();
  } catch {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: SEND_ERR(commandLabel),
    });
  }
}

type CommandRouteHandler = (
  match: RegExpMatchArray,
  ctx: ChatContext,
  tgSend: any
) => Promise<void>;

type CommandRouteSpec = {
  pattern: RegExp;
  run: CommandRouteHandler;
  userErrorLabel?: string;
};

const COMMAND_ROUTE_SPECS: CommandRouteSpec[] = [
  {
    pattern: CMD.WEEKLY_COPILOT,
    userErrorLabel: "주간 코파일럿",
    run: (match, ctx, tgSend) =>
      handleWeeklyCopilotCommand(ctx, tgSend, match[2] ?? ""),
  },
  {
    pattern: CMD.BRIEF,
    userErrorLabel: "브리핑",
    run: (_match, ctx, tgSend) => handleBriefCommand(ctx, tgSend),
  },
  {
    pattern: CMD.PREMARKET,
    userErrorLabel: "장전 주문 플랜",
    run: (_match, ctx, tgSend) => handlePreMarketPlanCommand("", ctx, tgSend),
  },
  {
    pattern: CMD.REPORT,
    userErrorLabel: "리포트",
    run: (match, ctx, tgSend) => handleReportCommand(ctx, tgSend, match[2]),
  },
  {
    pattern: CMD.GUIDEPDF,
    userErrorLabel: "가이드 PDF",
    run: (_match, ctx, tgSend) => handleReportCommand(ctx, tgSend, "가이드"),
  },
  {
    pattern: CMD.HELP,
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
    run: (_match, ctx, tgSend) => handleStrategySelect(ctx, tgSend),
  },
  {
    pattern: CMD.ONBOARDING,
    run: (_match, ctx, tgSend) => handleOnboardingCommand(ctx, tgSend),
  },
  {
    pattern: CMD.SECTOR,
    userErrorLabel: "업종",
    run: (_match, ctx, tgSend) => handleSectorCommand(ctx, tgSend),
  },
  {
    pattern: CMD.PULLBACK,
    userErrorLabel: "눌림목",
    run: (_match, ctx, tgSend) => handlePullbackCommand(ctx, tgSend),
  },
  {
    pattern: CMD.ECONOMY,
    userErrorLabel: "경제지표",
    run: (_match, ctx, tgSend) => handleEconomyCommand(ctx, tgSend),
  },
  {
    pattern: CMD.MARKET,
    userErrorLabel: "시장",
    run: (_match, ctx, tgSend) => handleMarketCommand(ctx, tgSend),
  },
  {
    pattern: CMD.TRADE,
    run: (match, ctx, tgSend) => handleBuyCommand(match[2], ctx, tgSend),
  },
  {
    pattern: CMD.STOCKS,
    userErrorLabel: "종목",
    run: (match, ctx, tgSend) => handleStocksCommand(match[2], ctx, tgSend),
  },
  {
    pattern: CMD.SCAN,
    userErrorLabel: "스캔",
    run: (match, ctx, tgSend) => handleScanCommand(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.NEWS,
    run: (match, ctx, tgSend) => handleNewsCommand(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.FLOW,
    userErrorLabel: "수급",
    run: (match, ctx, tgSend) => handleFlowCommand(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.FINANCE,
    run: (match, ctx, tgSend) => handleFinanceCommand(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.CAPITAL,
    run: (match, ctx, tgSend) => handleCapitalCommand(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.RISK_PROFILE,
    run: (match, ctx, tgSend) => handleRiskProfileCommand(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.WATCHONLYLIST,
    run: (_match, ctx, tgSend) => handleWatchOnlyCommand(ctx, tgSend),
  },
  {
    pattern: CMD.WATCHONLYADD,
    run: (match, ctx, tgSend) => handleWatchOnlyAdd(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.WATCHONLYREMOVE,
    run: (match, ctx, tgSend) => handleWatchOnlyRemove(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.WATCHONLYRESET,
    run: (match, ctx, tgSend) => handleWatchOnlyReset(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.WATCHONLYRESP,
    run: (_match, ctx, tgSend) => handleWatchOnlyResponseCommand(ctx, tgSend),
  },
  {
    pattern: CMD.WATCHADD,
    run: (match, ctx, tgSend) => handleWatchlistAdd(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.WATCHREMOVE,
    run: (match, ctx, tgSend) => handleWatchlistRemove(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.WATCHEDIT,
    run: (match, ctx, tgSend) => handleWatchlistEdit(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.WATCHRESTORE,
    run: (match, ctx, tgSend) => handleWatchlistRestoreCommand(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.RECORD,
    run: (match, ctx, tgSend) => handleWatchlistHistoryCommand(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.LIQUIDATEALL,
    run: (match, ctx, tgSend) =>
      handleWatchlistLiquidateAllCommand(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.WATCHAUTO,
    run: (_match, ctx, tgSend) => handleWatchlistAutoCommand(ctx, tgSend),
  },
  {
    pattern: CMD.WATCHRESP,
    run: (_match, ctx, tgSend) => handleWatchlistResponseCommand(ctx, tgSend),
  },
  {
    pattern: CMD.ALERT,
    run: (_match, ctx, tgSend) => handleAlertCommand(ctx, tgSend),
  },
  {
    pattern: CMD.WATCHLIST,
    run: (_match, ctx, tgSend) => handleWatchlistCommand(ctx, tgSend),
  },
  {
    pattern: CMD.AUTOCYCLE,
    run: (match, ctx, tgSend) => handleAutoCycleCommand(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.RANKING,
    run: (_match, ctx, tgSend) => handleRankingCommand(ctx, tgSend),
  },
  {
    pattern: CMD.PROFILE,
    run: (_match, ctx, tgSend) => handleProfileCommand(ctx, tgSend),
  },
  {
    pattern: CMD.FOLLOW,
    run: (match, ctx, tgSend) => handleFollowCommand(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.UNFOLLOW,
    run: (match, ctx, tgSend) => handleUnfollowCommand(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.FEED,
    run: (_match, ctx, tgSend) => handleFeedCommand(ctx, tgSend),
  },
  {
    pattern: CMD.NEXTSECTOR,
    run: (_match, ctx, tgSend) => handleNextSectorCommand(ctx, tgSend),
  },
  {
    pattern: CMD.KOSPI,
    userErrorLabel: "코스피",
    run: (_match, ctx, tgSend) => handleKospiCommand(ctx, tgSend),
  },
  {
    pattern: CMD.KOSDAQ,
    userErrorLabel: "코스닥",
    run: (_match, ctx, tgSend) => handleKosdaqCommand(ctx, tgSend),
  },
  {
    pattern: CMD.ETFINFO,
    userErrorLabel: "ETF 정보",
    run: (match, ctx, tgSend) => handleEtfInfoCommand(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.ETFDIV,
    userErrorLabel: "ETF 분배금",
    run: (match, ctx, tgSend) =>
      handleEtfDistributionCommand(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.ETFCORE,
    userErrorLabel: "ETF 적립형",
    run: (_match, ctx, tgSend) => handleEtfCoreCommand(ctx, tgSend),
  },
  {
    pattern: CMD.ETFTHEME,
    userErrorLabel: "ETF 테마형",
    run: (_match, ctx, tgSend) => handleEtfThemeCommand(ctx, tgSend),
  },
  {
    pattern: CMD.ETFHUB,
    userErrorLabel: "ETF 허브",
    run: (match, ctx, tgSend) => handleEtfHubCommand(match[2] ?? "", ctx, tgSend),
  },
  {
    pattern: CMD.ETF,
    userErrorLabel: "ETF 허브",
    run: (match, ctx, tgSend) => handleEtfHubCommand(match[2] ?? "", ctx, tgSend),
  },
];

async function dispatchCommandRoutes(
  text: string,
  ctx: ChatContext,
  tgSend: any
): Promise<boolean> {
  for (const route of COMMAND_ROUTE_SPECS) {
    const match = text.match(route.pattern);
    if (!match) continue;

    if (route.userErrorLabel) {
      await runWithUserError(ctx, tgSend, route.userErrorLabel, () =>
        route.run(match, ctx, tgSend)
      );
    } else {
      await route.run(match, ctx, tgSend);
    }

    return true;
  }

  return false;
}

function riskProfileLabel(profile?: "safe" | "balanced" | "active"): string {
  if (profile === "balanced") return "균형형";
  if (profile === "active") return "공격형";
  return "안전형";
}

// router.ts는 수동 텍스트 명령만 처리합니다.
// 아침 자동 브리핑(장전 오전 8시)은 api/cron/briefing.ts 에서 처리합니다.
export async function routeMessage(
  text: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const t = (text || "")
    .trim()
    .replace(/^\/([^@\s]+)@[^\s]+(?=\s|$)/, "/$1");

  // /start — 환영 및 안내
  if (CMD.START.test(t)) {
    const prefs = await getUserInvestmentPrefs(ctx.from?.id ?? ctx.chatId);
    const hasSetup = Boolean(prefs.capital_krw);

    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: hasSetup
        ? [
            `<b>Signal Scanner Bot</b>`,
            `보수적으로 후보를 압축하고, 종목별 진입 구간만 짧게 보여주는 투자 봇입니다.`,
            ``,
            `현재 설정`,
            `투자성향: ${riskProfileLabel(prefs.risk_profile)}`,
            `투자금: ${(prefs.capital_krw || 0).toLocaleString("ko-KR")}원`,
            ``,
            `/주간코파일럿 — 이번 주 실행 흐름 한번에 진행`,
            `/brief — 장전 브리핑 + 내 보유 종목 점검`,
            `/sector — 주도 섹터와 대표 후보`,
            `/pullback — 눌림목 대기 후보`,
            `/관심 — 추이 관찰 종목 목록`,
            `/보유 — 가상 보유 포트폴리오`,
            `/장전플랜 — 9시 전 예약 주문용 후보/수량/매도가`,
            ``,
            `도움말: /help`,
          ].join("\n")
        : [
            `<b>Signal Scanner Bot</b>`,
            `잃지 않는 투자에 맞춰 KOSPI 중심 후보를 압축해드립니다.`,
            ``,
            `먼저 2가지만 정하면 추천이 바로 개인화됩니다.`,
            `1. 투자성향 저장`,
            `2. 투자금 입력`,
            ``,
            `설정 후 /brief 에서 보유 종목과 추천 후보를 함께 점검할 수 있습니다.`,
          ].join("\n"),
      parse_mode: "HTML",
      reply_markup: hasSetup
        ? actionButtons([
            { text: "주간 코파일럿", callback_data: "cmd:weeklycopilot" },
            { text: "장전플랜", callback_data: "cmd:premarket" },
            { text: "보유대응", callback_data: "cmd:watchresp" },
            { text: "자동 점검", callback_data: "cmd:autocycle:check" },
            { text: "자동 실행", callback_data: "cmd:autocycle:run" },
            { text: "설정 가이드", callback_data: "cmd:onboarding" },
          ], 2)
        : actionButtons([
            { text: "안전형", callback_data: "risk:safe" },
            { text: "균형형", callback_data: "risk:balanced" },
            { text: "공격형", callback_data: "risk:active" },
            { text: "투자금 입력", callback_data: "prompt:capital" },
            { text: "가이드", callback_data: "cmd:onboarding" },
            { text: "브리핑", callback_data: "cmd:brief" },
          ], 2),
    });
    return;
  }

  const handled = await dispatchCommandRoutes(t, ctx, tgSend);
  if (handled) return;

  // 알 수 없는 명령
  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: KO_MESSAGES.UNKNOWN_COMMAND,
  });
}
