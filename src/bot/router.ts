// src/bot/router.ts
import { KO_MESSAGES } from "./messages/ko";
import { handleSectorCommand } from "./commands/sector";
import { handleScoreCommand } from "./commands/score";
import { resolveBase } from "../lib/base";

export type ChatContext = { chatId: number; messageId?: number };

// 시드 응답 바디 타입
type SeedResp = { ok?: boolean; count?: number; error?: string };

// 내부 POST 호출(강제 타임아웃 포함)
async function callInternal(
  path: string,
  ms = 5000
): Promise<{ status: number; body: SeedResp }> {
  const base = resolveBase(process.env);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "x-internal-secret": process.env.CRON_SECRET! },
      signal: ctrl.signal,
    });
    const body = (await r.json().catch(() => ({}))) as SeedResp;
    return { status: r.status, body };
  } catch (e: any) {
    return { status: 0, body: { ok: false, error: e?.message || "timeout" } };
  } finally {
    clearTimeout(timer);
  }
}

export async function routeMessage(
  text: string,
  ctx: ChatContext,
  tgSend: any
): Promise<void> {
  const t = text.trim();

  // /start
  if (t === "/start") {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.START,
    });
    return;
  }

  // /help
  if (t === "/help") {
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: KO_MESSAGES.HELP,
    });
    return;
  }

  // /sector
  if (t === "/sector") {
    try {
      await handleSectorCommand(ctx, tgSend);
    } catch {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: KO_MESSAGES.SECTOR_ERROR,
      });
    }
    return;
  }

  // /seed
  if (t === "/seed" || t.startsWith("/seed ")) {
    if (String(ctx.chatId) !== process.env.TELEGRAM_ADMIN_CHAT_ID) {
      await tgSend("sendMessage", {
        chat_id: ctx.chatId,
        text: "권한이 없습니다.",
      });
      return;
    }

    // 즉시 시작 알림
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: "시드 시작… (최대 수 초)",
    });

    const [s1, s2] = await Promise.all([
      callInternal("/api/seed/stocks"),
      callInternal("/api/seed/sectors"),
    ]);

    const msg =
      `/seed 결과\n` +
      `stocks: ${s1.status} count=${s1.body.count ?? "-"} ${
        s1.body.error ? `err=${s1.body.error}` : ""
      }\n` +
      `sectors: ${s2.status} count=${s2.body.count ?? "-"} ${
        s2.body.error ? `err=${s2.body.error}` : ""
      }`;

    await tgSend("sendMessage", { chat_id: ctx.chatId, text: msg.trim() });
    return;
  }

  // /score or /점수 <쿼리>
  const m = t.match(/^\/(score|점수)\s+(.+)$/);
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
  if (data.startsWith("sector:")) {
    const name = data.split(":").slice(1).join(":");
    await tgSend("sendMessage", {
      chat_id: ctx.chatId,
      text: `섹터 "${name}" 선택됨 (다음 단계에서 종목 리스트 표시)`,
    });
    return;
  }
  if (data.startsWith("score:")) {
    const code = data.split(":")[1] || "";
    if (code) await handleScoreCommand(code, ctx, tgSend);
    return;
  }
  await tgSend("sendMessage", {
    chat_id: ctx.chatId,
    text: "알 수 없는 버튼입니다.",
  });
}
