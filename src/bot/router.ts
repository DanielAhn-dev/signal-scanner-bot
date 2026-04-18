import { KO_MESSAGES } from "./messages/ko";
import { handleBriefCommand } from "./commands/brief";
import { handleBuyCommand } from "./commands/buy";
import { handleSectorCommand } from "./commands/sector";
import { handleOnboardingCommand } from "./commands/onboarding";
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
  handleWatchlistAutoCommand,
  handleWatchlistResponseCommand,
  handleWatchlistHistoryCommand,
  handleWatchlistLiquidateAllCommand,
} from "./commands/watchlist";
import { handleProfileCommand } from "./commands/profile";
import { handleRankingCommand } from "./commands/ranking";
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
  WATCHONLYLIST: /^\/(watchlist|관심)$/i,
  WATCHONLYADD:  /^\/(watchadd|관심추가)(?:\s+(.+))?$/i,
  WATCHONLYREMOVE:/^\/(watchremove|관심제거)(?:\s+(.+))?$/i,
  WATCHONLYRESET:/^\/(watchreset|관심초기화)(?:\s+(.+))?$/i,
  WATCHONLYRESP: /^\/(watchplan|관심대응)$/i,
  WATCHADD:    /^\/(paperbuy|가상매수)(?:\s+(.+))?$/i,
  WATCHREMOVE: /^\/(papersell|가상매도)(?:\s+(.+))?$/i,
  WATCHEDIT:   /^\/(holdingedit|보유수정)(?:\s+(.+))?$/i,
  WATCHAUTO:   /^\/(autosellcheck|자동매도점검)$/i,
  WATCHRESP:   /^\/(holdingplan|보유대응|관심대응)$/i,
  RECORD:      /^\/(tradelog|거래기록)(?:\s+(.+))?$/i,
  LIQUIDATEALL:/^\/(liquidateall|전체매도)(?:\s+(.+))?$/i,
  ALERT:       /^\/(alert|이상징후|알림)$/i,
  WATCHLIST:   /^\/(holdings|보유)$/i,
  AUTOCYCLE:   /^\/(autocycle|자동사이클)(?:\s+(.+))?$/i,
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
            `/brief — 장전 브리핑 + 내 보유 종목 점검`,
            `/sector — 주도 섹터와 대표 후보`,
            `/pullback — 눌림목 대기 후보`,
            `/관심 — 추이 관찰 종목 목록`,
            `/보유 — 가상 보유 포트폴리오`,
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
            { text: "브리핑", callback_data: "cmd:brief" },
            { text: "리포트 메뉴", callback_data: "cmd:report" },
            { text: "관심", callback_data: "cmd:watchonly" },
            { text: "보유", callback_data: "cmd:watchlist" },
            { text: "섹터", callback_data: "cmd:sector" },
            { text: "투자금 수정", callback_data: "prompt:capital" },
            { text: "가이드", callback_data: "cmd:onboarding" },
            { text: "프로필", callback_data: "cmd:profile" },
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

  // /brief — 실시간 장전 브리핑 (주도 테마, 추천 종목, 매수·관망 신호)
  if (CMD.BRIEF.test(t)) {
    try {
      await handleBriefCommand(ctx, tgSend);
    } catch (e) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: SEND_ERR("브리핑"),
      });
    }
    return;
  }

  // /report — 리포트 메뉴 및 PDF 생성
  const reportMatch = t.match(CMD.REPORT);
  if (reportMatch) {
    try {
      await handleReportCommand(ctx, tgSend, reportMatch[2]);
    } catch (e) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: SEND_ERR("리포트"),
      });
    }
    return;
  }

  if (CMD.GUIDEPDF.test(t)) {
    try {
      await handleReportCommand(ctx, tgSend, "가이드");
    } catch (e) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: SEND_ERR("가이드 PDF"),
      });
    }
    return;
  }

  // /help | /도움말
  if (CMD.HELP.test(t)) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.HELP,
    });
    return;
  }

  // /전략선택 — 위험 대응 전략 선택
  if (CMD.STRATEGY_SELECT.test(t)) {
    try {
      await handleStrategySelect(ctx, tgSend);
    } catch (e) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: SEND_ERR("전략 선택"),
      });
    }
    return;
  }

  // /onboarding — 사용 가이드
  if (CMD.ONBOARDING.test(t)) {
    await handleOnboardingCommand(ctx, tgSend);
    return;
  }

  // /sector — 주도 업종/테마
  if (CMD.SECTOR.test(t)) {
    try {
      await handleSectorCommand(ctx, tgSend);
    } catch (e) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: SEND_ERR("업종"),
      });
    }
    return;
  }

  // /pullback — 눌림목 매집 후보
  if (CMD.PULLBACK.test(t)) {
    try {
      await handlePullbackCommand(ctx, tgSend);
    } catch (e) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: SEND_ERR("눌림목"),
      });
    }
    return;
  }

  // /economy — 글로벌 경제지표
  if (CMD.ECONOMY.test(t)) {
    try {
      await handleEconomyCommand(ctx, tgSend);
    } catch (e) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: SEND_ERR("경제지표"),
      });
    }
    return;
  }

  // /market — 시장 현황
  if (CMD.MARKET.test(t)) {
    try {
      await handleMarketCommand(ctx, tgSend);
    } catch (e) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: SEND_ERR("시장"),
      });
    }
    return;
  }

  // /analyze | /종목분석 [종목명/코드] — 종목 분석
  const mt = t.match(CMD.TRADE);
  if (mt) {
    await handleBuyCommand(mt[2], ctx, tgSend);
    return;
  }

  // /stocks [섹터명] — 섹터별 대표 종목
  const mstocks = t.match(CMD.STOCKS);
  if (mstocks) {
    try {
      await handleStocksCommand(mstocks[2], ctx, tgSend);
    } catch (e) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: SEND_ERR("종목"),
      });
    }
    return;
  }

  // /scan — 눌림목 스캐너
  if (CMD.SCAN.test(t)) {
    try {
      const mscan = t.match(CMD.SCAN);
      await handleScanCommand(mscan?.[2] ?? "", ctx, tgSend);
    } catch (e) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: SEND_ERR("스캔"),
      });
    }
    return;
  }

  // /news — 시장·종목 뉴스
  if (CMD.NEWS.test(t)) {
    const mn = t.match(CMD.NEWS);
    await handleNewsCommand(mn?.[2] ?? "", ctx, tgSend);
    return;
  }

  // /flow — 외국인·기관 수급
  if (CMD.FLOW.test(t)) {
    try {
      const mflow = t.match(CMD.FLOW);
      await handleFlowCommand(mflow?.[2] ?? "", ctx, tgSend);
    } catch (e) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: SEND_ERR("수급"),
      });
    }
    return;
  }

  // /finance — 재무 요약
  if (CMD.FINANCE.test(t)) {
    const mf = t.match(CMD.FINANCE);
    await handleFinanceCommand(mf?.[2] ?? "", ctx, tgSend);
    return;
  }

  // /capital — 투자금 설정
  if (CMD.CAPITAL.test(t)) {
    const mc = t.match(CMD.CAPITAL);
    await handleCapitalCommand(mc?.[2] ?? "", ctx, tgSend);
    return;
  }

  if (CMD.WATCHONLYLIST.test(t)) {
    await handleWatchOnlyCommand(ctx, tgSend);
    return;
  }

  const mwatchAdd = t.match(CMD.WATCHONLYADD);
  if (mwatchAdd) {
    await handleWatchOnlyAdd(mwatchAdd[2] ?? "", ctx, tgSend);
    return;
  }

  const mwatchRemove = t.match(CMD.WATCHONLYREMOVE);
  if (mwatchRemove) {
    await handleWatchOnlyRemove(mwatchRemove[2] ?? "", ctx, tgSend);
    return;
  }

  const mwatchReset = t.match(CMD.WATCHONLYRESET);
  if (mwatchReset) {
    await handleWatchOnlyReset(mwatchReset[2] ?? "", ctx, tgSend);
    return;
  }

  if (CMD.WATCHONLYRESP.test(t)) {
    await handleWatchOnlyResponseCommand(ctx, tgSend);
    return;
  }

  const mwa = t.match(CMD.WATCHADD);
  if (mwa) {
    await handleWatchlistAdd(mwa[2] ?? "", ctx, tgSend);
    return;
  }

  const mwr = t.match(CMD.WATCHREMOVE);
  if (mwr) {
    await handleWatchlistRemove(mwr[2] ?? "", ctx, tgSend);
    return;
  }

  const mwe = t.match(CMD.WATCHEDIT);
  if (mwe) {
    await handleWatchlistEdit(mwe[2] ?? "", ctx, tgSend);
    return;
  }

  const mrecord = t.match(CMD.RECORD);
  if (mrecord) {
    await handleWatchlistHistoryCommand(mrecord[2] ?? "", ctx, tgSend);
    return;
  }

  const mLiquidateAll = t.match(CMD.LIQUIDATEALL);
  if (mLiquidateAll) {
    await handleWatchlistLiquidateAllCommand(mLiquidateAll[2] ?? "", ctx, tgSend);
    return;
  }

  if (CMD.WATCHAUTO.test(t)) {
    await handleWatchlistAutoCommand(ctx, tgSend);
    return;
  }

  if (CMD.WATCHRESP.test(t)) {
    await handleWatchlistResponseCommand(ctx, tgSend);
    return;
  }

  // /alert — 이상징후 점검
  if (CMD.ALERT.test(t)) {
    await handleAlertCommand(ctx, tgSend);
    return;
  }

  // /holdings | /보유 — 가상 보유 포트폴리오
  if (CMD.WATCHLIST.test(t)) {
    await handleWatchlistCommand(ctx, tgSend);
    return;
  }

  const mAutoCycle = t.match(CMD.AUTOCYCLE);
  if (mAutoCycle) {
    await handleAutoCycleCommand(mAutoCycle[2] ?? "", ctx, tgSend);
    return;
  }

  // /ranking — 포트폴리오 랭킹
  if (CMD.RANKING.test(t)) {
    await handleRankingCommand(ctx, tgSend);
    return;
  }

  // /profile — 내 프로필
  if (CMD.PROFILE.test(t)) {
    await handleProfileCommand(ctx, tgSend);
    return;
  }

  // /follow — 트레이더 팔로우
  const mfollow = t.match(CMD.FOLLOW);
  if (mfollow) {
    await handleFollowCommand(mfollow[2] ?? "", ctx, tgSend);
    return;
  }

  // /unfollow — 트레이더 언팔로우
  const munfollow = t.match(CMD.UNFOLLOW);
  if (munfollow) {
    await handleUnfollowCommand(munfollow[2] ?? "", ctx, tgSend);
    return;
  }

  // /feed — 팔로잉 피드
  if (CMD.FEED.test(t)) {
    await handleFeedCommand(ctx, tgSend);
    return;
  }

  // /nextsector — 수급 유입 섹터
  if (CMD.NEXTSECTOR.test(t)) {
    await handleNextSectorCommand(ctx, tgSend);
    return;
  }

  // /kospi — 코스피 보수형 추천
  if (CMD.KOSPI.test(t)) {
    try {
      await handleKospiCommand(ctx, tgSend);
    } catch (e) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: SEND_ERR("코스피"),
      });
    }
    return;
  }

  // /kosdaq — 코스닥 보수형 추천
  if (CMD.KOSDAQ.test(t)) {
    try {
      await handleKosdaqCommand(ctx, tgSend);
    } catch (e) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: SEND_ERR("코스닥"),
      });
    }
    return;
  }

  const metfInfo = t.match(CMD.ETFINFO);
  if (metfInfo) {
    try {
      await handleEtfInfoCommand(metfInfo[2] ?? "", ctx, tgSend);
    } catch (e) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: SEND_ERR("ETF 정보"),
      });
    }
    return;
  }

  const metfDiv = t.match(CMD.ETFDIV);
  if (metfDiv) {
    try {
      await handleEtfDistributionCommand(metfDiv[2] ?? "", ctx, tgSend);
    } catch (e) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: SEND_ERR("ETF 분배금"),
      });
    }
    return;
  }

  if (CMD.ETFCORE.test(t)) {
    try {
      await handleEtfCoreCommand(ctx, tgSend);
    } catch (e) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: SEND_ERR("ETF 적립형"),
      });
    }
    return;
  }

  if (CMD.ETFTHEME.test(t)) {
    try {
      await handleEtfThemeCommand(ctx, tgSend);
    } catch (e) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: SEND_ERR("ETF 테마형"),
      });
    }
    return;
  }

  const metfHub = t.match(CMD.ETFHUB);
  if (metfHub) {
    try {
      await handleEtfHubCommand(metfHub[2] ?? "", ctx, tgSend);
    } catch (e) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: SEND_ERR("ETF 허브"),
      });
    }
    return;
  }

  const metf = t.match(CMD.ETF);
  if (metf) {
    try {
      await handleEtfHubCommand(metf[2] ?? "", ctx, tgSend);
    } catch (e) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: SEND_ERR("ETF 허브"),
      });
    }
    return;
  }

  // 알 수 없는 명령
  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: KO_MESSAGES.UNKNOWN_COMMAND,
  });
}
