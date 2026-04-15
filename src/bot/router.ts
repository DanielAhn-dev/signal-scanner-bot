import { KO_MESSAGES } from "./messages/ko";
import { handleBriefCommand } from "./commands/brief";
import { handleScoreCommand } from "./commands/score";
import { handleBuyCommand } from "./commands/buy";
import { handleSectorCommand } from "./commands/sector";
import { handleOnboardingCommand } from "./commands/onboarding";
import { handlePullbackCommand } from "./commands/pullback";
import { handleEconomyCommand } from "./commands/economy";
import { handleMarketCommand } from "./commands/market";
import { handleFinanceCommand } from "./commands/finance";
import { handleNewsCommand } from "./commands/news";
import { handleScanCommand } from "./commands/scan";
import { handleFlowCommand } from "./commands/flow";
import { handleNextSectorCommand } from "./commands/sector";
import { handleCapitalCommand } from "./commands/capital";
import { handleReportCommand } from "./commands/report";
import {
  handleKospiCommand,
  handleKosdaqCommand,
  handleEtfCommand,
} from "./commands/marketPicks";
import {
  handleWatchlistCommand,
  handleWatchlistAdd,
  handleWatchlistRemove,
  handleWatchlistEdit,
  handleWatchlistAutoCommand,
  handleWatchlistResponseCommand,
  handleWatchlistHistoryCommand,
} from "./commands/watchlist";
import { handleProfileCommand } from "./commands/profile";
import { handleRankingCommand } from "./commands/ranking";
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
  HELP:        /^\/help$/i,
  BRIEF:       /^\/(brief|morning|브리핑|장전)$/i,
  REPORT:      /^\/(report|리포트)$/i,
  SCORE:       /^\/(score|점수)\s+(.+)$/i,
  BUY:         /^\/(buy|매수)\s+(.+)$/i,
  SECTOR:      /^\/(sector|업종|테마)$/i,
  PULLBACK:    /^\/(pullback|눌림목)$/i,
  ECONOMY:     /^\/(economy|경제)$/i,
  MARKET:      /^\/(market|시장)$/i,
  ONBOARDING:  /^\/(onboarding|시작하기|가이드)$/i,
  SCAN:        /^\/(scan|스캔)(?:\s+(.+))?$/i,
  NEWS:        /^\/(news|뉴스)(?:\s+(.+))?$/i,
  FLOW:        /^\/(flow|수급)(?:\s+(.+))?$/i,
  FINANCE:     /^\/(finance|재무)(?:\s+(.+))?$/i,
  CAPITAL:     /^\/(capital|투자금)(?:\s+(.+))?$/i,
  WATCHADD:    /^\/(watchadd|관심추가)(?:\s+(.+))?$/i,
  WATCHREMOVE: /^\/(watchremove|관심삭제)(?:\s+(.+))?$/i,
  WATCHEDIT:   /^\/(watchedit|관심수정)(?:\s+(.+))?$/i,
  WATCHAUTO:   /^\/(watchauto|관심자동)$/i,
  WATCHRESP:   /^\/(watchrespond|관심대응)$/i,
  RECORD:      /^\/(record|기록)(?:\s+(.+))?$/i,
  ALERT:       /^\/(alert|이상징후|알림)$/i,
  WATCHLIST:   /^\/(watchlist|관심종목|관심)$/i,
  RANKING:     /^\/(ranking|랭킹|순위)$/i,
  PROFILE:     /^\/(profile|프로필|내정보)$/i,
  FOLLOW:      /^\/(follow|팔로우)(?:\s+(.+))?$/i,
  FEED:        /^\/(feed|피드)$/i,
  NEXTSECTOR:  /^\/(nextsector|다음섹터|수급섹터)$/i,
  KOSPI:       /^\/(kospi|코스피)$/i,
  KOSDAQ:      /^\/(kosdaq|코스닥)$/i,
  ETF:         /^\/(etf)$/i,
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
  const t = (text || "").trim();

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
            `/brief — 장전 브리핑 + 내 관심종목 점검`,
            `/sector — 주도 섹터와 대표 후보`,
            `/pullback — 눌림목 대기 후보`,
            `/watchlist — 관심종목 포트폴리오`,
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
            `설정 후 /brief 에서 관심종목과 추천 후보를 함께 점검할 수 있습니다.`,
          ].join("\n"),
      parse_mode: "HTML",
      reply_markup: hasSetup
        ? actionButtons([
            { text: "브리핑", callback_data: "cmd:brief" },
            { text: "주간 리포트", callback_data: "cmd:report" },
            { text: "관심종목", callback_data: "cmd:watchlist" },
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

  // /report — 주간 PDF 리포트
  if (CMD.REPORT.test(t)) {
    try {
      await handleReportCommand(ctx, tgSend);
    } catch (e) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: SEND_ERR("리포트"),
      });
    }
    return;
  }

  // /help
  if (CMD.HELP.test(t)) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.HELP,
    });
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

  // /score [종목명/코드]
  const ms = t.match(CMD.SCORE);
  if (ms) {
    await handleScoreCommand(ms[2], ctx, tgSend);
    return;
  }

  // /buy [종목명/코드]
  const mb = t.match(CMD.BUY);
  if (mb) {
    await handleBuyCommand(mb[2], ctx, tgSend);
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
    await tgSend("sendMessage", { chat_id: ctx.chatId, text: "🔧 /alert 이상징후 점검 기능은 현재 준비 중입니다." });
    return;
  }

  // /watchlist — 관심종목
  if (CMD.WATCHLIST.test(t)) {
    await handleWatchlistCommand(ctx, tgSend);
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
  if (CMD.FOLLOW.test(t)) {
    await tgSend("sendMessage", { chat_id: ctx.chatId, text: "🔧 /follow 팔로우 기능은 현재 준비 중입니다." });
    return;
  }

  // /feed — 팔로잉 피드
  if (CMD.FEED.test(t)) {
    await tgSend("sendMessage", { chat_id: ctx.chatId, text: "🔧 /feed 팔로잉 피드 기능은 현재 준비 중입니다." });
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

  // /etf — ETF 보수형 추천
  if (CMD.ETF.test(t)) {
    try {
      await handleEtfCommand(ctx, tgSend);
    } catch (e) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: SEND_ERR("ETF"),
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
