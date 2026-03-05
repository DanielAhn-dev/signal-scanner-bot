import { KO_MESSAGES } from "./messages/ko";
import {
  handleSectorCommand,
  handleNextSectorCommand,
} from "./commands/sector";
import { handleScoreCommand } from "./commands/score";
import { handleBuyCommand } from "./commands/buy";
import { handleStocksCommand } from "./commands/stocks";
import { handleScanCommand } from "./commands/scan";
import { resolveBase } from "../lib/base";
import { getLeadersForSectorById } from "../data/sector";
import { createMultiRowKeyboard } from "../telegram/keyboards";
import { handleBriefCommand } from "./commands/brief";
import { handlePullbackCommand } from "./commands/pullback";
import {
  handleWatchlistCommand,
  handleWatchlistAdd,
  handleWatchlistRemove,
  handleWatchlistEdit,
  handleWatchlistQuickAdd,
} from "./commands/watchlist";
import { handleFlowCommand } from "./commands/flow";
import { handleEconomyCommand } from "./commands/economy";
import { handleNewsCommand } from "./commands/news";
import { handleMarketCommand } from "./commands/market";
import { handleProfileCommand } from "./commands/profile";
import { handleRankingCommand } from "./commands/ranking";
import {
  handleFollowCommand,
  handleUnfollowCommand,
  handleFeedCommand,
} from "./commands/follow";
import { setCommandsKo } from "../telegram/api";
import {
  ensureUser,
  logActivity,
  type TelegramFrom,
} from "../services/userService";

export type ChatContext = {
  chatId: number;
  messageId?: number;
  from?: TelegramFrom;
};

// 내부 POST 호출(강제 타임아웃 포함)
async function callInternal(path: string, ms = 8000) {
  const base = resolveBase(process.env);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);

  try {
    const secret = process.env.CRON_SECRET!;

    const r = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "x-internal-secret": secret,
        "x-cron-secret": secret,
        "x-telegram-bot-secret": process.env.TELEGRAM_BOT_SECRET ?? secret,
      },
      signal: ctrl.signal,
    });

    const body = await r.json().catch(() => ({}));
    return { status: r.status, body };
  } catch (e: any) {
    return { status: 0, body: { ok: false, error: e?.message || "timeout" } };
  } finally {
    clearTimeout(timer);
  }
}

// 권한 체크
function isAdmin(ctx: ChatContext) {
  return String(ctx.chatId) === process.env.TELEGRAM_ADMIN_CHAT_ID;
}

// 명령어 패턴
const CMD = {
  START: /^\/start$/,
  HELP: /^\/help$/,
  SECTOR: /^\/(sector|sectors|섹터)(?:\s+|$)(?:.*)?$/i,
  NEXT_SECTOR: /^\/(nextsector|flowsector|다음섹터)(?:\s+|$)(?:.*)?$/i,
  SCORE: /^\/(score|점수)\s+(.+)$/i,
  STOCKS: /^\/(stocks|종목)(?:\s+(.+))?$/i,
  SCAN: /^\/(scan|스캔)(?:\s+(.+))?$/i,
  UPDATE: /^\/(update|갱신)$/i,
  COMMANDS: /^\/(commands|admin_commands)$/i,
  BUY: /^\/(buy|매수)(?:\s+(.+))?$/i,
  SEED: /^\/seed$/i,
  BRIEF: /^\/(brief|morning|브리핑|장전)$/i,
  PULLBACK: /^\/(pullback|눌림목|매집)$/i,
  WATCHLIST: /^\/(watchlist|관심)$/i,
  WATCHLIST_ADD: /^\/(watchlistadd|관심추가)(?:\s+(.+))?$/i,
  WATCHLIST_DEL: /^\/(watchlistdel|관심삭제)(?:\s+(.+))?$/i,
  WATCHLIST_EDIT: /^\/(watchlistedit|관심수정)(?:\s+(.+))?$/i,
  FLOW: /^\/(flow|수급)(?:\s+(.+))?$/i,
  ECONOMY: /^\/(economy|경제|지표)$/i,
  NEWS: /^\/(news|뉴스)(?:\s+(.+))?$/i,
  MARKET: /^\/(market|시장|진단)$/i,
  PROFILE: /^\/(profile|프로필)$/i,
  RANKING: /^\/(ranking|랭킹)$/i,
  FOLLOW: /^\/(follow|팔로우)(?:\s+(.+))?$/i,
  UNFOLLOW: /^\/(unfollow|언팔로우)(?:\s+(.+))?$/i,
  FEED: /^\/(feed|피드)$/i,
};

