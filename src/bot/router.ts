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
import { setCommandsKo } from "../telegram/api";

export type ChatContext = { chatId: number; messageId?: number };

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
  UPDATE: /^\/update$/,
  COMMANDS: /^\/(commands|admin_commands)$/i,
  BUY: /^\/(buy|매수)(?:\s+(.+))?$/i,
  SEED: /^\/seed$/i, // 시드 명령어가 정규식 객체에 빠져있어서 추가함
};

export async function routeMessage(
  text: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  let t = (text || "").trim();

  t = t
    .replace(/\u00A0/g, " ")
    .replace(/\u200B/g, "")
    .replace(/\s+/g, " ");

  // /start
  if (CMD.START.test(t)) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.START,
    });
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

  // /update
  if (CMD.UPDATE.test(t)) {
    if (!isAdmin(ctx)) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "권한이 없습니다.",
      });
      return;
    }
    await tgSend("sendMessage", { chat_id: ctx.chatId, text: "갱신 시작…" });
    const [st, sc] = await Promise.all([
      callInternal("/api/update/stocks"),
      callInternal("/api/update/sectors"),
    ]);
    const b1 = st.body as any;
    const b2 = sc.body as any;
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `/update 결과\nstocks: ${st.status}\nsectors: ${sc.status}`,
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

  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: "알 수 없는 버튼입니다.",
  });
}
