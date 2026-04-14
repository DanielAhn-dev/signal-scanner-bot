import { KO_MESSAGES } from "./messages/ko";
import { handleBriefCommand } from "./commands/brief";
import { handleScoreCommand } from "./commands/score";
import { handleBuyCommand } from "./commands/buy";
import { handleSectorCommand } from "./commands/sector";
import { handleOnboardingCommand } from "./commands/onboarding";
import { handlePullbackCommand } from "./commands/pullback";
import { handleEconomyCommand } from "./commands/economy";
import { handleMarketCommand } from "./commands/market";

export type ChatContext = {
  chatId: number;
  messageId?: number;
};

// 텍스트 명령 패턴 (한글/영문 모두 지원)
const CMD = {
  START:      /^\/(start|시작|메뉴)$/i,
  HELP:       /^\/help$/i,
  BRIEF:      /^\/(brief|morning|브리핑|장전)$/i,
  SCORE:      /^\/(score|점수)\s+(.+)$/i,
  BUY:        /^\/(buy|매수)\s+(.+)$/i,
  SECTOR:     /^\/(sector|업종|테마)$/i,
  PULLBACK:   /^\/(pullback|눌림목)$/i,
  ECONOMY:    /^\/(economy|경제)$/i,
  MARKET:     /^\/(market|시장)$/i,
  ONBOARDING: /^\/(onboarding|시작하기|가이드)$/i,
};

const SEND_ERR = (cmd: string) =>
  `⚠️ ${cmd} 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.`;

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
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text:
        `<b>📈 Signal Scanner Bot</b>\n` +
        `잃지 않는 투자를 위한 실전 시장 분석 봇입니다.\n` +
        `\n` +
        `☀️ /brief — 장전 브리핑 (추천 종목·테마·시장)\n` +
        `📊 /sector — 주도 업종/테마 현황\n` +
        `🔍 /score [종목명/코드] — 종목 점수 분석\n` +
        `💰 /buy [종목명/코드] — 매수/매도가 분석\n` +
        `👀 /pullback — 눌림목 매집 후보\n` +
        `🌍 /economy — 글로벌 경제지표\n` +
        `📉 /market — 시장 현황\n` +
        `\n` +
        `도움말: /help`,
      parse_mode: "HTML",
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

  // 알 수 없는 명령
  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: KO_MESSAGES.UNKNOWN_COMMAND,
  });
}