export async function routeMessage(
  text: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  let t = (text || "")
    .trim()
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ");

  // 사용자 추적 (fire & forget)
  if (ctx.from) {
    const cmd = (t.match(/^\/([^\s@]+)/) || [])[1] || "msg";
    Promise.all([
      ensureUser(ctx.from),
      logActivity(ctx.from.id, cmd),
    ]).catch(() => {});
  }

  // /start — 환영 + 사용자 등록 (ensureUser는 middleware에서 이미 호출)
  if (CMD.START.test(t)) {
    const name = ctx.from?.first_name || "";
    const greeting = name ? `안녕하세요, ${name}님! ` : "";
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `${greeting}${KO_MESSAGES.START}`,
    });
    return;
  }

  // [신규] /brief 장전 브리핑
  if (CMD.BRIEF.test(t)) {
    try {
      await handleBriefCommand(ctx, tgSend);
    } catch (e) {
      console.error("handleBriefCommand failed:", e);
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "브리핑 생성 실패",
      });
    }
    return;
  }

  // /pullback 눌림목 매집 시그널
  if (CMD.PULLBACK.test(t)) {
    try {
      await handlePullbackCommand(ctx, tgSend);
    } catch (e) {
      console.error("handlePullbackCommand failed:", e);
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "눌림목 분석 실패",
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

  // /commands
  if (CMD.COMMANDS.test(t)) {
    if (!isAdmin(ctx)) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "권한이 없습니다.",
      });
      return;
    }
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "텔레그램 명령어를 갱신합니다…",
    });
    const res = await setCommandsKo();
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: res?.ok ? "명령어 갱신 완료 ✅" : "명령어 갱신 실패 ❌",
    });
    return;
  }

  // /sector
  if (CMD.SECTOR.test(t)) {
    try {
      await handleSectorCommand(ctx, tgSend);
    } catch (e) {
      console.error("handleSectorCommand failed:", e);
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: KO_MESSAGES.SECTOR_ERROR,
      });
    }
    return;
  }

  // /nextsector
  if (CMD.NEXT_SECTOR.test(t)) {
    try {
      await handleNextSectorCommand(ctx, tgSend);
    } catch (e) {
      console.error("handleNextSectorCommand failed:", e);
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "섹터 수급 분석 중 오류가 발생했습니다.",
      });
    }
    return;
  }

  // /stocks
  const ms = t.match(CMD.STOCKS);
  if (ms) {
    const sectorName = (ms[2] || "").trim();
    if (!sectorName) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "사용법: /stocks <섹터명>\n예) /stocks 반도체\n예) /종목 자동차",
      });
      return;
    }
    try {
      await handleStocksCommand(sectorName, ctx, tgSend);
    } catch (e) {
      console.error("handleStocksCommand failed:", e);
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "종목 조회 중 오류가 발생했습니다.",
      });
    }
    return;
  }

  // /scan
  const mScan = t.match(CMD.SCAN);
  if (mScan) {
    const query = (mScan[2] || "").trim(); // '반도체' 등 옵션
    try {
      await handleScanCommand(query, ctx, tgSend);
    } catch (e) {
      console.error("handleScanCommand failed:", e);
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "스캔 중 오류가 발생했습니다.",
      });
    }
    return;
  }

  // /seed
  if (CMD.SEED.test(t)) {
    if (!isAdmin(ctx)) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "권한이 없습니다.",
      });
      return;
    }
    await tgSend("sendMessage", { chat_id: ctx.chatId, text: "시드 시작…" });
    const st = await callInternal("/api/seed/stocks");
    const b = st.body as { ok?: boolean; count?: number; error?: string };
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `stocks: ${st.status} count=${b.count ?? "-"} ${
        b.error ? `err=${b.error}` : ""
      }`.trim(),
    });
    return;
  }

  // /update — 종목/섹터 메타데이터 갱신
  if (CMD.UPDATE.test(t)) {
    if (!isAdmin(ctx)) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "권한이 없습니다.",
      });
      return;
    }
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "📡 종목/섹터 메타데이터 갱신 시작…\n(KRX 다운로드 포함, 최대 30초 소요)",
    });

    const startMs = Date.now();
    const [st, sc] = await Promise.all([
      callInternal("/api/update/stocks", 30000),
      callInternal("/api/update/sectors", 15000),
    ]);

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    const b1 = st.body as any;
    const b2 = sc.body as any;

    const lines: string[] = [`<b>📋 /update 결과</b> (${elapsed}s)\n`];

    // Stocks 결과
    if (st.status === 200 && !b1.error) {
      lines.push(`<b>종목</b> ✅ ${b1.total ?? 0}개`);
      if (b1.inserted > 0 || b1.updated > 0) {
        lines.push(`  신규 ${b1.inserted ?? 0} · 변경 ${b1.updated ?? 0}`);
      } else {
        lines.push(`  변경 없음 (최신 상태)`);
      }
    } else {
      lines.push(`<b>종목</b> ❌ ${b1.error || `HTTP ${st.status}`}`);
    }

    // Sectors 결과
    if (sc.status === 200 && !b2.error) {
      lines.push(`\n<b>섹터</b> ✅ ${b2.total ?? 0}개`);
      if (b2.inserted > 0 || b2.updated > 0) {
        lines.push(`  신규 ${b2.inserted ?? 0} · 변경 ${b2.updated ?? 0}`);
      } else {
        lines.push(`  변경 없음 (최신 상태)`);
      }
    } else {
      lines.push(`\n<b>섹터</b> ❌ ${b2.error || `HTTP ${sc.status}`}`);
    }

    // 안내
    lines.push(`\n<i>💡 시세/지표/점수 갱신은 GitHub Actions daily_batch 참조</i>`);

    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: lines.join("\n"),
      parse_mode: "HTML",
    });
    return;
  }

  // /buy
  const mb = t.match(CMD.BUY);
  if (mb) {
    await handleBuyCommand(mb[2] || "", ctx, tgSend);
    return;
  }

  // /score
  const m = t.match(CMD.SCORE);
  if (m) {
    await handleScoreCommand(m[2], ctx, tgSend);
    return;
  }

  // /watchlist 관심종목
  if (CMD.WATCHLIST.test(t)) {
    await handleWatchlistCommand(ctx, tgSend);
    return;
  }

  // /watchlistadd 관심추가
  const mwa = t.match(CMD.WATCHLIST_ADD);
  if (mwa) {
    await handleWatchlistAdd(mwa[2] || "", ctx, tgSend);
    return;
  }

  // /watchlistdel 관심삭제
  const mwd = t.match(CMD.WATCHLIST_DEL);
  if (mwd) {
    await handleWatchlistRemove(mwd[2] || "", ctx, tgSend);
    return;
  }

  // /watchlistedit 관심수정
  const mwe = t.match(CMD.WATCHLIST_EDIT);
  if (mwe) {
    await handleWatchlistEdit(mwe[2] || "", ctx, tgSend);
    return;
  }

  // /flow 수급
  const mFlow = t.match(CMD.FLOW);
  if (mFlow) {
    try {
      await handleFlowCommand(mFlow[2] || "", ctx, tgSend);
    } catch (e) {
      console.error("handleFlowCommand failed:", e);
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "수급 조회 중 오류가 발생했습니다.",
      });
    }
    return;
  }

  // /economy 경제
  if (CMD.ECONOMY.test(t)) {
    try {
      await handleEconomyCommand(ctx, tgSend);
    } catch (e) {
      console.error("handleEconomyCommand failed:", e);
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "경제지표 조회 중 오류가 발생했습니다.",
      });
    }
    return;
  }

  // /news 뉴스
  const mNews = t.match(CMD.NEWS);
  if (mNews) {
    try {
      await handleNewsCommand(mNews[2] || "", ctx, tgSend);
    } catch (e) {
      console.error("handleNewsCommand failed:", e);
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "뉴스 조회 중 오류가 발생했습니다.",
      });
    }
    return;
  }

  // /market 시장진단
  if (CMD.MARKET.test(t)) {
    try {
      await handleMarketCommand(ctx, tgSend);
    } catch (e) {
      console.error("handleMarketCommand failed:", e);
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "시장 진단 중 오류가 발생했습니다.",
      });
    }
    return;
  }

  // /프로필
  if (CMD.PROFILE.test(t)) {
    try {
      await handleProfileCommand(ctx, tgSend);
    } catch (e) {
      console.error("handleProfileCommand failed:", e);
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "프로필 조회 중 오류가 발생했습니다.",
      });
    }
    return;
  }

  // /랭킹
  if (CMD.RANKING.test(t)) {
    try {
      await handleRankingCommand(ctx, tgSend);
    } catch (e) {
      console.error("handleRankingCommand failed:", e);
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "랭킹 조회 중 오류가 발생했습니다.",
      });
    }
    return;
  }

  // /팔로우
  const mFollow = t.match(CMD.FOLLOW);
  if (mFollow) {
    try {
      await handleFollowCommand(mFollow[2] || "", ctx, tgSend);
    } catch (e) {
      console.error("handleFollowCommand failed:", e);
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "팔로우 처리 중 오류가 발생했습니다.",
      });
    }
    return;
  }

  // /언팔로우
  const mUnfollow = t.match(CMD.UNFOLLOW);
  if (mUnfollow) {
    try {
      await handleUnfollowCommand(mUnfollow[2] || "", ctx, tgSend);
    } catch (e) {
      console.error("handleUnfollowCommand failed:", e);
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "언팔로우 처리 중 오류가 발생했습니다.",
      });
    }
    return;
  }

  // /피드
  if (CMD.FEED.test(t)) {
    try {
      await handleFeedCommand(ctx, tgSend);
    } catch (e) {
      console.error("handleFeedCommand failed:", e);
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "피드 조회 중 오류가 발생했습니다.",
      });
    }
    return;
  }

  // unknown
  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: KO_MESSAGES.UNKNOWN_COMMAND,
  });
}

