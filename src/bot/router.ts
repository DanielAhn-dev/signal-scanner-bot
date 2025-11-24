import { KO_MESSAGES } from "./messages/ko";
import {
  handleSectorCommand,
  handleNextSectorCommand,
} from "./commands/sector";
import { handleScoreCommand } from "./commands/score";
import { handleBuyCommand } from "./commands/buy";
import { handleStocksCommand } from "./commands/stocks";
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
    const secret = process.env.CRON_SECRET!; // 또는 TELEGRAM_BOT_SECRET

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

// 명령어 패턴(한/영)
// ✅ 정규식 개선: 인수 캡처 그룹 추가
const CMD = {
  START: /^\/start$/,
  HELP: /^\/help$/,
  SECTOR: /^\/(sector|sectors|섹터)(?:\s+|$)(?:.*)?$/i,
  NEXT_SECTOR: /^\/(nextsector|flowsector|다음섹터)(?:\s+|$)(?:.*)?$/i,
  SCORE: /^\/(score|점수)\s+(.+)$/i,
  STOCKS: /^\/(stocks|종목)(?:\s+(.+))?$/i,
  UPDATE: /^\/update$/,
  COMMANDS: /^\/(commands|admin_commands)$/i,
  BUY: /^\/(buy|매수)(?:\s+(.+))?$/i,
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

  // /commands | /admin_commands (관리자 전용)
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

  // /sector | /sectors | /섹터
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

  // /nextsector | /flowsector | /다음섹터
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

  // ✅ /stocks | /종목 (기능 구현 연결)
  const ms = t.match(CMD.STOCKS);
  if (ms) {
    const sectorName = (ms[2] || "").trim(); // 캡처된 인수 (섹터명)

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

  // /seed | /시드 (관리자)
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

  // /update | /업데이트 (관리자)
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
      text:
        `/update 결과\n` +
        `stocks: ${st.status} total=${b1.total ?? "-"} ins=${
          b1.inserted ?? 0
        } upd=${b1.updated ?? 0} chg=${b1.changed ?? 0} ${
          b1.error ? `err=${b1.error}` : ""
        }\n` +
        `sectors: ${sc.status} total=${b2.total ?? "-"} ins=${
          b2.inserted ?? 0
        } upd=${b2.updated ?? 0} chg=${b2.changed ?? 0} ${
          b2.error ? `err=${b2.error}` : ""
        }`,
    });
    return;
  }

  // /buy | /매수 <쿼리>
  const mb = t.match(CMD.BUY);
  if (mb) {
    await handleBuyCommand(mb[2] || "", ctx, tgSend);
    return;
  }

  // /score | /점수 <쿼리>
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
  // 섹터 버튼: data 가 곧 sectorId (예: "KRX:IT")
  // ✅ 여기서도 getLeadersForSectorById를 사용하는 대신 handleStocksCommand를 재사용할 수도 있지만,
  // handleStocksCommand는 '이름' 기반이고, 여기는 'ID' 기반이므로
  // 기존 로직(getLeadersForSectorById)을 유지하거나 stocks.ts에 ID 기반 함수를 추가하는 것이 좋습니다.
  // 일단 기존 로직 유지 (가장 안전함)
  if (data.startsWith("KRX:")) {
    const sectorId = data;
    const leaders = await getLeadersForSectorById(sectorId, 10); // 30 -> 10개로 축소 추천

    if (!leaders.length) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "해당 섹터에 속한 종목이 없습니다.",
      });
      return;
    }

    // 리팩토링된 stocks.ts의 포맷을 따르고 싶다면 여기서도
    // handleStocksCommand 유사한 포맷팅 로직을 적용해야 함.
    // 하지만 여기서는 버튼 클릭 응답이므로 기존처럼 버튼 목록만 보여주는 것이 UX상 깔끔할 수 있음.

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
