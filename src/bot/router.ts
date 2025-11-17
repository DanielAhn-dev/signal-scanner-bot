// src/bot/router.ts
import { KO_MESSAGES } from "./messages/ko";
import {
  handleSectorCommand,
  handleNextSectorCommand,
} from "./commands/sector";
import { handleScoreCommand } from "./commands/score";
import { resolveBase } from "../lib/base";
import { getLeadersForSectorById } from "../data/sector";

export type ChatContext = { chatId: number; messageId?: number };

// 내부 POST 호출(강제 타임아웃 포함)
async function callInternal(path: string, ms = 8000) {
  const base = resolveBase(process.env);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "x-internal-secret": process.env.CRON_SECRET! },
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
const CMD = {
  START: /^\/start$/,
  HELP: /^\/help$/,
  SECTOR: /^\/(sector|sectors|섹터)\b(?:\s+.*)?$/i,
  NEXT_SECTOR: /^\/(nextsector|flowsector|다음섹터)\b(?:\s+.*)?$/i,
  SCORE: /^\/(score|점수)\s+(.+)$/i,
  STOCKS: /^\/(stocks|종목)\b(?:\s+.*)?$/i,
  SEED: /^\/(seed|시드)\b$/i,
  UPDATE: /^\/(update|업데이트)\b$/i,
};

export async function routeMessage(
  text: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const t = (text || "").trim();

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

  // /sector | /sectors | /섹터 : 통합 점수 기반 현재 유망 섹터
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

  // /nextsector | /flowsector | /다음섹터 : 수급 유입 기반 전망 섹터
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

  // /stocks | /종목 (향후 확장)
  if (CMD.STOCKS.test(t)) {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "종목 리스트/검색은 곧 제공됩니다. /score <이름|코드>를 이용하세요.",
    });
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
  // "sector:" 콜백 처리 (현재 섹터 랭킹에서 눌렀을 때)
  if (data.startsWith("sector:") || data.startsWith("nextsector:")) {
    const [, sectorId] = data.split(":"); // "sector:<id>" or "nextsector:<id>"

    const leaders = await getLeadersForSectorById(sectorId, 30);

    if (!leaders.length) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "해당 섹터에 속한 종목이 없습니다.",
      });
      return;
    }

    const stockLines = leaders.map((s) => `${s.name}(${s.code})`);
    const text = `상위 종목\n${stockLines.join("\n")}`;

    const keyboard = {
      inline_keyboard: leaders.map((s) => [
        { text: `${s.name}`, callback_data: `score:${s.code}` },
      ]),
    };

    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text,
      reply_markup: keyboard,
    });
    return;
  }

  // "score:" 콜백 처리
  if (data.startsWith("score:")) {
    const [, code] = data.split(":");
    if (code) {
      await handleScoreCommand(code, ctx, tgSend);
    }
    return;
  }

  // 그 외의 경우
  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: "알 수 없는 버튼입니다.",
  });
}