export async function routeCallback(
  data: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  // 섹터 버튼
  if (data.startsWith("KRX:")) {
    const sectorId = data;
    const leaders = await getLeadersForSectorById(sectorId, 10);

    if (!leaders.length) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "해당 섹터에 속한 종목이 없습니다.",
      });
      return;
    }

    const btns = leaders.slice(0, 10).map((s) => ({
      text: s.name,
      callback_data: `score:${s.code}`,
    }));

    const keyboard = createMultiRowKeyboard(2, btns);
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "종목을 선택하여 점수를 확인하세요.",
      reply_markup: keyboard,
    });
    return;
  }

  if (data.startsWith("score:")) {
    const [, code] = data.split(":");
    if (code) await handleScoreCommand(code, ctx, tgSend);
    return;
  }

  if (data.startsWith("buy:")) {
    const [, code] = data.split(":");
    if (code) await handleBuyCommand(code, ctx, tgSend);
    return;
  }

  if (data.startsWith("watchadd:")) {
    const [, code] = data.split(":");
    if (code) await handleWatchlistQuickAdd(code, ctx, tgSend);
    return;
  }

  if (data.startsWith("news:")) {
    const [, code] = data.split(":");
    if (code) await handleNewsCommand(code, ctx, tgSend);
    return;
  }

  if (data.startsWith("flow:")) {
    const [, code] = data.split(":");
    if (code) await handleFlowCommand(code, ctx, tgSend);
    return;
  }

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: "알 수 없는 버튼입니다.",
  });
}
